import { configuration } from '../config/default'
import { ApiClient, HelixClip } from '@twurple/api';
import { RefreshingAuthProvider } from '@twurple/auth';
import { ChatClient } from '@twurple/chat';
import { promises as fs } from 'fs';

import { StreamerChannel, StreamStatus } from './StreamerChannel';
import { ClipInfo } from "./ClipInfo";
import { ChatRenderer } from './ChatRenderer/ChatRenderer';
import path from 'path';
import { DirectoryHandler } from './DirectoryHandler';
import { StreamSession } from "./StreamSession";
import { delay, execPromise } from './common';

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
            case StreamStatus.NOW_LIVE: {
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
                await this.waitCreateChatRender(session);
                session.cycleCount = (session.cycleCount + 1) % configuration.cycleClipAmount;
                if (session.cycleCount == configuration.cycleClipAmount - 1) {
                    await this.checkMessageCounterAndClip(session);
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
                for (let i = 0; i < this.previousSessions.length; i++) {
                    const session = this.previousSessions[i];
                    await this.waitCreateChatRender(session);
                    if (session.clipQueue.isEmpty()) {
                        for (let [groupName, group] of session.groups) {
                            if (group.clipsCreated.length > 0) {
                                await session.handleClips(groupName); // Cannot async this because of memory limit of 16gb
                            }
                        }
                        this.previousSessions.splice(i, 1);
                    }
                }
                break;
            }
        }
    }

    private async waitCreateChatRender(session: StreamSession) {
        let clipQueue = session.clipQueue;
        if (!clipQueue.isEmpty()) {
            for (const clipInfo of clipQueue) {
                clipInfo.cycleCount++;
            }
            do {
                let clip = clipQueue.front()!;
                if (clip.cycleCount >= configuration.cycleCommentAmount - 1) {
                    clipQueue.dequeue();
                    this.attemptCreateChatRender(session, clip);
                } else {
                    break;
                }
            } while (!clipQueue.isEmpty());
        }
    }

    // Source: https://github.com/lay295/TwitchDownloader/blob/master/TwitchDownloaderCore/TwitchHelper.cs#L76
    private async downloadClip(clipId: string, resultUrl: string) {
        let taskLinks = await fetch("https://gql.twitch.tv/gql", { method: 'POST', headers: { "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko" }, body: "[{\"operationName\":\"VideoAccessToken_Clip\",\"variables\":{\"slug\":\"" + clipId + "\"},\"extensions\":{\"persistedQuery\":{\"version\":1,\"sha256Hash\":\"36b89d2507fce29e5ca551df756d27c1cfe079e2609642b4390aa4c35796eb11\"}}}]" })
            .then(res => res.json());
        let downloadUrl = "";

        downloadUrl = taskLinks[0]["data"]["clip"]["videoQualities"][0]["sourceURL"].toString();

        downloadUrl += "?sig=" + taskLinks[0]["data"]["clip"]["playbackAccessToken"]["signature"] + "&token=" + taskLinks[0]["data"]["clip"]["playbackAccessToken"]["value"].toString();

        const mp4Data = await fetch(downloadUrl).then((response) => {
            return response.arrayBuffer();
        });

        await fs.writeFile(resultUrl, Buffer.from(mp4Data), {
            encoding: 'binary'
        });
    }

    private async attemptCreateChatRender(session: StreamSession, clipInfo: ClipInfo) {
        let group = session.groups.get(clipInfo.groupName)!;
        let helixClip = (await this.apiClient!.clips.getClipById(clipInfo.clipId));
        if (!helixClip) {
            let streamerId = session.streamerChannel.stream!.userId;
            let firstVod = (await (this.apiClient!.videos.getVideosByUser(streamerId))).data[0];
            if (firstVod.streamId! == session.streamerChannel.previousStream!.id) {
                session.createClipAtOffsetWithVideoId(this.apiClient!, this.gqlOauth!, clipInfo.offset, group, clipInfo.groupName);
                await delay(configuration.afterClippingCooldown);
                helixClip = (await this.apiClient!.clips.getClipById(clipInfo.clipId));
            }
            else {
                console.log(`Unable to retrieve latest stream vod for ${session.streamerChannel.name}`);
            }
        }
        let index: number = -1;
        for (let i = 0; i < group.clipsCreated.length; i++) {
            let groupClipInfo = group.clipsCreated[i];
            if (clipInfo.clipId == groupClipInfo.id) {
                index = i;
                break;
            }
        }
        if (index >= 0) {
            if (helixClip) {
                let positionCount = (index + 1).toString().padStart(3, "0");
                this.handleClip(session, positionCount, helixClip, clipInfo);
            } else {
                group.clipsCreated.splice(index);
                console.log(`Clip creation may be disabled for ${session.streamerChannel.name}`);
            }
        } else {
            console.log(`Clip id {${clipInfo.clipId}} does not exist in the clipsCreated array`);
        }
    }

    private async handleClip(session: StreamSession, positionCount: string, helixClip: HelixClip, clipInfo: ClipInfo) {
        try {
            let basePath;
            if (session.hasVod) {
                basePath = path.join(path.basename("vods"), session.id.toString());
            } else {
                basePath = path.join(path.basename("streams"), session.id.toString());
            }
            const groupName = clipInfo.groupName;
            await DirectoryHandler.attemptCreateDirectory(path.join(basePath, groupName, positionCount));
            await this.downloadClip(clipInfo.clipId, `${path.join(basePath, groupName, positionCount, clipInfo.clipId)}.mp4`);

            // Handle Chat Renderer
            await ChatRenderer.renderClip(session.streamerChannel.imageRenderer, helixClip, `${path.join(basePath, groupName, positionCount, "ChatRender")}.webm`);
            console.log("Finished rendering chat");

            await DirectoryHandler.attemptCreateDirectory(path.join(basePath, groupName, "Steps"));
            await DirectoryHandler.attemptCreateDirectory(path.join(basePath, groupName, "Steps", "1-Merged"));
            await DirectoryHandler.attemptCreateDirectory(path.join(basePath, groupName, "Steps", "2-Faded"));
            await DirectoryHandler.attemptCreateDirectory(path.join(basePath, groupName, "Steps", "3-TS"));

            console.log(`Attempting to merge the chat render to the clip: ${clipInfo.clipId}`);
            // Attempt to merge chat render to video (TL)
            await execPromise(`ffmpeg -i ${path.join(basePath, groupName, positionCount, clipInfo.clipId)}.mp4 -vcodec libvpx -i ${path.join(basePath, groupName, positionCount, "ChatRender")}.webm -filter_complex "overlay=0:0" ${path.join(basePath, groupName, "Steps", "1-Merged", positionCount)}.mp4`);
            console.log(`Completed merging the chat render to the clip: ${clipInfo.clipId}`);

            let clipDuration = configuration.clipDuration;

            // Attempt to add fade at the start and end of the clipInfo
            await execPromise(`ffmpeg -i ${path.join(basePath, groupName, "Steps", "1-Merged", positionCount)}.mp4 -vf "fade=t=in:st=0:d=${configuration.fadeDuration},fade=t=out:st=${clipDuration - configuration.fadeDuration}:d=${configuration.fadeDuration}" -c:a copy ${path.join(basePath, groupName, "Steps", "2-Faded", positionCount)}.mp4`);
            console.log(`Completed adding the fade in and out to the clip: ${clipInfo.clipId}`);

            // Attempt to transcode mp4 to ts file
            await execPromise(`ffmpeg -i ${path.join(basePath, groupName, "Steps", "2-Faded", positionCount)}.mp4 -c copy -bsf:v h264_mp4toannexb -f mpegts ${path.join(basePath, groupName, "Steps", "3-TS", positionCount)}.ts`);
            console.log(`Completed creating the TS file for the clip: ${clipInfo.clipId}`);
        } catch (error) {
            console.log(error);
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
