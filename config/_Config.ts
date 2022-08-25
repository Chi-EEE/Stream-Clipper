export function get_random_int_inclusive(min: number, max: number) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1) + min); //The maximum is inclusive and the minimum is inclusive
}

export class Config {
    /**
     * Streamers that the bot is going to connect to
     */
    streamers: Array<string> = [];
    /**
     * The configs of individual streams
     */
    streamerConfigs: Map<string, StreamerConfig> = new Map();
    /**
     * Duration of the clip created
     */
    clipDuration: number = 30;
    /**
     * Duration of the fade in and out
     */
    fadeDuration: number = 1;
    /**
     * The background color of the chat render
     */
    fillColor: string = "rgba(0,0,0,0)";
    /**
     * The shadow color of the text and images
     */
    shadowColor: string = "";
    /**
     * The shadow blur around the text and images
     */
    shadowBlur: number = 0;
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