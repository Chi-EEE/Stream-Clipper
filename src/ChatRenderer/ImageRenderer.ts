require('dotenv').config()

import { promises as fs } from 'fs';
import { Image } from "@napi-rs/canvas";
import path from 'path';
import { TwitchEmote, EmoteType, ThirdPartyEmote } from './Emote';
import { Badge } from './Badge';

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export class ImageRender {
    image: Image;
    x: number;
    y: number;
    constructor(image: Image, x: number, y: number) {
        this.image = image;
        this.x = x;
        this.y = y;
    }
}
const MAIN_STORE_PATH = path.basename("/cache");

const BTTV = true;
const FFZ = true;

const TWITCH_EMOTE_API = "https://static-cdn.jtvnw.net/emoticons/v2";
const BTTV_API = 'https://api.betterttv.net/3/cached';
const BTTV_EMOTE_API = `https://cdn.betterttv.net`;
const TWITCH_BADGE_LIST_API = "https://badges.twitch.tv/v1/badges";

export class ImageRenderer {
    static writing_to_file: number = 0;
    public static async getBadges(channel_id: number) {
        const badgeGlobalData = await fetch(`${TWITCH_BADGE_LIST_API}/global/display?language=en`).then(response => response.json());
        const badgeUserData = await fetch(`${TWITCH_BADGE_LIST_API}/channels/${channel_id}/display?language=en`).then(response => response.json());

        const badges = new Map<string, Badge>();
        for (const [name, badgeData] of Object.entries(badgeGlobalData.badge_sets) as any) {
            for (const [versionName, version] of Object.entries(badgeData.versions) as any) {
                this.writing_to_file++;
                this.downloadBadge(badges, name, versionName, version);
            }
        }
        for (const [name, badgeData] of Object.entries(badgeUserData.badge_sets) as any) {
            for (const [versionName, version] of Object.entries(badgeData.versions) as any) {
                this.writing_to_file++;
                this.downloadBadge(badges, name, versionName, version);
            }
        }
        return badges;
    }

    private static async downloadBadge(badges: Map<string, Badge>, name: string, version_name: string, version: any) {
        const badge_path = path.join(MAIN_STORE_PATH, "badges", `${name}=${version_name}.png`);
        const result = await fetch(version.image_url_1x, { method: 'GET' });
        fs.writeFile(badge_path, Buffer.from(await result.arrayBuffer()), {
            encoding: 'binary'
        }).finally(() => {
            this.writing_to_file--;
        })
        badges.set(`${name}=${version_name}`, new Badge(badge_path));
    }

    public static async getThirdPartyEmotes(channel_id: number) {
        const emotes = new Map<string, ThirdPartyEmote>();
        if (BTTV) {
            const emoteGlobalData = await fetch(`${BTTV_API}/emotes/global`).then(response => response.json());
            const emoteUserResponse = await fetch(`${BTTV_API}/users/twitch/${channel_id}`);
            for (const emoteData of emoteGlobalData) {
                this.writing_to_file++;
                this.downloadBTTVEmote(emotes, emoteData);
            }
            switch (emoteUserResponse.status) {
                case 200:
                case 304:
                    const emoteUserData = await emoteUserResponse.json();
                    console.log(`Downloading BTTV emotes for ${channel_id}`);
                    for (const emoteData of emoteUserData.channelEmotes) {
                        this.writing_to_file++;
                        this.downloadBTTVEmote(emotes, emoteData);
                    }
                    for (const emoteData of emoteUserData.sharedEmotes) {
                        this.writing_to_file++;
                        this.downloadBTTVEmote(emotes, emoteData);
                    }
                    break;
                case 404:
                default:
                    console.log(`[${emoteUserResponse.status}] Unable to download BTTV emotes for ${channel_id}`);
                    console.log(emoteUserResponse.body);
                    break;
            }
        }
        if (FFZ) {
            const emoteUserData = await fetch(`${BTTV_API}/frankerfacez/users/twitch/${channel_id}`).then(response => response.json());
            for (const emoteData of emoteUserData) {
                this.writing_to_file++;
                this.downloadFrankerfacezEmote(emotes, emoteData);
            }
        }
        return emotes;
    }

    private static async downloadFrankerfacezEmote(emotes: Map<string, ThirdPartyEmote>, emoteData: any) {
        const response = await fetch(`${BTTV_EMOTE_API}/frankerfacez_emote/${emoteData.id}/1`, { method: 'GET' });
        const emote_path = path.join(MAIN_STORE_PATH, "emotes", `${emoteData.id}.${emoteData.imageType}`);
        fs.writeFile(emote_path, Buffer.from(await response.arrayBuffer()), {
            encoding: 'binary'
        }).finally(() => {
            this.writing_to_file--;
        })
        const type = EmoteType.fromString(emoteData.imageType);
        emotes.set(emoteData.code, new ThirdPartyEmote(type, emoteData.id));
    }

    private static async downloadBTTVEmote(emotes: Map<string, ThirdPartyEmote>, emoteData: any) {
        const response = await fetch(`${BTTV_EMOTE_API}/emote/${emoteData.id}/1x`, { method: 'GET' });
        const emote_path = path.join(MAIN_STORE_PATH, "emotes", `${emoteData.id}.${emoteData.imageType}`);
        fs.writeFile(emote_path, Buffer.from(await response.arrayBuffer()), {
            encoding: 'binary'
        }).finally(() => {
            this.writing_to_file--;
        })
        const type = EmoteType.fromString(emoteData.imageType);
        emotes.set(emoteData.code, new ThirdPartyEmote(type, emoteData.id));
    }

    // https://github.com/lay295/TwitchDownloader/blob/master/TwitchDownloaderCore/TwitchHelper.cs
    public static async getEmotes(comments: Array<any>) {
        const emotes = new Map<string, TwitchEmote>();
        const failed_emotes = new Map<string, boolean>();
        for (let comment of comments) {
            if (comment.message.fragments == null)
                continue;

            for (let fragment of comment.message.fragments) {
                if (fragment.emoticon != null) {
                    let id = fragment.emoticon.emoticon_id;
                    if (!emotes.get(id) && !failed_emotes.get(id)) {
                        this.writing_to_file++;
                        this.downloadTwitchEmote(emotes, id).catch(() => {
                            failed_emotes.set(id, true);
                        })
                    }
                }
            }
        }
        return emotes;
    }

    private static async downloadTwitchEmote(emotes: Map<string, TwitchEmote>, id: string) {
        const result = await fetch(`${TWITCH_EMOTE_API}/${id}/default/dark/1.0`, { method: 'GET' });
        const buffer = Buffer.from(await result.arrayBuffer());
        const extension = this.getImageExtension(this.getBufferMime(buffer));
        const emote_path = path.join(MAIN_STORE_PATH, "emotes", `${id}.${extension}`);
        fs.writeFile(emote_path, buffer, {
            encoding: 'binary'
        }).finally(() => {
            this.writing_to_file--;
        })
        emotes.set(id, new TwitchEmote(EmoteType.fromString(extension)));
    }

    private static getBufferMime(buffer: Buffer) {
        let arr = new Uint8Array(buffer).subarray(0, 4);
        let header = "";
        for (const element of arr) {
            header += element.toString(16);
        }
        return header;
    }

    private static getImageExtension(header: string) {
        switch (header) {
            case "89504e47":
                return "png";
            case "47494638":
                return "gif";
            case "ffd8ffe0":
            case "ffd8ffe1":
            case "ffd8ffe2":
            case "ffd8ffe3":
            case "ffd8ffe8":
                return "jpeg";
            default:
                return "";
        }
    }

    public static async waitWriting() {
        while (this.writing_to_file > 0) {
            await delay(1000);
        }
    }
}