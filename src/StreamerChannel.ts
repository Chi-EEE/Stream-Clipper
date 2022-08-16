import { config } from '../config/default'
import { ApiClient, HelixClip, HelixStream } from '@twurple/api';
import { DirectoryHandler } from './DirectoryHandler';
import { VideoHandler } from './VideoHandler';
const sleep = require('util').promisify(setTimeout)

export class StreamerChannel {
    name: string;
    previousStream: HelixStream | null = null;
    stream: HelixStream | null = null;

    groupsClipsCreated: Map<string, Array<HelixClip>> = new Map();
    groupsDetected: Map<string, Map<string, Array<string>>> = new Map();
    clipRequireCommentsQueue: Array<{ clip: HelixClip; cycleCount: number; }> = new Array();

    creatingClip: boolean = false;
    cycleCount: number = 0;
    constructor(name: string) {
        this.name = name;
    }
    public async initalize() {
        if (this.stream != null) {
            await DirectoryHandler.attemptCreateDirectory(`./streams/${this.stream.id}`);
        } else {
            console.log(`Unable to initalize streamer channel from ${this.name}`); // Something went wrong somehow
        }
    }
    public clear() {
        this.groupsClipsCreated.clear();
        this.groupsDetected.clear();
    }
    public async checkLiveStream(apiClient: ApiClient): Promise<StreamStatus> {
        this.previousStream = this.stream;
        this.stream = await apiClient.streams.getStreamByUserName(this.name);
        if (this.stream != null) {
            if (this.previousStream == null) {
                return StreamStatus.NOW_LIVE;
            }
            return StreamStatus.STILL_LIVE;
        } else {
            if (this.previousStream != null) {
                return StreamStatus.NOW_OFFLINE;
            }
            return StreamStatus.STILL_OFFLINE;
        }
    }
    public async createClip(apiClient: ApiClient, groupName: string) {
        DirectoryHandler.attemptCreateDirectory(`./streams/${this.stream!.id}/${groupName}`);
        let attempts = 0;
        do {
            try {
                await sleep(config.beforeClippingCooldown)
                const clip_url = await apiClient.clips.createClip({ channelId: this.stream!.userId, createAfterDelay: true });
                await sleep(config.afterClippingCooldown)
                let clip = await apiClient.clips.getClipById(clip_url);
                if (clip) {
                    console.log(`Program has taken ${attempts} attempts to create a clip for ${this.name}`);
                    let groupClipsCreated = this.groupsClipsCreated.get(groupName);
                    if (groupClipsCreated == null) {
                        groupClipsCreated = new Array();
                        groupClipsCreated.push(clip);
                        this.groupsClipsCreated.set(groupName, groupClipsCreated);
                    } else {
                        groupClipsCreated.push(clip);
                    }
                    await this.downloadClip(clip.thumbnailUrl, `./streams/${this.stream!.id}/${groupName}/${(groupClipsCreated.length.toString()).padStart(3, "0")}-${clip.id}.mp4`);
                    this.clipRequireCommentsQueue.push({ clip: clip, cycleCount: 0 });
                    console.log(`Program has completed the download for the clip: ${clip.id}`);
                    break;
                } else {
                    attempts++;
                    await sleep(1000 + (1000 * ((attempts * 2) - 1)));
                }
            } catch (err) {
                console.error(err);
                attempts++;
                await sleep(1000 + (1000 * ((attempts * 2) - 1)));
            }
        } while (attempts <= 4);
        console.log(`done`);
        this.creatingClip = false;
    }

    private async downloadClip(clipThumbnailUrl: string, resultUrl: string) {
        const download_url = clipThumbnailUrl.replace(/-preview.*/gm, '.mp4');
        await VideoHandler.downloadMP4(download_url, resultUrl);
    }
}

export enum StreamStatus {
    NOW_LIVE,
    NOW_OFFLINE,
    STILL_LIVE,
    STILL_OFFLINE
}