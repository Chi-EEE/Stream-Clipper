import { configuration } from '../config/default'
import { ApiClient } from '@twurple/api';
import { RefreshingAuthProvider } from '@twurple/auth';
import { ChatClient } from '@twurple/chat';
import { promises as fs } from 'fs';
import prompts from 'prompts';

import { StreamerChannel, StreamStatus } from './StreamerChannel';
import path from 'path';
import { DirectoryHandler } from './DirectoryHandler';
import { StreamSession } from "./StreamSession";
import { ClipInfo } from './ClipInfo';
import { R_OK } from 'node:constants';
import { DetectGroupConfig } from '../config/_Config';

function milliseconds_since_epoch_utc(d: Date) {
	return d.getTime() + (d.getTimezoneOffset() * 60 * 1000);
}

function get_uptime_format(date_milliseconds: number) {
	let hours = Math.floor(date_milliseconds / 3600000);
	let minutes = Math.floor((date_milliseconds - (hours * 3600000)) / 60000);
	let seconds = Math.floor((date_milliseconds + (hours * -3600000) + (minutes * -60000)) / 1000);
	return `${hours}:${minutes}:${seconds}`;
}

export class Bot {
	private apiClient: ApiClient | null = null;
	public chatClient: ChatClient | null = null;
	private gqlOauth: string | null = null;

	private streamerChannels: Map<string, StreamerChannel> = new Map();
	private activeSessions: Map<string, StreamSession> = new Map();
	private previousSessions: Array<StreamSession> = new Array();

	/**
	 * Initalises the chat client and api client for twitch
	 * @param clientId Client id for the twitch bot
	 * @param clientSecret Client secret for the twitch bot
	 */
	public async initalise(clientId: string, clientSecret: string, gqlOauth: string) {
		const tokenData = JSON.parse(await fs.readFile('./tokens.json', "utf-8"));
		const authProvider = new RefreshingAuthProvider(
			{
				clientId: clientId,
				clientSecret: clientSecret,
				onRefresh: async newTokenData => await fs.writeFile('./tokens.json', JSON.stringify(newTokenData, null, 4), 'utf-8')
			},
			tokenData
		);
		this.gqlOauth = gqlOauth;
		this.apiClient = new ApiClient({ authProvider });

		const streamerIdToName: Map<number, string> = new Map();
		for (const streamer of configuration.streamers) {
			const helixUser = await this.apiClient.users.getUserByName(streamer);
			if (helixUser) {
				const streamerChannel = new StreamerChannel(helixUser.id, streamer);
				await streamerChannel.imageRenderer.initalise();
				streamerIdToName.set(parseInt(helixUser.id), streamer)
				this.streamerChannels.set(streamer, streamerChannel);
			} else {
				console.log(`Unable to get the id for the streamer: ${streamer}`);
				process.exit(0);
			}
		}
		// Handle previous vods
		const VOD_DIR = path.resolve("vods");
		try {
			const vods = await fs.readdir(VOD_DIR);
			for (const vodId of vods) {
				const stat = await fs.stat(path.join(VOD_DIR, vodId));
				if (stat.isDirectory()) {
					const info = JSON.parse(await fs.readFile(path.join(VOD_DIR, vodId, "Info.json"), "utf-8"));
					const streamerName = streamerIdToName.get(info.Streamer);
					if (streamerName) { // Get previous 100 vods and check if vod id is equal to 
						const previousSession = new StreamSession(this.streamerChannels.get(streamerName)!, parseInt(vodId), true);
						await this._checkPreviousVods(previousSession, info, VOD_DIR, vodId, streamerName);
					}
				}
			}
		} catch { }
		this.chatClient = new ChatClient({ authProvider, channels: configuration.streamers });
		this.chatClient.onMessage(this.onMessage.bind(this));
	}
	private async _checkPreviousVods(previousSession: StreamSession, info: any, VOD_DIR: string, vodId: string, streamerName: string) {
		// Go through each of the groups
		for (const detectGroupConfig of configuration.streamerConfigs.get(streamerName)!.detectGroupConfigs) {
			try {
				const stat = await fs.stat(path.join(VOD_DIR, vodId, detectGroupConfig.name));
				if (stat.isDirectory()) {
					let hasFinished = false;
					await fs.access(path.join(VOD_DIR, vodId, detectGroupConfig.name, "Final.mp4"), R_OK).then(() => {
						hasFinished = true;
					}).catch(() => { });
					if (!hasFinished) {
						const result = await prompts({
							name: 'value',
							message: `Would you like to complete the render of the group: [${detectGroupConfig.name}] from ${info.Streamer} (${streamerName})?`,
							type: 'confirm',
							initial: true
						});
						if (result.value) {
							this._checkPreviousClips(previousSession, detectGroupConfig, VOD_DIR, vodId);
						}
					}
				}
			} catch { }
		}
	}
	private async _checkPreviousClips(previousSession: StreamSession, detectGroupConfig: DetectGroupConfig, VOD_DIR: string, vodId: string) {
		let TOTAL_LENGTH = 0;
		await fs.access(path.join(VOD_DIR, vodId, detectGroupConfig.name, "Steps"), R_OK).then(() => {
			TOTAL_LENGTH -= 1; // Remove TOTAL_LENGTH if Steps is available
		}).catch(() => { });

		const GROUP_DIR = (await fs.readdir(path.join(VOD_DIR, vodId, detectGroupConfig.name)));
		TOTAL_LENGTH += GROUP_DIR.length;
		const TS_DIR = (await fs.readdir(path.join(VOD_DIR, vodId, detectGroupConfig.name, "Steps", "3-TS")));
		if (TS_DIR.length < TOTAL_LENGTH) { // Merge
			const FFMPEG_Promises: Array<Promise<void>> = new Array();
			for (let i = 0; i < TOTAL_LENGTH; i++) { // Go through each of the numbers
				const DIR_NUM = GROUP_DIR[i];
				const files = await fs.readdir(path.join(VOD_DIR, vodId, detectGroupConfig.name, DIR_NUM));
				let hasChatRender = false;
				let otherClipFile = "";
				for (const file of files) {
					if (file === "ChatRender") { // Check if chat render exists
						hasChatRender = true;
					} else {
						otherClipFile = file;
					}
				}
				const basePath = path.resolve("vods", vodId);
				const otherFileName = path.parse(otherClipFile).name;
				const clipInfo = new ClipInfo(detectGroupConfig.name, otherFileName);
				if (!hasChatRender) {
					try {
						const clip = (await this.apiClient!.clips.getClipById(otherFileName))!;
						async function handleClip() {
							await previousSession.renderChat(DIR_NUM, clipInfo, basePath, detectGroupConfig.name, clip);
							await previousSession.merge(DIR_NUM, clipInfo, basePath, detectGroupConfig.name);
							await previousSession.fade(DIR_NUM, clipInfo, basePath, detectGroupConfig.name);
							await previousSession.transcode(DIR_NUM, clipInfo, basePath, detectGroupConfig.name);
						}
						FFMPEG_Promises.push(handleClip());
					} catch {
						// We'll probably have to loop through all the numbers and reduce by one
						// OR we can remove the clip from the vod and continue on without it
						console.error(`Unable to retrieve clip id [${otherClipFile}]`);
						break;
					}
				} else {
					let hasMerged = false;
					await fs.access(path.join(VOD_DIR, vodId, detectGroupConfig.name, "Steps", "1-Merged", `${DIR_NUM}.mp4`), R_OK).then(() => {
						hasMerged = true;
					}).catch(() => { });
					if (!hasMerged) { // Merge if not have done yet
						async function handleFFMPEG() {
							await previousSession.merge(DIR_NUM, clipInfo, basePath, detectGroupConfig.name);
							await previousSession.fade(DIR_NUM, clipInfo, basePath, detectGroupConfig.name);
							await previousSession.transcode(DIR_NUM, clipInfo, basePath, detectGroupConfig.name);
						}
						FFMPEG_Promises.push(handleFFMPEG());
					} else {
						let hasFaded = false;
						await fs.access(path.join(VOD_DIR, vodId, detectGroupConfig.name, "Steps", "2-Faded", `${DIR_NUM}.mp4`), R_OK).then(() => {
							hasFaded = true;
						}).catch(() => { });
						if (!hasFaded) { // Fade if not have done yet
							async function handleFFMPEG() {
								await previousSession.fade(DIR_NUM, clipInfo, basePath, detectGroupConfig.name);
								await previousSession.transcode(DIR_NUM, clipInfo, basePath, detectGroupConfig.name);
							}
							FFMPEG_Promises.push(handleFFMPEG());
						} else {
							let hasTranscoded = false;
							await fs.access(path.join(VOD_DIR, vodId, detectGroupConfig.name, "Steps", "3-TS", `${DIR_NUM}.mp4`), R_OK).then(() => {
								hasTranscoded = true;
							}).catch(() => { });
							if (!hasTranscoded) { // Transcode to ts if not have done yet
								FFMPEG_Promises.push(previousSession.transcode(DIR_NUM, clipInfo, basePath, detectGroupConfig.name));
							}
						}
					}
				}
			}
			await Promise.all(FFMPEG_Promises);
		}
		previousSession.handleClips(TS_DIR.length, detectGroupConfig.name);
	}
	/**
	 * Ran whenever you want the bot to start listening to the chat
	 */
	public async run() {
		console.log(`Bot is now running inside of these channels:`);
		for (let streamer of configuration.streamers) {
			console.log(` • ${streamer}`);
		}
		console.log("--------------------------------------------");
		await this._loop();
	}

	/**
	 * Loop and handle the events of the bot
	 */
	private async _loop() {
		await this.checkLiveStreams();
		setTimeout(this._loop.bind(this), configuration.loopTime);
	}

	/**
	 * Fires when a new message has been detected
	 * @param channel Channel from when the message was recieved at
	 * @param user The user who sent the message
	 * @param message The message which the user has sent
	 * @returns 
	 */
	private async onMessage(channel: string, user: string, message: string) {
		channel = channel.substring(1);
		const activeSession = this.activeSessions.get(channel);
		if (activeSession) {
			let streamerConfig = configuration.getStreamerConfig(channel);
			if (streamerConfig) {
				for (let groupConfig of streamerConfig.detectGroupConfigs) { // Go through every group
					let group = activeSession.groups.get(groupConfig.name)!;
					if (group.creatingClip) {
						continue;
					}
					message = message.toLowerCase();
					if (groupConfig.strings.some(v => message == v.toLowerCase())) { // If matching
						group.userMessages.set(user, true);
						break; // Only one group at a time at the moment
					}
				}
			} else {
				console.log(`Unable to get streamer config from streamer: ${channel}`);
			}
		}
	}

	/**
	 * Check if the stream is live by getting their stream
	 */
	private async checkLiveStreams() {
		let checkLiveStreamPromises = [];
		for (let [name, streamerChannel] of this.streamerChannels) {
			checkLiveStreamPromises.push(this.checkStream(name, streamerChannel));
		}
		await Promise.allSettled(checkLiveStreamPromises);
	}

	private async checkStream(name: string, streamerChannel: StreamerChannel) {
		let streamStatus = await streamerChannel.checkLiveStream(this.apiClient!);
		let session;
		switch (streamStatus) {
			case StreamStatus.NOW_LIVE: { // May go offline then online (Maybe ignore first couple of seconds for vod)
				console.log(`${name} is now live!`);
				let id;
				const streamId = streamerChannel.stream!.id;
				for (let i = 0; i < this.previousSessions.length; i++) {
					const session = this.previousSessions[i];
					if (session.id.toString() === streamId) {
						this.activeSessions.set(name, this.previousSessions.slice(i, 1)[0]);
						break;
					}
				}
				if (!this.activeSessions.get(name)) {
					let firstVod = (await (this.apiClient!.videos.getVideosByUser(streamerChannel.streamerId))).data[0];
					let hasVod = firstVod.streamId! === streamId;
					if (hasVod) {
						id = parseInt(firstVod.id);
						const VOD_DIR = path.resolve("vods", firstVod.id);
						await DirectoryHandler.attemptCreateDirectory(VOD_DIR);
						await fs.writeFile(path.join(VOD_DIR, "Info.json"), JSON.stringify({ Streamer: parseInt(streamerChannel.streamerId) }));
						console.log(`Created vod directory for ${streamerChannel.name}`);
					} else {
						id = parseInt(streamId);
						await DirectoryHandler.attemptCreateDirectory(path.resolve("streams", streamId));
						console.log(`Created stream directory for ${streamerChannel.name}`);
					}
					session = new StreamSession(streamerChannel, id, hasVod);
					this.activeSessions.set(name, session);
				}
			}
			case StreamStatus.STILL_LIVE: {
				session = this.activeSessions.get(streamerChannel.name)!;
				session.waitCreateChatRender(this.apiClient!, this.gqlOauth!);
				session.cycleCount = (session.cycleCount + 1) % configuration.cycleClipAmount;
				if (session.cycleCount === configuration.cycleClipAmount - 1) {
					this.checkMessageCounterAndClip(session); // Should wait 20 seconds before being able to create clip
				}
				break;
			}
			case StreamStatus.NOW_OFFLINE: {
				session = this.activeSessions.get(name)!;
				this.previousSessions.push(session);
				this.activeSessions.delete(name);
				console.log(`${name} is now offline!`);
			}
			case StreamStatus.STILL_OFFLINE: {
				break;
			}
		}
		this.handlePreviousSessions();
	}

	private async handlePreviousSessions() {
		for (const session of this.previousSessions) {
			session.waitCreateChatRender(this.apiClient!, this.gqlOauth!);
		}
		for (let i = 0; i < this.previousSessions.length; i++) {
			const session = this.previousSessions[i];
			if (session.clipQueue.isEmpty()) {
				for (const [groupName, group] of session.groups) {
					if (group.clipsCreated.length > 0) {
						session.groups.delete(groupName);
						session.handleClips(group.clipsCreated.length, groupName);
					}
				}
				this.previousSessions.splice(i, 1);
			}
		}
	}

	private async checkMessageCounterAndClip(streamSession: StreamSession) {
		const streamerConfig = configuration.getStreamerConfig(streamSession.streamerChannel.name);
		if (streamerConfig) {
			for (let groupConfig of streamerConfig.detectGroupConfigs) {
				let group = streamSession.groups.get(groupConfig.name)!;
				const counter = group.userMessages.size;
				if (counter >= streamerConfig.minimumUserCount + streamerConfig.userCountFunction(streamSession.streamerChannel.stream!.viewers)) {
					group.creatingClip = true;
					console.log(`[${counter}] Attempting to create a clip for: ${streamSession.streamerChannel.name} in group: ${groupConfig.name}`);
					let offset = new Date().getTime() - milliseconds_since_epoch_utc(streamSession.streamerChannel.stream!.startDate);
					streamSession.createClip(this.apiClient!, this.gqlOauth!, offset, group, groupConfig.name);
				}
				group.userMessages.clear();
			}
		}
	}
}
