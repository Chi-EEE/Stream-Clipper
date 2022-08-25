require('dotenv').config()

import { promises as fs } from 'fs';
import { Image } from "@napi-rs/canvas";
import path from 'path';
import { TwitchEmote, EmoteType, ThirdPartyEmote } from './Emote';
import { DirectoryHandler } from '../DirectoryHandler';
import { R_OK } from 'node:constants';

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
    badges: Map<string, Badge> = new Map();
    thirdPartyEmotes: Map<string, ThirdPartyEmote> = new Map();
    static twitchEmotes: Map<string, TwitchEmote> = new Map();

    streamerId: string;
    writingToFile: number = 0;

    constructor(streamerId: string) {
        this.streamerId = streamerId;
    }

    public async initalise() {
        await DirectoryHandler.attemptCreateDirectory(path.basename("cache"));
        await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("cache"), "emotes"));
        await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("cache"), "emotes", "global"));
        if (BTTV) {
            await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("cache"), "emotes", "bttv"));
            await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("cache"), "emotes", "bttv", this.streamerId));
        }
        await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("cache"), "badges"));
        await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("cache"), "badges", "global"));
        await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("cache"), "badges", "user"));
        await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("cache"), "badges", "user", this.streamerId));
    }

    public async getBadges(channel_id: number) {
        const badgeGlobalData = await fetch(`${TWITCH_BADGE_LIST_API}/global/display?language=en`).then(response => response.json());
        const badgeUserData = await fetch(`${TWITCH_BADGE_LIST_API}/channels/${channel_id}/display?language=en`).then(response => response.json());

        for (const [name, badgeData] of Object.entries(badgeGlobalData.badge_sets) as any) {
            for (const [versionName, version] of Object.entries(badgeData.versions) as any) {
                if (!this.badges.get(`${name}=${versionName}`)) {
                    this.writingToFile++;
                    const badgePath = path.join(MAIN_STORE_PATH, "badges", "global", `${name}=${versionName}.png`);
                    fs.access(badgePath, R_OK).catch(() => {
                        this.downloadBadge(version, badgePath);
                    }).then(() => {
                        this.writingToFile--;
                    }).finally(() => {
                        this.badges.set(`${name}=${versionName}`, new Badge(badgePath));
                    })
                }
            }
        }
        for (const [name, badgeData] of Object.entries(badgeUserData.badge_sets) as any) {
            for (const [versionName, version] of Object.entries(badgeData.versions) as any) {
                if (!this.badges.get(`${name}=${versionName}`)) {
                    this.writingToFile++;
                    const badgePath = path.join(MAIN_STORE_PATH, "badges", "user", this.streamerId, `${name}=${versionName}.png`);
                    fs.access(badgePath, R_OK).catch(() => {
                        this.downloadBadge(version, badgePath);
                    }).then(() => {
                        this.writingToFile--;
                    }).finally(() => {
                        this.badges.set(`${name}=${versionName}`, new Badge(badgePath));
                    })
                }
            }
        }
    }

    private async downloadBadge(version: any, badgePath: string) {
        const result = await fetch(version.image_url_1x, { method: 'GET' });
        fs.writeFile(badgePath, Buffer.from(await result.arrayBuffer()), {
            encoding: 'binary'
        }).finally(() => {
            this.writingToFile--;
        });
    }

    public async getThirdPartyEmotes(channel_id: number) {
        if (BTTV) {
            const emoteGlobalData = await fetch(`${BTTV_API}/emotes/global`).then(response => response.json());
            const emoteUserResponse = await fetch(`${BTTV_API}/users/twitch/${channel_id}`);
            for (const emoteData of emoteGlobalData) {
                if (!this.thirdPartyEmotes.get(emoteData.code)) {
                    this.writingToFile++;
                    let emotePath = path.join(MAIN_STORE_PATH, "emotes", "global", `${emoteData.id}.${emoteData.imageType}`);
                    fs.access(emotePath, R_OK).catch(() => {
                        this.downloadBTTVEmote(emoteData, emotePath);
                    }).then(() => {
                        this.writingToFile--;
                    }).finally(() => {
                        const type = EmoteType.fromString(emoteData.imageType);
                        this.thirdPartyEmotes.set(emoteData.code, new ThirdPartyEmote(type, emoteData.id, true));
                    });
                }
            }
            switch (emoteUserResponse.status) {
                case 200:
                case 304:
                    const emoteUserData = await emoteUserResponse.json();
                    console.log(`Downloading BTTV emotes for ${channel_id}`);
                    for (const emoteData of emoteUserData.channelEmotes) {
                        if (!this.thirdPartyEmotes.get(emoteData.code)) {
                            this.writingToFile++;
                            let emotePath = path.join(MAIN_STORE_PATH, "emotes", "bttv", this.streamerId, `${emoteData.id}.${emoteData.imageType}`);
                            fs.access(emotePath, R_OK).catch(() => {
                                this.downloadBTTVEmote(emoteData, emotePath);
                            }).then(() => {
                                this.writingToFile--;
                            }).finally(() => {
                                const type = EmoteType.fromString(emoteData.imageType);
                                this.thirdPartyEmotes.set(emoteData.code, new ThirdPartyEmote(type, emoteData.id, false));
                            });
                        }
                    }
                    for (const emoteData of emoteUserData.sharedEmotes) {
                        if (!this.thirdPartyEmotes.get(emoteData.code)) {
                            this.writingToFile++;
                            let emotePath = path.join(MAIN_STORE_PATH, "emotes", "bttv", this.streamerId, `${emoteData.id}.${emoteData.imageType}`);
                            fs.access(emotePath, R_OK).catch(() => {
                                this.downloadBTTVEmote(emoteData, emotePath);
                            }).then(() => {
                                this.writingToFile--;
                            }).finally(() => {
                                const type = EmoteType.fromString(emoteData.imageType);
                                this.thirdPartyEmotes.set(emoteData.code, new ThirdPartyEmote(type, emoteData.id, false));
                            });
                        }
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
                if (!this.thirdPartyEmotes.get(emoteData.code)) {
                    this.writingToFile++;
                    let emotePath = path.join(MAIN_STORE_PATH, "emotes", "bttv", this.streamerId, `${emoteData.id}.${emoteData.imageType}`);
                    fs.access(emotePath, R_OK).catch(() => {
                        this.downloadFrankerfacezEmote(emoteData, emotePath);
                    }).then(() => {
                        this.writingToFile--;
                    }).finally(() => {
                        const type = EmoteType.fromString(emoteData.imageType);
                        this.thirdPartyEmotes.set(emoteData.code, new ThirdPartyEmote(type, emoteData.id, false));
                    });
                }
            }
        }
    }

    private async downloadFrankerfacezEmote(emoteData: any, emotePath: string) {
        const response = await fetch(`${BTTV_EMOTE_API}/frankerfacez_emote/${emoteData.id}/1`, { method: 'GET' });
        fs.writeFile(emotePath, Buffer.from(await response.arrayBuffer()), {
            encoding: 'binary'
        }).finally(() => {
            this.writingToFile--;
        })
    }

    private async downloadBTTVEmote(emoteData: any, emotePath: string) {
        const response = await fetch(`${BTTV_EMOTE_API}/emote/${emoteData.id}/1x`, { method: 'GET' });
        fs.writeFile(emotePath, Buffer.from(await response.arrayBuffer()), {
            encoding: 'binary'
        }).finally(() => {
            this.writingToFile--;
        });
    }

    // https://github.com/lay295/TwitchDownloader/blob/master/TwitchDownloaderCore/TwitchHelper.cs
    public static async getEmotes(imageRenderer: ImageRenderer, comments: Array<any>) {
        const failed_emotes = new Map<string, boolean>();
        for (let comment of comments) {
            if (comment.message.fragments == null)
                continue;

            for (let fragment of comment.message.fragments) {
                if (fragment.emoticon != null) {
                    let id = fragment.emoticon.emoticon_id;
                    if (!this.twitchEmotes.get(id) && !failed_emotes.get(id)) {
                        imageRenderer.writingToFile++;
                        this.downloadTwitchEmote(imageRenderer, id).catch(() => {
                            imageRenderer.writingToFile--;
                            failed_emotes.set(id, true);
                        })
                    }
                }
            }
        }
    }

    private static async downloadTwitchEmote(imageRenderer: ImageRenderer, id: string) {
        const result = await fetch(`${TWITCH_EMOTE_API}/${id}/default/dark/1.0`, { method: 'GET' });
        const buffer = Buffer.from(await result.arrayBuffer());
        const extension = ImageRenderer.getImageExtension(ImageRenderer.getBufferMime(buffer));
        const emotePath = path.join(MAIN_STORE_PATH, "emotes", "global", `${id}.${extension}`);
        this.twitchEmotes.set(id, new TwitchEmote(EmoteType.fromString(extension)));
        fs.access(emotePath, R_OK).catch(() => {
            fs.writeFile(emotePath, buffer, {
                encoding: 'binary'
            }).finally(() => {
                imageRenderer.writingToFile--;
            })
        }).then(() => {
            imageRenderer.writingToFile--;
        });
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

    public async waitWriting() {
        while (this.writingToFile > 0) {
            await delay(500);
        }
    }
}

class Badge {
    path: string;
    constructor(path: string) {
        this.path = path;
    }
}