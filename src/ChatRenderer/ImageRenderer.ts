require('dotenv').config()

import { promises as fs } from 'fs';
import { Image } from "@napi-rs/canvas";
import path from 'path';
import { TwitchEmote, EmoteType, ThirdPartyEmote } from './Emote';
import { DirectoryHandler } from '../DirectoryHandler';
import { R_OK } from 'node:constants';
import { delay } from '../common';

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

	accessPromises: Array<Promise<void>> = new Array();
	downloadFunctions: Array<(_callback: () => void) => void> = new Array();

	streamerId: string;

	constructor(streamerId: string) {
		this.streamerId = streamerId;
	}

	public async initalise() {
		await DirectoryHandler.attemptCreateDirectory(path.resolve("cache"));
		await DirectoryHandler.attemptCreateDirectory(path.resolve("cache", "emotes"));
		await DirectoryHandler.attemptCreateDirectory(path.resolve("cache", "emotes", "global"));
		if (BTTV) {
			await DirectoryHandler.attemptCreateDirectory(path.resolve("cache", "emotes", "bttv"));
			await DirectoryHandler.attemptCreateDirectory(path.resolve("cache", "emotes", "bttv", this.streamerId));
		}
		await DirectoryHandler.attemptCreateDirectory(path.resolve("cache", "badges"));
		await DirectoryHandler.attemptCreateDirectory(path.resolve("cache", "badges", "global"));
		await DirectoryHandler.attemptCreateDirectory(path.resolve("cache", "badges", "user"));
		await DirectoryHandler.attemptCreateDirectory(path.resolve("cache", "badges", "user", this.streamerId));
	}

	public async getBadges(channel_id: number) {
		const badgeGlobalData = await fetch(`${TWITCH_BADGE_LIST_API}/global/display?language=en`).then(response => response.json()).catch((reason) => {
			console.error(`Unable to get global badge list: ${reason}`);
		});
		const badgeUserData = await fetch(`${TWITCH_BADGE_LIST_API}/channels/${channel_id}/display?language=en`).then(response => response.json()).catch((reason) => {
			console.error(`Unable to get badge list from ${channel_id}: ${reason}`);
		});

		for (const [name, badgeData] of Object.entries(badgeGlobalData.badge_sets) as any) {
			for (const [versionName, version] of Object.entries(badgeData.versions) as any) {
				if (!this.badges.get(`${name}=${versionName}`)) {
					const badgePath = path.resolve("cache", "badges", "global", `${name}=${versionName}.png`);
					this.accessPromises.push(
						fs.access(badgePath, R_OK).catch(() => {
							this.downloadFunctions.push(this.downloadBadge(version, badgePath));
						}).finally(() => {
							this.badges.set(`${name}=${versionName}`, new Badge(badgePath));
						})
					);
				}
			}
		}
		for (const [name, badgeData] of Object.entries(badgeUserData.badge_sets) as any) {
			for (const [versionName, version] of Object.entries(badgeData.versions) as any) {
				if (!this.badges.get(`${name}=${versionName}`)) {
					const badgePath = path.resolve("cache", "badges", "user", this.streamerId, `${name}=${versionName}.png`);
					this.accessPromises.push(
						fs.access(badgePath, R_OK).catch(() => {
							this.downloadFunctions.push(this.downloadBadge(version, badgePath));
						}).finally(() => {
							this.badges.set(`${name}=${versionName}`, new Badge(badgePath));
						})
					);
				}
			}
		}
	}

	private downloadBadge(version: any, badgePath: string) {
		return async (_callback: () => void) => {
			async function downloadBadge() {
				const response = await fetch(version.image_url_1x, { method: 'GET' });
				if (response) {
					const buffer = await response.arrayBuffer();
					if (buffer) {
						await fs.writeFile(badgePath, Buffer.from(buffer), {
							encoding: 'binary'
						})
					}
				}
				_callback();
			}
			try {
				await downloadBadge();
			} catch (error) { // Try to download again
				console.log(`Failed to download Twitch Badge [${version.image_url_1x}]: ${error}, Trying again.`);
				await delay(1000);
				try {
					await downloadBadge();
				} catch {
					console.log(`Unable to download Twitch Badge [${version.image_url_1x}]: ${error}.`);
					_callback();
				}
			}
		}
	}

	public async getThirdPartyEmotes(channel_id: number) {
		if (BTTV) {
			const emoteGlobalData = await fetch(`${BTTV_API}/emotes/global`).then(response => response.json());
			const emoteUserResponse = await fetch(`${BTTV_API}/users/twitch/${channel_id}`);
			for (const emoteData of emoteGlobalData) {
				if (!this.thirdPartyEmotes.get(emoteData.code)) {
					let emotePath = path.resolve("cache", "emotes", "global", `${emoteData.id}.${emoteData.imageType}`);
					this.accessPromises.push(
						fs.access(emotePath, R_OK).catch(() => {
							this.downloadFunctions.push(this.downloadBTTVEmote(emoteData, emotePath));
						}).finally(() => {
							const type = EmoteType.fromString(emoteData.imageType);
							this.thirdPartyEmotes.set(emoteData.code, new ThirdPartyEmote(type, emoteData.id, true));
						})
					);
				}
			}
			switch (emoteUserResponse.status) {
				case 200:
				case 304:
					const emoteUserData = await emoteUserResponse.json();
					console.log(`Downloading BTTV emotes for ${channel_id}`);
					for (const emoteData of emoteUserData.channelEmotes) {
						if (!this.thirdPartyEmotes.get(emoteData.code)) {
							let emotePath = path.resolve("cache", "emotes", "bttv", this.streamerId, `${emoteData.id}.${emoteData.imageType}`);
							this.accessPromises.push(
								fs.access(emotePath, R_OK).catch(() => {
									this.downloadFunctions.push(this.downloadBTTVEmote(emoteData, emotePath));
								}).finally(() => {
									const type = EmoteType.fromString(emoteData.imageType);
									this.thirdPartyEmotes.set(emoteData.code, new ThirdPartyEmote(type, emoteData.id, false));
								})
							);
						}
					}
					for (const emoteData of emoteUserData.sharedEmotes) {
						if (!this.thirdPartyEmotes.get(emoteData.code)) {
							let emotePath = path.resolve("cache", "emotes", "bttv", this.streamerId, `${emoteData.id}.${emoteData.imageType}`);
							this.accessPromises.push(
								fs.access(emotePath, R_OK).catch(() => {
									this.downloadFunctions.push(this.downloadBTTVEmote(emoteData, emotePath));
								}).finally(() => {
									const type = EmoteType.fromString(emoteData.imageType);
									this.thirdPartyEmotes.set(emoteData.code, new ThirdPartyEmote(type, emoteData.id, false));
								})
							);
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
					let emotePath = path.resolve("cache", "emotes", "bttv", this.streamerId, `${emoteData.id}.${emoteData.imageType}`);
					this.accessPromises.push(
						fs.access(emotePath, R_OK).catch(() => {
							this.downloadFunctions.push(this.downloadFrankerfacezEmote(emoteData, emotePath));
						}).finally(() => {
							const type = EmoteType.fromString(emoteData.imageType);
							this.thirdPartyEmotes.set(emoteData.code, new ThirdPartyEmote(type, emoteData.id, false));
						})
					);
				}
			}
		}
	}

	private downloadFrankerfacezEmote(emoteData: any, emotePath: string) {
		return async (_callback: () => void) => {
			const requestUrl = `${BTTV_EMOTE_API}/frankerfacez_emote/${emoteData.id}/1`;
			async function downloadFrankerfacezEmote() {
				const response = await fetch(requestUrl, { method: 'GET' });
				if (response) {
					const buffer = await response.arrayBuffer();
					if (buffer) {
						await fs.writeFile(emotePath, Buffer.from(buffer), {
							encoding: 'binary'
						})
					}
				}
				_callback();
			}
			try {
				await downloadFrankerfacezEmote();
			} catch (error) { // Try to download again
				console.log(`Failed to download Frankerfacez Emote [${requestUrl}]: ${error}, Trying again.`);
				await delay(1000);
				try {
					await downloadFrankerfacezEmote();
				} catch (error) {
					console.log(`Unable to download Frankerfacez Emote [${requestUrl}]: ${error}.`);
					_callback();
				}
			}
		}
	}


	private downloadBTTVEmote(emoteData: any, emotePath: string) {
		return async (_callback: () => void) => {
			const requestUrl = `${BTTV_EMOTE_API}/emote/${emoteData.id}/1x`;
			async function downloadBTTVEmote() {
				const response = await fetch(requestUrl, { method: 'GET' });
				if (response) {
					const buffer = await response.arrayBuffer();
					if (buffer) {
						await fs.writeFile(emotePath, Buffer.from(buffer), {
							encoding: 'binary'
						})
					}
				}
				_callback();
			}
			try {
				await downloadBTTVEmote();
			} catch (error) { // Try to download again
				console.log(`Failed to download BTTV Emote [${requestUrl}]: ${error}, Trying again.`);
				await delay(1000);
				try {
					await downloadBTTVEmote();
				} catch (error) {
					console.log(`Unable to download BTTV Emote [${requestUrl}]: ${error}.`);
					_callback();
				}
			}
		}
	}

	// https://github.com/lay295/TwitchDownloader/blob/master/TwitchDownloaderCore/TwitchHelper.cs
	public static async getEmotes(imageRenderer: ImageRenderer, comments: Array<any>) {
		for (let comment of comments) {
			if (comment.message.fragments == null)
				continue;

			for (let fragment of comment.message.fragments) {
				if (fragment.emoticon != null) {
					let id = fragment.emoticon.emoticon_id;
					if (!this.twitchEmotes.get(id)) {
						imageRenderer.downloadFunctions.push(this.downloadTwitchEmote(imageRenderer, id))
					}
				}
			}
		}
	}

	private static downloadTwitchEmote(imageRenderer: ImageRenderer, id: string) {
		return async (_callback: () => void) => {
			const requestUrl = `${TWITCH_EMOTE_API}/${id}/default/dark/1.0`;
			const twitchEmotes = this.twitchEmotes;
			async function downloadTwitchEmote() {
				const response = await fetch(requestUrl, { method: 'GET' });
				if (response) {
					const arrayBuffer = await response.arrayBuffer();
					if (arrayBuffer) {
						const buffer = Buffer.from(arrayBuffer);
						const extension = ImageRenderer.getImageExtension(ImageRenderer.getBufferMime(buffer));
						const emotePath = path.resolve("cache", "emotes", "global", `${id}.${extension}`);
						twitchEmotes.set(id, new TwitchEmote(EmoteType.fromString(extension)));
						try {
							await fs.access(emotePath, R_OK)
						} catch {
							await fs.writeFile(emotePath, buffer, {
								encoding: 'binary'
							})
						}
					}
				}
				_callback();
			}
			try {
				await downloadTwitchEmote();
			} catch (error) { // Try to download again
				console.log(`Failed to download Twitch Emote [${requestUrl}]: ${error}, Trying again.`);
				await delay(1000);
				try {
					await downloadTwitchEmote();
				} catch (error) {
					console.log(`Unable to download Twitch Emote [${requestUrl}]: ${error}.`);
					_callback();
				}
			}
		};
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
}

class Badge {
	path: string;
	constructor(path: string) {
		this.path = path;
	}
}