import { Config, DetectGroup, StreamerConfig } from "./_Config";

export const config = new Config();

config.setLoopTime(3);
config.setCycleAmount(1);
config.setCycleCommentAmount(40);
config.setBeforeClippingCooldown(12);
config.setAfterClippingCooldown(7.5);

config.addStreamer(new StreamerConfig("mesignup", [new DetectGroup("test1", ["1"]), new DetectGroup("test2", ["2"])], 1, (_viewerCount: number) => {
    return 0;
}, () => {
    return 1000;
}));