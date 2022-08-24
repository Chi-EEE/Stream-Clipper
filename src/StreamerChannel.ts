import { config } from '../config/default'
import { ApiClient, HelixClip, HelixStream } from '@twurple/api';
import { DirectoryHandler } from './DirectoryHandler';
import { promises as fs } from 'fs';
import path from 'path';
import { Queue } from './Queue';
import { ClipInfo } from "./ClipInfo";
import { DetectGroup } from './DetectGroup';

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const clipIdRegex = /https:\/\/clips\.twitch\.tv\/(.+)/;

export class StreamerChannel {
    name: string;
    previousStream: HelixStream | null = null;
    stream: HelixStream | null = null;

    groups: Map<string, DetectGroup> = new Map();
    clipQueue: Queue<ClipInfo> = new Queue();

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
    private addClip(clip: HelixClip, offset: number, groupName: string, group: DetectGroup, isGQL: boolean) {
        group.clipsCreated.push(clip);
        this.clipQueue.enqueue(new ClipInfo(groupName, clip.id, offset, isGQL));
        console.log(`Program has added the clip ${clip.id} to the queue.`);
    }
    public async createClip(apiClient: ApiClient, gql_oauth: string, offset: number, streamerId: string, group: DetectGroup, groupName: string) {
        await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("streams"), this.stream!.id, groupName));
        try {
            const clipUrl = await apiClient.clips.createClip({ channelId: this.stream!.userId, createAfterDelay: false });
            await delay(config.afterClippingCooldown)
            if (!this.stream) {
                console.log(`Cancelled creating clip for ${this.name}, They went offline`);
                return;
            }
            let clip = await apiClient.clips.getClipById(clipUrl);
            if (clip == null) {
                console.log("Attempting to recreate the clip.");
                // Retry to make clip
                const clipUrl = await apiClient.clips.createClip({ channelId: this.stream!.userId, createAfterDelay: true });
                await delay(config.afterClippingCooldown)
                if (!this.stream) {
                    console.log(`Cancelled creating clip for ${this.name}, They went offline`);
                    return;
                }
                clip = await apiClient.clips.getClipById(clipUrl);
            }
            if (clip) {
                this.addClip(clip, offset, groupName, group, false);
                console.log(`Created the clip`);
            } else {
                await this.createClipAtOffset(apiClient, gql_oauth, offset, streamerId, group, groupName);
            }
            group.creatingClip = false;
        } catch (error) {
            console.log(error);
            await this.createClipAtOffset(apiClient, gql_oauth, offset, streamerId, group, groupName);
            group.creatingClip = false;
        }
    }
    public async createClipAtOffset(apiClient: ApiClient, gql_oauth: string, offset: number, streamerId: string, group: DetectGroup, groupName: string) {
        try {
            let attempts = 0;
            do {
                let clipCreationResult = await fetch("https://gql.twitch.tv/gql", {
                    headers: { "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko", "Authorization": `OAuth ${gql_oauth}` },
                    body: `[{\"operationName\":\"createClip\",\"variables\":{\"input\":{\"broadcastID\":null,\"broadcasterID\":\"${streamerId}\",\"offsetSeconds\":${offset}}},\"extensions\":{\"persistedQuery\":{\"version\":1,\"sha256Hash\":\"518982ccc596c07839a6188e075adc80475b7bc4606725f3011b640b87054ecf\"}}}]`,
                    method: "POST"
                }).then(res => res.json());
                let clipUrl: string = clipCreationResult[0].data["createClip"]["clip"]["url"];
                let clip = await apiClient.clips.getClipById(clipIdRegex.exec(clipUrl)![1]);
                await delay(config.afterClippingCooldown);
                if (clip) {
                    this.addClip(clip, offset, groupName, group, false);
                    console.log(`Created the clip`);
                    break;
                } else {
                    attempts++;
                }
            } while (attempts <= 3);
        } catch (error) {
            console.log(error);
        }
    }
    public async createClipAtOffsetWithVideoId(apiClient: ApiClient, gql_oauth: string, offset: number, streamerId: string, videoId: string, group: DetectGroup, groupName: string) {
        try {
            let attempts = 0;
            do {
                let clipCreationResult = await fetch("https://gql.twitch.tv/gql", {
                    headers: { "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko", "Authorization": `OAuth ${gql_oauth}` },
                    body: `[{\"operationName\":\"createClip\",\"variables\":{\"input\":{\"broadcastID\":null,\"broadcasterID\":\"${streamerId}\",\"videoID\":\"${videoId}\",\"offsetSeconds\":${offset}}},\"extensions\":{\"persistedQuery\":{\"version\":1,\"sha256Hash\":\"518982ccc596c07839a6188e075adc80475b7bc4606725f3011b640b87054ecf\"}}}]`,
                    method: "POST"
                }).then(res => res.json());
                let clipUrl: string = clipCreationResult[0].data["createClip"]["clip"]["url"];
                let clip = await apiClient.clips.getClipById(clipIdRegex.exec(clipUrl)![1]);
                await delay(config.afterClippingCooldown);
                if (clip) {
                    this.addClip(clip, offset, groupName, group, false);
                    console.log(`Created the clip`);
                    break;
                } else {
                    attempts++;
                }
            } while (attempts <= 3);
        } catch (error) {
            console.log(error);
        }
    }
}

export enum StreamStatus {
    NOW_LIVE,
    NOW_OFFLINE,
    STILL_LIVE,
    STILL_OFFLINE
}