import { config } from '../config/default'
import { ApiClient, HelixStream } from '@twurple/api';
import { DirectoryHandler } from './DirectoryHandler';
import { promises as fs } from 'fs';
import path from 'path';
import fetch from 'node-fetch';
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
                group.clipsCreated.push(clip);
                let positionCount = (group.clipsCreated.length.toString()).padStart(3, "0");
                await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("streams"), this.stream!.id, groupName, positionCount));
                await this.downloadClip(clip.id, `${path.join(path.basename("streams"), this.stream!.id, groupName, positionCount, clip.id)}.mp4`);
                this.clipQueue.enqueue(new ClipInfo(groupName, clip.id, offset));
                console.log(`Program has completed the download for the clip: ${clip.id}`);
            }
            console.log(`done`);
            group.creatingClip = false;
        } catch (error) {
            console.log(error);
            this.createClipAtOffset(apiClient, gql_oauth, offset, streamerId, group, groupName);
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
                    group.clipsCreated.push(clip);
                    let positionCount = (group.clipsCreated.length.toString()).padStart(3, "0");
                    await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("streams"), this.stream!.id, groupName, positionCount));
                    await this.downloadClip(clip.id, `${path.join(path.basename("streams"), this.stream!.id, groupName, positionCount, clip.id)}.mp4`);
                    this.clipQueue.enqueue(new ClipInfo(groupName, clip.id, offset));
                    console.log(`Program has completed the download for the clip: ${clip.id}`);
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
                    group.clipsCreated.push(clip);
                    let positionCount = (group.clipsCreated.length.toString()).padStart(3, "0");
                    await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("streams"), this.stream!.id, groupName, positionCount));
                    await this.downloadClip(clip.id, `${path.join(path.basename("streams"), this.stream!.id, groupName, positionCount, clip.id)}.mp4`);
                    this.clipQueue.enqueue(new ClipInfo(groupName, clip.id, offset));
                    console.log(`Program has completed the download for the clip: ${clip.id}`);
                    break;
                } else {
                    attempts++;
                }
            } while (attempts <= 3);
        } catch (error) {
            console.log(error);
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
}

export enum StreamStatus {
    NOW_LIVE,
    NOW_OFFLINE,
    STILL_LIVE,
    STILL_OFFLINE
}