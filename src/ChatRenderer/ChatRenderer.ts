import { exec } from "child_process";

import { promises as fs } from 'fs';
import path from 'path';

import tmp from 'tmp';

import { ChatBoxRender, GifRender } from "./ChatBoxRender";
import { ImageRenderer } from "./ImageRenderer";
import { ChatDownloader } from "../ChatDownloader";
import { GifHandler } from "./GifHandler";

const execPromise = require('util').promisify(exec);

import { HelixClip } from "@twurple/api"
import { createCanvas, Image } from "@napi-rs/canvas";
import { ClipInfo } from "../ClipInfo";

const MAIN_STORE_PATH = path.basename("/chat_renders");

const font_size = 13;
const REGULAR_FONT = `${font_size}px Inter`
const BOLD_FONT = `bold ${font_size}px Inter`

const fps = 1 / 60;

function getRandomInt(min: number, max: number) {
    return Math.floor(Math.random() * max) + min;
}

function milliseconds_since_epoch_utc(d: Date) {
    return d.getTime() + (d.getTimezoneOffset() * 60 * 1000);
}

const offset_regex = /-(\d+)-/;
export class ChatRenderer {
    static async renderClip(helixClip: HelixClip, resultUrl: string) {
        const channel_id = parseInt(helixClip.broadcasterId);
        const id = parseInt(helixClip.videoId);
        let offset_result = offset_regex.exec(helixClip.thumbnailUrl);
        if (id == NaN) {
            console.error(`Unable to get videoId from helixClip: ${helixClip.id}`);
            return;
        }
        if (offset_result == null || offset_result.length == 0) {
            console.error(`Unable to get offset from: ${helixClip.thumbnailUrl}, Twitch may have changed how to get offset.`);
            return;
        }
        let offset = parseInt(offset_result[1]); // Offset of the helixClip
        const comments = await ChatDownloader.downloadSection(id, offset - helixClip.duration, offset);// - helixClip.duration + 1);
        console.log("Finished downloading comments.");
        const badges = await ImageRenderer.getBadges(channel_id);
        console.log("Got twitch badges.");
        const third_party_emotes = await ImageRenderer.getThirdPartyEmotes(channel_id);
        console.log("Got third party emotes.");
        const emotes = await ImageRenderer.getEmotes(comments);
        console.log("Got emotes in helixClip.");
        await ImageRenderer.waitWriting();
        console.log("Finished waiting.");

        const bold_canvas = createCanvas(1, 1);
        bold_canvas.getContext("2d").font = BOLD_FONT;
        const regular_canvas = createCanvas(1, 1);
        regular_canvas.getContext("2d").font = REGULAR_FONT;

        const create_promises = new Array<Promise<any>>();

        ChatBoxRender.setup(helixClip, bold_canvas, regular_canvas, badges, third_party_emotes, emotes);
        let frameTmpDir = tmp.dirSync({ unsafeCleanup: true });
        let chatBoxTmpDir = tmp.dirSync({ unsafeCleanup: true });
        for (let i = 0; i < comments.length; i++) {
            let comment = comments[i];
            const chatBox = new ChatBoxRender();
            create_promises.push(chatBox.create(chatBoxTmpDir.name, i, comment));
        }
        const information = await Promise.allSettled(create_promises);
        console.log("Finished setting up chat box renders");
        const final_comments = new Array<TwitchComment>();
        for (let i = 0; i < information.length; i++) {
            let info = information[i] as any;
            final_comments.push(new TwitchComment(i, info.value.height, comments[i].content_offset_seconds, info.value.gifs))
        }

        console.log("Beginning small calculations: ", final_comments);
        let time = final_comments[0].content_offset_seconds;
        let update_time = 0;
        let maximum_time = final_comments[Math.max(0, final_comments.length - 1)].content_offset_seconds + 0.1;
        console.log("Done small calculations");

        let frame_count = 0;
        let random_frame_update = 0;

        const gif_handler = new GifHandler();

        const render_comments = new Array<TwitchComment>();
        const canvas = createCanvas(340, 600);
        const ctx = canvas.getContext("2d");
        let height = 600;
        while (time <= maximum_time) {
            ctx.clearRect(0, 0, canvas.width, canvas.height); // Colour the background
            if (update_time >= random_frame_update) {
                random_frame_update = fps * (getRandomInt(0, 5) + 11); // random update between 11 - 16 frames
                render_comments.length = 0;
                for (const comment of final_comments) {
                    if (comment.content_offset_seconds > time) {
                        break;
                    }
                    height -= comment.height;
                    render_comments.push(comment);
                    if (height < -final_comments[0].height) {
                        do {
                            height += final_comments[0].height;
                            final_comments.shift();
                            render_comments.shift();
                        } while (height < - final_comments[0].height);
                    }
                }
            }
            height = 600;
            for (let i = render_comments.length - 1; i >= 0; i--) {
                const comment = render_comments[i];
                const file = await fs.readFile(`${path.join(chatBoxTmpDir.name, comment.index.toString())}.png`);
                const chatbox = new Image();
                chatbox.src = file;
                height -= comment.height;
                ctx.drawImage(chatbox, 0, height);
                for (const gif of comment.gifs) {
                    const image = await gif_handler.get(gif.id);
                    ctx.drawImage(image, gif.x, height + gif.y);
                }
            }
            time += fps
            update_time += fps;
            const buffer = canvas.toBuffer('image/png');
            await fs.writeFile(`${path.join(frameTmpDir.name, frame_count.toString())}.png`, buffer);
            frame_count++;
            gif_handler.next();
            height = 600;
        }
        gif_handler.clear();
        console.log("Beginning to create chat render");
        try {
            const { _stdout, _stderr } = await execPromise(`ffmpeg -r 60 -i ${frameTmpDir.name}/%d.png -c:v libvpx -pix_fmt yuv420p -lossless 1 -c:v libvpx -crf 18 -b:v 2M -pix_fmt yuva420p -auto-alt-ref 0 "${resultUrl}"`);
        } catch (error) {
            console.log(error);
        }
        console.log("Completed creating chat render");
        chatBoxTmpDir.removeCallback();
        frameTmpDir.removeCallback();
        console.log("Cleaned up temporary files");
    }
}

class TwitchComment {
    index: number;
    height: number;
    content_offset_seconds: number;
    gifs: Array<GifRender>;
    constructor(index: number, height: number, content_offset_seconds: number, gifs: Array<GifRender>) {
        this.index = index;
        this.height = height;
        this.content_offset_seconds = content_offset_seconds;
        this.gifs = gifs;
    }
}