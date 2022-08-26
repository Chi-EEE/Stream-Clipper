import path from "path";
import { HelixClip, ApiClient } from "@twurple/api/lib";
import { ClipInfo } from "./ClipInfo";
import { DetectGroup } from "./DetectGroup";
import { DirectoryHandler } from "./DirectoryHandler";
import { StreamerChannel } from "./StreamerChannel";
import { Queue } from "./Queue";
import { configuration } from "../config/default";
import { delay, downloadClip, execPromise } from "./common";
import { ChatRenderer } from "./ChatRenderer/ChatRenderer";

const CLIP_ID_REGEX = /https:\/\/clips\.twitch\.tv\/(.+)/;

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
            if (this.streamerChannel.stream) {
                await this.createClipAtOffset(apiClient, gql_oauth, offset, group, groupName);
            } else if (this.hasVod) {
                await this.createClipAtOffsetWithVideoId(apiClient, gql_oauth, offset, group, groupName);
            }
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
                let clip = await apiClient.clips.getClipById(CLIP_ID_REGEX.exec(clipUrl)![1]);
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
                let clip = await apiClient.clips.getClipById(CLIP_ID_REGEX.exec(clipUrl)![1]);
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
    public async handleClips(group: DetectGroup, groupName: string) {
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

    public async waitCreateChatRender(apiClient: ApiClient, gqlOauth: string) {
        for (const clipInfo of this.clipQueue) {
            if (!clipInfo.handling) {
                clipInfo.cycleCount++;
                if (clipInfo.cycleCount >= configuration.cycleCommentAmount - 1) {
                    clipInfo.handling = true;
                    this.attemptCreateChatRender(apiClient, gqlOauth, clipInfo).finally(() => {
                        this.clipQueue.dequeue();
                    });
                } else {
                    break;
                }
            }
        }
    }

    private async attemptCreateChatRender(apiClient: ApiClient, gqlOauth: string, clipInfo: ClipInfo) {
        let group = this.groups.get(clipInfo.groupName)!;
        let helixClip = (await apiClient.clips.getClipById(clipInfo.clipId));
        if (!helixClip) {
            let streamerId = this.streamerChannel.stream!.userId;
            let firstVod = (await (apiClient.videos.getVideosByUser(streamerId))).data[0];
            if (firstVod.streamId! == this.streamerChannel.previousStream!.id) {
                await this.createClipAtOffsetWithVideoId(apiClient, gqlOauth, clipInfo.offset, group, clipInfo.groupName);
                await delay(configuration.afterClippingCooldown);
                helixClip = (await apiClient.clips.getClipById(clipInfo.clipId));
            }
            else {
                console.log(`Unable to retrieve latest stream vod for ${this.streamerChannel.name}`);
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
                await this.handleClip(positionCount, helixClip, clipInfo);
            } else {
                group.clipsCreated.splice(index);
                console.log(`Clip creation may be disabled for ${this.streamerChannel.name}`);
            }
        } else {
            console.log(`Clip id {${clipInfo.clipId}} does not exist in the clipsCreated array`);
        }
    }

    private async handleClip(positionCount: string, helixClip: HelixClip, clipInfo: ClipInfo) {
        try {
            let basePath;
            if (this.hasVod) {
                basePath = path.join(path.basename("vods"), this.id.toString());
            } else {
                basePath = path.join(path.basename("streams"), this.id.toString());
            }
            const groupName = clipInfo.groupName;
            await DirectoryHandler.attemptCreateDirectory(path.join(basePath, groupName, positionCount));
            await downloadClip(clipInfo.clipId, `${path.join(basePath, groupName, positionCount, clipInfo.clipId)}.mp4`);

            // Handle Chat Renderer
            await ChatRenderer.renderClip(this.streamerChannel.imageRenderer, helixClip, `${path.join(basePath, groupName, positionCount, "ChatRender")}.webm`);
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
}