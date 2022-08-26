import { ApiClient, HelixStream } from '@twurple/api';
import { ImageRenderer } from './ChatRenderer/ImageRenderer';


export class StreamerChannel {
    name: string;
    streamerId: string;

    previousStream: HelixStream | null = null;
    stream: HelixStream | null = null;

    imageRenderer: ImageRenderer;

    constructor(streamerId: string, name: string) {
        this.streamerId = streamerId;
        this.name = name;
        this.imageRenderer = new ImageRenderer(streamerId);
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
}

export enum StreamStatus {
    NOW_LIVE,
    NOW_OFFLINE,
    STILL_LIVE,
    STILL_OFFLINE
}