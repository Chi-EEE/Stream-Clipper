import { config } from '../config/default'
import { ApiClient, HelixClip } from '@twurple/api';
import { RefreshingAuthProvider } from '@twurple/auth';
import { ChatClient } from '@twurple/chat';
import { promises as fs } from 'fs';

import { StreamerChannel, StreamStatus } from './StreamerChannel';
import { DetectGroup } from "./DetectGroup";
import { ClipInfo } from "./ClipInfo";
import { ChatRenderer } from './ChatRenderer/ChatRenderer';
import { exec } from 'child_process';
import path from 'path';
import { DirectoryHandler } from './DirectoryHandler';

const execPromise = require('util').promisify(exec);

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

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
    private api_client: ApiClient | null = null;
    public chat_client: ChatClient | null = null;
    private gql_oauth: string | null = null;

    private streamerChannels: Map<string, StreamerChannel> = new Map();
    private activeStreamerChannels: Map<string, StreamerChannel> = new Map();

    /**
     * Initalises the chat client and api client for twitch
     * @param client_id Client id for the twitch bot
     * @param client_secret Client secret for the twitch bot
     */
    public async initalise(client_id: string, client_secret: string, gql_oauth: string) {
        const tokenData = JSON.parse(await fs.readFile('./tokens.json', "utf-8"));
        const authProvider = new RefreshingAuthProvider(
            {
                clientId: client_id,
                clientSecret: client_secret,
                onRefresh: async newTokenData => await fs.writeFile('./tokens.json', JSON.stringify(newTokenData, null, 4), 'utf-8')
            },
            tokenData
        );
        this.gql_oauth = gql_oauth;
        this.api_client = new ApiClient({ authProvider });
        this.chat_client = new ChatClient({ authProvider, channels: config.streamers });
        this.chat_client.onMessage(this.onMessage.bind(this));
        for (let streamer of config.streamers) {
            let streamerChannel = new StreamerChannel(streamer);
            this.streamerChannels.set(streamer, streamerChannel);
            for (let detectGroupConfig of config.getStreamerConfig(streamer)!.detectGroupConfigs) {
                streamerChannel.groups.set(detectGroupConfig.name, new DetectGroup());
            }
        }
    }

    /**
     * Ran whenever you want the bot to start listening to the chat
     */
    public async run() {
        console.log(`Bot is now running inside of these channels:`);
        for (let streamer of config.streamers) {
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
        setTimeout(this._loop.bind(this), config.loopTime);
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
        const streamerChannel = this.activeStreamerChannels.get(channel);
        if (streamerChannel) {
            let streamerConfig = config.getStreamerConfig(channel);
            if (streamerConfig) {
                for (let groupConfig of streamerConfig.detectGroupConfigs) { // Go through every group
                    let group = streamerChannel.groups.get(groupConfig.name)!;
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
        let streamStatus = await streamerChannel.checkLiveStream(this.api_client!);
        switch (streamStatus) {
            case StreamStatus.NOW_LIVE: {
                console.log(`${name} is now live!`);
                await streamerChannel.initalize();
                this.activeStreamerChannels.set(name, streamerChannel);
            }
            case StreamStatus.STILL_LIVE: {
                let clipQueue = streamerChannel.clipQueue;
                if (!clipQueue.isEmpty()) {
                    clipQueue.forEach((clip: ClipInfo) => {
                        clip.cycleCount++;
                    })
                    do {
                        let clip = clipQueue.peek();
                        if (clip.cycleCount >= config.cycleCommentAmount - 1) {
                            clipQueue.dequeue();
                            this.attemptCreateChatRender(streamerChannel, clip);
                        } else {
                            break;
                        }
                    } while (!clipQueue.isEmpty());
                }
                streamerChannel.cycleCount = (streamerChannel.cycleCount + 1) % config.cycleClipAmount;
                if (streamerChannel.cycleCount == config.cycleClipAmount - 1) {
                    await this.checkMessageCounterAndClip(streamerChannel);
                }
                break;
            }
            case StreamStatus.NOW_OFFLINE: {
                this.activeStreamerChannels.delete(name);
                console.log(`${name} is now offline!`);
                let clipQueue = streamerChannel.clipQueue;
                let chatRenderPromises: Array<Promise<void>> = new Array();
                clipQueue.forEach((clip: ClipInfo) => {
                    chatRenderPromises.push(this.attemptCreateChatRender(streamerChannel, clip));
                })
                await Promise.all(chatRenderPromises);
                for (let [groupName, group] of streamerChannel.groups) {
                    if (group.clipsCreated.length > 0) {
                        await this.handleClips(streamerChannel.previousStream!.id, group.clipsCreated, groupName); // Cannot async this because of memory limit of 16gb
                    }
                }
                streamerChannel.clearGroups();
            }
            case StreamStatus.STILL_OFFLINE: {
                break;
            }
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

    private async attemptCreateChatRender(streamerChannel: StreamerChannel, clipInfo: ClipInfo) {
        let group = streamerChannel.groups.get(clipInfo.groupName)!;
        let helixClip = (await this.api_client!.clips.getClipById(clipInfo.clipId));
        if (!helixClip) {
            let streamerId = streamerChannel.stream!.userId;
            let firstVod = (await (this.api_client!.videos.getVideosByUser(streamerId))).data[0];
            if (firstVod.streamId! == streamerChannel.previousStream!.id) {
                streamerChannel.createClipAtOffsetWithVideoId(this.api_client!, this.gql_oauth!, clipInfo.offset, streamerId, firstVod.id, group, clipInfo.groupName);
                await delay(config.afterClippingCooldown);
                helixClip = (await this.api_client!.clips.getClipById(clipInfo.clipId));
            }
            else {
                console.log(`Unable to retrieve latest stream vod for ${streamerChannel.name}`);
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
                this.handleClip(streamerChannel.stream!.id, positionCount, helixClip, clipInfo);
            } else {
                group.clipsCreated.splice(index);
                console.log(`Clip creation may be disabled for ${streamerChannel.name}`);
            }
        } else {
            console.log(`Clip id {${clipInfo.clipId}} does not exist in the clipsCreated array`);
        }
    }

    private async handleClip(streamId: string, positionCount: string, helixClip: HelixClip, clipInfo: ClipInfo) {
        try {
            await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("streams"), streamId, clipInfo.groupName, positionCount));
            await this.downloadClip(clipInfo.clipId, `${path.join(path.basename("streams"), streamId, clipInfo.groupName, positionCount, clipInfo.clipId)}.mp4`);

            // Handle Chat Renderer
            await ChatRenderer.renderClip(helixClip, `${path.join(path.basename("streams"), streamId, clipInfo.groupName, positionCount, "ChatRender")}.webm`);
            console.log("Finished rendering chat");

            await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("streams"), streamId, clipInfo.groupName, "Steps"));
            await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("streams"), streamId, clipInfo.groupName, "Steps", "1-Merged"));
            await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("streams"), streamId, clipInfo.groupName, "Steps", "2-Faded"));
            await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("streams"), streamId, clipInfo.groupName, "Steps", "3-TS"));

            console.log(`Attempting to merge the chat render to the clip: ${clipInfo.clipId}`);
            // Attempt to merge chat render to video (TL)
            await execPromise(`ffmpeg -i ${path.join(path.basename("streams"), streamId, clipInfo.groupName, positionCount, clipInfo.clipId)}.mp4 -vcodec libvpx -i ${path.join(path.basename("streams"), streamId, clipInfo.groupName, positionCount, "ChatRender")}.webm -filter_complex "overlay=0:0" ${path.join(path.basename("streams"), streamId, clipInfo.groupName, "Steps", "1-Merged", positionCount)}.mp4`);
            console.log(`Completed merging the chat render to the clip: ${clipInfo.clipId}`);

            let clipDuration = config.clipDuration;

            // Attempt to add fade at the start and end of the clipInfo
            await execPromise(`ffmpeg -i ${path.join(path.basename("streams"), streamId, clipInfo.groupName, "Steps", "1-Merged", positionCount)}.mp4 -vf "fade=t=in:st=0:d=${config.fadeDuration},fade=t=out:st=${clipDuration - config.fadeDuration}:d=${config.fadeDuration}" -c:a copy ${path.join(path.basename("streams"), streamId, clipInfo.groupName, "Steps", "2-Faded", positionCount)}.mp4`);
            console.log(`Completed adding the fade in and out to the clip: ${clipInfo.clipId}`);

            // Attempt to transcode mp4 to ts file
            await execPromise(`ffmpeg -i ${path.join(path.basename("streams"), streamId, clipInfo.groupName, "Steps", "2-Faded", positionCount)}.mp4 -c copy -bsf:v h264_mp4toannexb -f mpegts ${path.join(path.basename("streams"), streamId, clipInfo.groupName, "Steps", "3-TS", positionCount)}.ts`);
            console.log(`Completed creating the TS file for the clip: ${clipInfo.clipId}`);
        } catch (error) {
            console.log(error);
        }
    }

    private async checkMessageCounterAndClip(streamerChannel: StreamerChannel) {
        const streamerConfig = config.getStreamerConfig(streamerChannel.name);
        if (streamerConfig) {
            for (let groupConfig of streamerConfig.detectGroupConfigs) {
                let group = streamerChannel.groups.get(groupConfig.name)!;
                const counter = group.userMessages.size;
                if (counter >= streamerConfig.minimumUserCount + streamerConfig.userCountFunction(streamerChannel.stream!.viewers)) {
                    group.creatingClip = true;
                    console.log(`[${counter}] Attempting to create a clip for: ${streamerChannel.name} in group: ${groupConfig.name}`);
                    let offset = new Date().getTime() - milliseconds_since_epoch_utc(streamerChannel.stream!.startDate);
                    let streamerId = streamerChannel.stream!.userId;
                    streamerChannel.createClip(this.api_client!, this.gql_oauth!, offset, streamerId, group, groupConfig.name);
                }
                group.userMessages.clear();
            }
        }
    }

    private async handleClips(streamId: string, clips_created: Array<HelixClip>, groupName: string) {
        let command = `ffmpeg -i "concat:`;
        if (clips_created.length > 1) {
            for (let i = 0; i < clips_created.length - 1; i++) {
                let positionCount = ((i + 1).toString()).padStart(3, "0");
                command += `${path.join(path.basename("streams"), streamId, groupName, "Steps", "3-TS", positionCount)}.ts|`
            }
        }
        command += `${path.join(path.basename("streams"), streamId, groupName, "Steps", "3-TS", (clips_created.length.toString()).padStart(3, "0"))}.ts"`;
        command += ` -c copy -bsf:a aac_adtstoasc `;
        command += `${path.join(path.basename("streams"), streamId, groupName, "Final")}.mp4`;
        try {
            // Attempt to merge ts files into one
            const { _stdout, _stderr } = await execPromise(command);
        } catch (error) {
            console.log(error);
        }
    }
}