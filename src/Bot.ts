import { configuration } from '../config/default'
import { ApiClient } from '@twurple/api';
import { RefreshingAuthProvider } from '@twurple/auth';
import { ChatClient } from '@twurple/chat';
import { promises as fs } from 'fs';

import { StreamerChannel, StreamStatus } from './StreamerChannel';
import path from 'path';
import { DirectoryHandler } from './DirectoryHandler';
import { StreamSession } from "./StreamSession";

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

		for (let streamer of configuration.streamers) {
			let helixUser = await this.apiClient.users.getUserByName(streamer);
			if (helixUser) {
				let streamerChannel = new StreamerChannel(helixUser.id, streamer);
				this.streamerChannels.set(streamer, streamerChannel);
			} else {
				console.log(`Unable to get the id for the streamer: ${streamer}`);
				process.exit(0);
			}
		}
		this.chatClient = new ChatClient({ authProvider, channels: configuration.streamers });
		this.chatClient.onMessage(this.onMessage.bind(this));
	}

	/**
	 * Ran whenever you want the bot to start listening to the chat
	 */
	public async run() {
		console.log(`Bot is now running inside of these channels:`);
		for (let streamer of configuration.streamers) {
			console.log(` • ${streamer}`);
		}
		console.log();
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
						let messages = group.userMessages.get(user);
						if (messages == null) {
							group.userMessages.set(user, [message]);
						} else {
							messages.push(message);
						}
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
				let firstVod = (await (this.apiClient!.videos.getVideosByUser(streamerChannel.streamerId))).data[0];
				let hasVod = firstVod.streamId! == streamId;
				if (hasVod) {
					id = parseInt(firstVod.id);
					await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("vods"), firstVod.id));
					console.log(`Created vod directory for ${streamerChannel.name}`);
				} else {
					id = parseInt(streamId);
					await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("streams"), streamId));
					console.log(`Created stream directory for ${streamerChannel.name}`);
				}
				session = new StreamSession(streamerChannel, id, hasVod);
				this.activeSessions.set(name, session);
				break;
			}
			case StreamStatus.STILL_LIVE: {
				session = this.activeSessions.get(streamerChannel.name)!;
				session.waitCreateChatRender(this.apiClient!, this.gqlOauth!);
				session.cycleCount = (session.cycleCount + 1) % configuration.cycleClipAmount;
				if (session.cycleCount == configuration.cycleClipAmount - 1) {
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
				for (let [groupName, group] of session.groups) {
					if (group.clipsCreated.length > 0) {
						session.groups.delete(groupName);
						session.handleClips(group, groupName);
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
