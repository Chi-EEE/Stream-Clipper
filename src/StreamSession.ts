import path from "path";
import { HelixClip, ApiClient } from "@twurple/api/lib";
import { ClipInfo } from "./ClipInfo";
import { DetectGroup } from "./DetectGroup";
import { DirectoryHandler } from "./DirectoryHandler";
import { StreamerChannel } from "./StreamerChannel";
import { Queue } from "./Queue";
import { configuration } from "../config/default";
import { delay, execPromise } from "./common";

const clipIdRegex = /https:\/\/clips\.twitch\.tv\/(.+)/;

export class StreamSession {
    readonly streamerChannel: StreamerChannel;
    readonly id: number;
    readonly hasVod: boolean;
    readonly groups: Map<string, DetectGroup> = new Map();

    cycleCount: number = 0;
    clipQueue: Queue<ClipInfo> = new Queue();

    constructor(streamerChannel: StreamerChannel, id: number, hasVod: boolean) {
        this.streamerChannel = streamerChannel;
        this.id = id;
        this.hasVod = hasVod;
        for (let detectGroupConfig of configuration.getStreamerConfig(streamerChannel.name)!.detectGroupConfigs) {
            this.groups.set(detectGroupConfig.name, new DetectGroup());
        }
    }
    private addClip(clip: HelixClip, offset: number, groupName: string, group: DetectGroup, isGQL: boolean) {
        group.clipsCreated.push(clip);
        this.clipQueue.enqueue(new ClipInfo(groupName, clip.id, offset, isGQL));
        console.log(`Program has added the clip ${clip.id} to the queue.`);
    }
    public async createClip(apiClient: ApiClient, gql_oauth: string, offset: number, group: DetectGroup, groupName: string) {
        if (this.hasVod) {
            await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("vods"), this.id.toString(), groupName));
        } else {
            await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("streams"), this.id.toString(), groupName));
        }
        try {
            const clipUrl = await apiClient.clips.createClip({ channelId: this.streamerChannel.streamerId, createAfterDelay: false });
            await delay(configuration.afterClippingCooldown)
            let clip = await apiClient.clips.getClipById(clipUrl);
            if (clip == null) {
                console.log("Attempting to recreate the clip.");
                // Retry to make clip
                const clipUrl = await apiClient.clips.createClip({ channelId: this.streamerChannel.streamerId, createAfterDelay: true });
                await delay(configuration.afterClippingCooldown)
                clip = await apiClient.clips.getClipById(clipUrl);
            }
            if (clip) {
                this.addClip(clip, offset, groupName, group, false);
                console.log(`Created the clip`);
            } else if (this.streamerChannel.stream) {
                await this.createClipAtOffset(apiClient, gql_oauth, offset, group, groupName);
            } else if (this.hasVod) {
                await this.createClipAtOffsetWithVideoId(apiClient, gql_oauth, offset, group, groupName);
            }
            group.creatingClip = false;
        } catch (error) {
            console.log(error);
            await this.createClipAtOffset(apiClient, gql_oauth, offset, group, groupName);
            group.creatingClip = false;
        }
    }
    public async createClipAtOffset(apiClient: ApiClient, gql_oauth: string, offset: number, group: DetectGroup, groupName: string) {
        try {
            let attempts = 0;
            do {
                let clipCreationResult = await fetch("https://gql.twitch.tv/gql", {
                    headers: { "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko", "Authorization": `OAuth ${gql_oauth}` },
                    body: `[{\"operationName\":\"createClip\",\"variables\":{\"input\":{\"broadcastID\":null,\"broadcasterID\":\"${this.streamerChannel.streamerId}\",\"offsetSeconds\":${offset}}},\"extensions\":{\"persistedQuery\":{\"version\":1,\"sha256Hash\":\"518982ccc596c07839a6188e075adc80475b7bc4606725f3011b640b87054ecf\"}}}]`,
                    method: "POST"
                }).then(res => res.json());
                let clipUrl: string = clipCreationResult[0].data["createClip"]["clip"]["url"];
                let clip = await apiClient.clips.getClipById(clipIdRegex.exec(clipUrl)![1]);
                await delay(configuration.afterClippingCooldown);
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
    public async createClipAtOffsetWithVideoId(apiClient: ApiClient, gql_oauth: string, offset: number, group: DetectGroup, groupName: string) {
        try {
            let attempts = 0;
            do {
                let clipCreationResult = await fetch("https://gql.twitch.tv/gql", {
                    headers: { "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko", "Authorization": `OAuth ${gql_oauth}` },
                    body: `[{\"operationName\":\"createClip\",\"variables\":{\"input\":{\"broadcastID\":null,\"broadcasterID\":\"${this.streamerChannel.streamerId}\",\"videoID\":\"${this.id}\",\"offsetSeconds\":${offset}}},\"extensions\":{\"persistedQuery\":{\"version\":1,\"sha256Hash\":\"518982ccc596c07839a6188e075adc80475b7bc4606725f3011b640b87054ecf\"}}}]`,
                    method: "POST"
                }).then(res => res.json());
                let clipUrl: string = clipCreationResult[0].data["createClip"]["clip"]["url"];
                let clip = await apiClient.clips.getClipById(clipIdRegex.exec(clipUrl)![1]);
                await delay(configuration.afterClippingCooldown);
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
    public async handleClips(groupName: string) {
        let group = this.groups.get(groupName)!;
        let basePath;
        if (this.hasVod) {
            basePath = path.join(path.basename("vods"), this.id.toString());
        } else {
            basePath = path.join(path.basename("streams"), this.id.toString());
        }
        let command = `ffmpeg -i "concat:`;
        if (group.clipsCreated.length > 1) {
            for (let i = 0; i < group.clipsCreated.length - 1; i++) {
                let positionCount = ((i + 1).toString()).padStart(3, "0");
                command += `${path.join(basePath, groupName, "Steps", "3-TS", positionCount)}.ts|`
            }
        }
        command += `${path.join(basePath, groupName, "Steps", "3-TS", (group.clipsCreated.length.toString()).padStart(3, "0"))}.ts"`;
        command += ` -c copy -bsf:a aac_adtstoasc `;
        command += `${path.join(basePath, groupName, "Final")}.mp4`;
        try {
            // Attempt to merge ts files into one
            const { _stdout, _stderr } = await execPromise(command);
        } catch (error) {
            console.log(error);
        }

    }
}