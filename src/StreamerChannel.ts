import { config } from '../config/default'
import { ApiClient, HelixClip, HelixStream } from '@twurple/api';
import { DirectoryHandler } from './DirectoryHandler';
import { VideoHandler } from './VideoHandler';
import path from 'path';

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export class StreamerChannel {
    name: string;
    previousStream: HelixStream | null = null;
    stream: HelixStream | null = null;

    groups: Map<string, DetectGroup> = new Map();
    clipRequireCommentsQueue: Array<ClipCycle> = new Array();

    cycleCount: number = 0;
    constructor(name: string) {
        this.name = name;
    }
    public async initalize() {
        if (this.stream != null) {
            await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("streams"), this.stream.id));
        } else {
            console.log(`Unable to initalize streamer channel from ${this.name}`); // Something went wrong somehow
        }
    }
    public clearGroups() {
        for (let [_groupName, group] of this.groups) {
            group.clear();
        }
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
    public async createClip(apiClient: ApiClient, group: DetectGroup, groupName: string) {
        await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("streams"), this.stream!.id, groupName));
        let attempts = 0;
        do {
            try {
                await delay(config.beforeClippingCooldown)
                if (!this.stream) {
                    console.log(`Cancelled creating clip for ${this.name}, They went offline`);
                    break;
                }
                const clip_url = await apiClient.clips.createClip({ channelId: this.stream!.userId, createAfterDelay: true });
                await delay(config.afterClippingCooldown)
                let clip = await apiClient.clips.getClipById(clip_url);
                if (clip) {
                    console.log(`Program has taken ${attempts} attempts to create a clip for ${this.name}`);
                    group.clipsCreated.push(clip);
                    let positionCount = (group.clipsCreated.length.toString()).padStart(3, "0");
                    await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("streams"), this.stream!.id, groupName, positionCount));
                    await this.downloadClip(clip.thumbnailUrl, `${path.join(path.basename("streams"), this.stream!.id, groupName, positionCount, clip.id)}.mp4`);
                    this.clipRequireCommentsQueue.push(new ClipCycle(groupName, positionCount, clip.id));
                    console.log(`Program has completed the download for the clip: ${clip.id}`);
                    break;
                } else {
                    attempts++;
                    await delay(1000 + (1000 * ((attempts * 2) - 1)));
                }
            } catch (err) {
                console.error(err);
                attempts++;
                await delay(1000 + (1000 * ((attempts * 2) - 1)));
            }
        } while (attempts <= 4);
        console.log(`done`);
        group.creatingClip = false;
    }

    private async downloadClip(clipThumbnailUrl: string, resultUrl: string) {
        const download_url = clipThumbnailUrl.replace(/-preview.*/gm, '.mp4');
        await VideoHandler.downloadMP4(download_url, resultUrl);
    }
}

export class ClipCycle {
    groupName: string;
    clipId: string;
    positionCount: string;
    cycleCount: number = 0;
    constructor(groupName: string, positionCount: string, clipId: string) {
        this.groupName = groupName;
        this.positionCount = positionCount;
        this.clipId = clipId;
    }
}

export class DetectGroup {
    creatingClip: boolean = false;
    clipsCreated: Array<HelixClip> = new Array();
    userMessages: Map<string, Array<string>> = new Map();
    public clear() {
        this.clipsCreated = new Array();
        this.userMessages = new Map();
    }
}

export enum StreamStatus {
    NOW_LIVE,
    NOW_OFFLINE,
    STILL_LIVE,
    STILL_OFFLINE
}