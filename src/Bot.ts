import { config } from '../config/default'
import { ApiClient, HelixClip, HelixStream } from '@twurple/api';
import { RefreshingAuthProvider } from '@twurple/auth';
import { ChatClient } from '@twurple/chat';
import { promises as fs } from 'fs';
import { FFmpeg } from './FFmpeg';
import { StreamerChannel, StreamStatus } from './StreamerChannel';
import { DirectoryHandler } from './DirectoryHandler';



const sleep = require('util').promisify(setTimeout)

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

    private streamerChannels: Map<string, StreamerChannel> = new Map();
    private activeStreamerChannels: Map<string, StreamerChannel> = new Map();

    /**
     * Initalises the chat client and api client for twitch
     * @param client_id Client id for the twitch bot
     * @param client_secret Client secret for the twitch bot
     */
    public async initalise(client_id: string, client_secret: string) {
        const tokenData = JSON.parse(await fs.readFile('./tokens.json', "utf-8"));
        const authProvider = new RefreshingAuthProvider(
            {
                clientId: client_id,
                clientSecret: client_secret,
                onRefresh: async newTokenData => await fs.writeFile('./tokens.json', JSON.stringify(newTokenData, null, 4), 'utf-8')
            },
            tokenData
        );
        this.api_client = new ApiClient({ authProvider });
        this.chat_client = new ChatClient({ authProvider, channels: config.streamers });
        this.chat_client.onMessage(this.onMessage.bind(this));
        for (let streamer of config.streamers) {
            this.streamerChannels.set(streamer, new StreamerChannel(streamer));
        }
    }

    /**
     * Ran whenever you want the bot to start listening to the chat
     */
    public async run() {
        console.log(`Bot is now running inside of these channels:`);
        for (let streamer of config.streamers) {
            console.log(`   • ${streamer}`);
        }
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
        if (streamerChannel && !streamerChannel.creatingClip) {
            let streamerConfig = config.getStreamerConfig(channel);
            if (streamerConfig) {
                for (let group of streamerConfig.detectGroups) { // Go through every group
                    if (group.strings.some(v => message.includes(v.toLowerCase()))) { // If matching
                        let groupDetected = streamerChannel.groupsDetected.get(group.name);
                        if (groupDetected == null) {
                            groupDetected = new Map();
                            streamerChannel.groupsDetected.set(group.name, groupDetected);
                            groupDetected.set(user, [message]);
                        } else {
                            let messages = groupDetected.get(user);
                            if (messages == null) {
                                groupDetected.set(user, [message]);
                            } else {
                                messages.push(message);
                            }
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
                if (streamerChannel.clipRequireCommentsQueue.length > 0) {
                    for (let clipInfo of streamerChannel.clipRequireCommentsQueue) {
                        clipInfo.cycleCount++;
                    }
                    while (streamerChannel.clipRequireCommentsQueue.length > 0) {
                        let clipInfo = streamerChannel.clipRequireCommentsQueue[0];
                        if (clipInfo.cycleCount == config.cycleCommentAmount - 1) {
                            streamerChannel.clipRequireCommentsQueue.shift();
                            await this.downloadAndCreateChatRender(streamerChannel, clipInfo.clip);
                        } else {
                            break;
                        }
                    }
                }
                streamerChannel.cycleCount = (streamerChannel.cycleCount + 1) % config.cycleAmount;
                if (streamerChannel.cycleCount == config.cycleAmount - 1) {
                    await this.checkMessageCounterAndClip(streamerChannel);
                }
                break;
            }
            case StreamStatus.NOW_OFFLINE: {
                this.activeStreamerChannels.delete(name);
                console.log(`${name} is now offline!`);
                let clipPromises = [];
                for (let [groupName, clipsCreated] of streamerChannel.groupsClipsCreated) {
                    if (clipsCreated.length > 1) {
                        clipPromises.push(this.handleClips(streamerChannel.previousStream!, clipsCreated, groupName));
                    }
                }
                await Promise.allSettled(clipPromises);
                streamerChannel.clear();
            }
            case StreamStatus.STILL_OFFLINE: {
                break;
            }
        }
    }

    private async downloadAndCreateChatRender(streamerChannel: StreamerChannel, clip: HelixClip) {
        let clipOffset = parseInt(clip.thumbnailUrl.match(/-(\d+)-/)![0]);

    }

    private async checkMessageCounterAndClip(streamerChannel: StreamerChannel) {
        const streamerConfig = config.getStreamerConfig(streamerChannel.name);
        if (streamerConfig) {
            for (let group of streamerConfig.detectGroups) {
                let groupDetected = streamerChannel.groupsDetected.get(group.name);
                if (groupDetected != null) {
                    const counter = groupDetected.size;
                    if (counter >= streamerConfig.minimumUserCount + streamerConfig.userCountFunction(streamerChannel.stream!.viewers)) {
                        streamerChannel.creatingClip = true;
                        console.log(`[${counter}] Attempting to create a clip for: ${streamerChannel.name} in group: ${group.name}`);
                        streamerChannel.groupsDetected.delete(group.name);
                        await streamerChannel.createClip(this.api_client!, group.name);
                    }
                }
            }
        }
    }

    private async handleClips(stream: HelixStream, clips_created: Array<HelixClip>, groupName: string) {
        let clip = clips_created[0];
        let ffmpeg = new FFmpeg(clips_created.length);
        ffmpeg.input_clip(`./streams/${stream.id}/${groupName}/001-${clip.id}.mp4`);

        if (clips_created.length == 2) {
            ffmpeg.format_command = `-filter_complex "[0:v]setpts=PTS-STARTPTS[v1];`;
            ffmpeg.format_command += `[1:v]format=yuva420p,fade=in:st=0:d=${config.fadeDuration}:alpha=1,setpts=PTS-STARTPTS+((${(26.006) - (config.fadeDuration)})/TB)[v2];`
            ffmpeg.overlay_command = `[v1][v2]overlay[v];`
            ffmpeg.audio_command = `[0:a][1:a]acrossfade=d=1[a]`;
            ffmpeg.input_clip(`./streams/${stream.id}/${groupName}/002-${clips_created[1].id}.mp4`);
        } else {
            ffmpeg.initalize();
            for (let i = 1; i < clips_created.length - 2; i++) {
                clip = clips_created[i];
                ffmpeg.input_clip(`./streams/${stream.id}/${groupName}/${(i + 1).toString().padStart(3, "0")}-${clip.id}.mp4`);
                ffmpeg.step_1(i);
            }
            ffmpeg.step_2();
            for (let i = clips_created.length - 2; i < clips_created.length; i++) {
                clip = clips_created[i];
                ffmpeg.input_clip(`./streams/${stream.id}/${groupName}/${(i + 1).toString().padStart(3, "0")}-${clip.id}.mp4`);
                ffmpeg.step_3(i);
            }
        }
        await ffmpeg.execute_command(`./streams/${stream.id}/${groupName}`);
    }
}