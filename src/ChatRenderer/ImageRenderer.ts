require('dotenv').config()

const fetch = require('node-fetch');
import axios from 'axios';
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

const BTTV = false;
const FFZ = false;

const TWITCH_EMOTE_API = "https://static-cdn.jtvnw.net/emoticons/v2";
const BTTV_API = 'https://api.betterttv.net/3/cached';
const BTTV_EMOTE_API = `https://cdn.betterttv.net`;
const TWITCH_BADGE_LIST_API = "https://badges.twitch.tv/v1/badges";

export class ImageRenderer {
    static writing_to_file: number = 0;
    public static async getBadges(channel_id: number) {
        const badge_global_request = await axios.get(`${TWITCH_BADGE_LIST_API}/global/display?language=en`, {
            responseType: 'json'
        });
        const badge_user_request = await axios.get(`${TWITCH_BADGE_LIST_API}/channels/${channel_id}/display?language=en`, {
            responseType: 'json'
        });

        const badges = new Map<string, Badge>();
        for (const [name, badge_data] of Object.entries(badge_global_request.data.badge_sets) as any) {
            for (const [version_name, version] of Object.entries(badge_data.versions) as any) {
                this.downloadBadge(badges, name, version_name, version);
            }
        }
        for (const [name, badge_data] of Object.entries(badge_user_request.data.badge_sets) as any) {
            for (const [version_name, version] of Object.entries(badge_data.versions) as any) {
                this.downloadBadge(badges, name, version_name, version);
            }
        }
        return badges;
    }

    private static async downloadBadge(badges: Map<string, Badge>, name: string, version_name: string, version: any) {
        this.writing_to_file++;
        const badge_path = path.join(MAIN_STORE_PATH, "badges", `${name}=${version_name}.png`);
        const result = await fetch(version.image_url_1x, { method: 'GET' });
        fs.writeFile(badge_path, await result.buffer(), {
            encoding: 'binary'
        }).finally(() => {
            this.writing_to_file--;
        })
        badges.set(`${name}=${version_name}`, new Badge(badge_path));
    }

    public static async getThirdPartyEmotes(channel_id: number) {
        const emotes = new Map<string, ThirdPartyEmote>();
        if (BTTV) {
            const emote_global_request = await axios.get(`${BTTV_API}/emotes/global`, {
                responseType: 'json'
            });
            const emote_user_request = await axios.get(`${BTTV_API}/users/twitch/${channel_id}`, {
                responseType: 'json'
            });
            for (const [_, emote_data] of Object.entries(emote_global_request.data) as any) {
                this.downloadThirdPartyEmote(emotes, emote_data);
            }
            for (const [_, emote_data] of Object.entries(emote_user_request.data.channelEmotes) as any) {
                this.downloadThirdPartyEmote(emotes, emote_data);
            }
            for (const [_, emote_data] of Object.entries(emote_user_request.data.sharedEmotes) as any) {
                this.downloadThirdPartyEmote(emotes, emote_data);
            }
        }
        if (FFZ) {
            const emote_user_request = await axios.get(`${BTTV_API}/frankerfacez/users/twitch/${channel_id}`, {
                responseType: 'json'
            });
            for (const [_, emote_data] of Object.entries(emote_user_request.data) as any) {
                this.writing_to_file++;
                const result = await fetch(`${BTTV_EMOTE_API}/frankerfacez_emote/${emote_data.id}/1`, { method: 'GET' });
                const emote_path = path.join(MAIN_STORE_PATH, "emotes", `${emote_data.id}.${emote_data.imageType}`);
                fs.writeFile(emote_path, await result.buffer(), {
                    encoding: 'binary'
                }).finally(() => {
                    this.writing_to_file--;
                })
                const type = EmoteType.fromString(emote_data.imageType);
                emotes.set(emote_data.code, new ThirdPartyEmote(type, emote_data.id));
            }
        }
        return emotes;
    }

    private static async downloadThirdPartyEmote(emotes: Map<string, ThirdPartyEmote>, emote_data: any) {
        this.writing_to_file++;
        const result = await fetch(`${BTTV_EMOTE_API}/emote/${emote_data.id}/1x`, { method: 'GET' });
        const emote_path = path.join(MAIN_STORE_PATH, "emotes", `${emote_data.id}.${emote_data.imageType}`);
        fs.writeFile(emote_path, await result.buffer(), {
            encoding: 'binary'
        }).finally(() => {
            this.writing_to_file--;
        })
        const type = EmoteType.fromString(emote_data.imageType);
        emotes.set(emote_data.code, new ThirdPartyEmote(type, emote_data.id));
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
                    var id = fragment.emoticon.emoticon_id;
                    if (!emotes.get(id) && !failed_emotes.get(id)) {
                        try {
                            this.writing_to_file++;
                            const result = await fetch(`${TWITCH_EMOTE_API}/${id}/default/dark/1.0`, { method: 'GET' });
                            const buffer = await result.buffer();
                            const extension = this.getImageExtension(this.getBufferMime(buffer));
                            const emote_path = path.join(MAIN_STORE_PATH, "emotes", `${id}.${extension}`);
                            fs.writeFile(emote_path, buffer, {
                                encoding: 'binary'
                            }).finally(() => {
                                this.writing_to_file--;
                            })
                            emotes.set(id, new TwitchEmote(EmoteType.fromString(extension)));
                        } catch {
                            failed_emotes.set(id, true);
                        }
                    }
                }
            }
        }
        return emotes;
    }

    private static getBufferMime(buffer: Buffer) {
        var arr = new Uint8Array(buffer).subarray(0, 4);
        var header = "";
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