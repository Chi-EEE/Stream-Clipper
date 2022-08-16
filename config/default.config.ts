import { Config, DetectGroup, get_random_int_inclusive, StreamerConfig } from "./_Config";

export const config = new Config();

config.setLoopTime(5);
config.setCycleAmount(12);
config.setBeforeClippingCooldown(12);
config.setAfterClippingCooldown(7.5);

config.addStreamer(new StreamerConfig("xqc", [new DetectGroup("Funny", ["OMEGALUL"])], 5, (viewerCount: number) => {
    return Math.ceil(viewerCount / 2500);
}, () => {
    return 5000 + get_random_int_inclusive(-250, 550);
}));