import { Config, DetectGroupConfig, get_random_int_inclusive, StreamerConfig } from "./_Config";

export const config = new Config();

config.loopTime = 5000;
config.cycleAmount = 12;
config.cycleCommentAmount = 5;
config.beforeClippingCooldown = 12000
config.afterClippingCooldown = 7500;

config.addStreamer(new StreamerConfig("xqc", [new DetectGroupConfig("Funny", ["OMEGALUL"])], 5, (viewerCount: number) => {
    return Math.ceil(viewerCount / 2500);
}, () => {
    return 5000 + get_random_int_inclusive(-250, 550);
}));