export function get_random_int_inclusive(min: number, max: number) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1) + min); //The maximum is inclusive and the minimum is inclusive
}

export class Config {
    streamers: Array<string> = [];
    streamerConfigs: Map<string, StreamerConfig> = new Map();

    clipDuration: number = 30;

    fadeDuration: number = 1;
    /**
     * Each loop is a cycle
     */
    loopTime: number = 0;
    /**
     * Amount of cycles before clipping (Also clears the count at the end of it)
     */
    cycleClipAmount: number = 0;
    /**
     * Amount of cycles before downloading and rendering chat messages
     */
    cycleCommentAmount: number = 0;
    /**
     * Amount of seconds in ms to wait after clipping
     */
    afterClippingCooldown: number = 0;
    public getStreamerConfig(name: string) {
        return this.streamerConfigs.get(name);
    }
    /**
     * 
     * @param streamerName 
     * @param detected_strings 
     */
    public addStreamer(streamerConfig: StreamerConfig) {
        this.streamers.push(streamerConfig.streamerName);
        this.streamerConfigs.set(streamerConfig.streamerName, streamerConfig);
    }
}

export class StreamerConfig {
    constructor(streamerName: string, detectGroupConfigs: Array<DetectGroupConfig>, minimumUserCount: number, userCountFunction: (viewerCount: number) => number, delayFunction: () => number) {
        this.streamerName = streamerName;
        this.detectGroupConfigs = detectGroupConfigs;
        this.minimumUserCount = minimumUserCount;
        this.userCountFunction = userCountFunction;
        this.delayFunction = delayFunction;
    }
    streamerName: string = "";
    detectGroupConfigs: Array<DetectGroupConfig> = [];
    minimumUserCount: number = 0;
    userCountFunction: (viewerCount: number) => number;
    delayFunction: () => number;
}

export class DetectGroupConfig {
    constructor(name: string, strings: Array<string>) {
        this.name = name;
        this.strings = strings;
    }
    name: string = "";
    /**
     * Must be lowercase
     */
    strings: Array<string> = [];
}