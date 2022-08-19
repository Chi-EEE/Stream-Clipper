export function get_random_int_inclusive(min: number, max: number) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1) + min); //The maximum is inclusive and the minimum is inclusive
}

export class Config {
    streamers: Array<string> = [];
    streamerConfigs: Map<string, StreamerConfig> = new Map();

    fadeDuration: number = 1;

    loopTime: number = 0;
    cycleAmount: number = 0; // Amount of cycles before clipping
    cycleCommentAmount: number = 0;

    beforeClippingCooldown: number = 0;
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
    /**
     * 
     * @param seconds 
     */
    public setLoopTime(seconds: number) {
        this.loopTime = seconds * 1000;
    }
    /**
     * 
     * @param amount 
     */
    public setCycleAmount(amount: number) {
        this.cycleAmount = amount;
    }
    /**
     * 
     * @param amount 
     */
    public setCycleCommentAmount(amount: number) {
        this.cycleCommentAmount = amount;
    }
    /**
     * 
     * @param seconds 
     */
    public setBeforeClippingCooldown(seconds: number) {
        this.beforeClippingCooldown = seconds * 1000;
    }
    /**
     * @param seconds
     */
    public setAfterClippingCooldown(seconds: number) {
        this.afterClippingCooldown = seconds * 1000;
    }
}

export class StreamerConfig {
    constructor(streamerName: string, detectGroupConfigs: Array<DetectGroupConfigs>, minimumUserCount: number, userCountFunction: (viewerCount: number) => number, delayFunction: () => number) {
        this.streamerName = streamerName;
        this.detectGroupConfigs = detectGroupConfigs;
        this.minimumUserCount = minimumUserCount;
        this.userCountFunction = userCountFunction;
        this.delayFunction = delayFunction;
    }
    streamerName: string = "";
    detectGroupConfigs: Array<DetectGroupConfigs> = [];
    minimumUserCount: number = 0;
    userCountFunction: (viewerCount: number) => number;
    delayFunction: () => number;
}

export class DetectGroupConfigs {
    constructor(name: string, strings: Array<string>) {
        this.name = name;
        this.strings = strings;
    }
    name: string = "";
    strings: Array<string> = [];
}