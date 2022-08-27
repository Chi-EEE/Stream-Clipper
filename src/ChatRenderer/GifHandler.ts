import path from 'path';

import { Canvas, createCanvas } from "@napi-rs/canvas";
import { Decoder, Frame } from '@chi_eee/gif-decoder';

const fps = (1 / 60) * 100

export class GifHandler {
    private gifs: Map<string, GifInformation> = new Map();

    constructor() {

    }

    async get(gif_id: string, gifPath: string) {
        let gif = this.gifs.get(gif_id);
        let parsed_gif;
        if (!gif) {
            parsed_gif = Decoder.decode(gifPath);
            gif = new GifInformation(parsed_gif.lsd.width, parsed_gif.lsd.height);
            this.gifs.set(gif_id, gif);
        }
        if (gif.using) {
            return gif.return_canvas;
        }
        gif.using = true;
        if (!parsed_gif) {
            parsed_gif = Decoder.decode(gifPath);
        }
        const frames = parsed_gif.frames;

        let frame_count = gif.frame_count % frames.length;

        let current_frame = frames[frame_count];

        const after_time = current_frame.gcd.delayTime - gif.time;
        if (after_time <= 0) {
            gif.updated = false;
            gif.time = after_time;
            gif.frame_count++;
            frame_count = gif.frame_count % frames.length;
            current_frame = frames[frame_count];
            if (frame_count == 0) {
                const ctx = gif.return_canvas.getContext("2d");
                ctx.clearRect(0, 0, parsed_gif.lsd.width, parsed_gif.lsd.height);
                gif.previous_frame = null;
                gif.previous_disposal_method = 0;
                gif.disposalRestoreFromIdx = 0;
            }
        }
        if (!gif.updated) {
            gif.updated = true;
            const current_frame_buffer = current_frame.decode();

            const ctx = gif.return_canvas.getContext("2d");

            switch (gif.previous_disposal_method) {
                case 3:
                    if (gif.disposalRestoreFromIdx > 0) {
                        let disposal_frame = frames[gif.disposalRestoreFromIdx];
                        const image = ctx.createImageData(disposal_frame.im.width, disposal_frame.im.height);
                        image.data.set(current_frame_buffer);
                        ctx.putImageData(image, disposal_frame.im.left, disposal_frame.im.top);
                    } else {
                        ctx.clearRect(0, 0, gif.lsd.width, gif.lsd.height);
                    }
                    break;
                case 2:
                    if (gif.previous_frame != null) {
                        ctx.clearRect(0, 0, gif.lsd.width, gif.lsd.height);
                    }
                default:
                    gif.disposalRestoreFromIdx = frame_count - 1;
                    break;
            }

            // Loop through pixels of ctx
            let image_data = ctx.getImageData(0, 0, gif.lsd.width, gif.lsd.height);
            if (frame_count == 0) {
                image_data.data.set(current_frame_buffer);
                ctx.putImageData(image_data, frame.im.left, frame.im.top);
            } else {
                let tempIndex = 0;
                for (let y = 0; y < gif.lsd.height; y++) {
                    for (let x = 0; x < gif.lsd.width; x++) {
                        if (x >= frame.im.left && y >= frame.im.top) {
                            if (x < frame.im.left + frame.im.width && y < frame.im.top + frame.im.height) {
                                let index = ((y * gif.lsd.width) + x) * 4;
                                if (current_frame_buffer[tempIndex + 3] == 255) {
                                    image_data.data[index] = current_frame_buffer[tempIndex];
                                    image_data.data[index + 1] = current_frame_buffer[tempIndex + 1];
                                    image_data.data[index + 2] = current_frame_buffer[tempIndex + 2];
                                    image_data.data[index + 3] = current_frame_buffer[tempIndex + 3];
                                }
                                tempIndex += 4;
                            }
                        }
                    }
                }
                ctx.putImageData(image_data, 0, 0);
            }

            gif.previous_disposal_method = current_frame.gcd.disposalMethod;
            gif.previous_frame = current_frame;
        }
        return gif.return_canvas;
    };

    next() {
        this.gifs.forEach((gif, gif_id) => {
            if (!gif.using) {
                this.gifs.delete(gif_id);
            } else {
                gif.using = false;
                gif.time = gif.time + fps;
            }
        });
    };
}
class GifInformation {
    constructor(width: number, height: number) {
        this.return_canvas = createCanvas(width, height);
    }
    return_canvas: Canvas;
    time: number = 0;
    frame_count: number = 0;

    previous_disposal_method: number = 0;
    previous_frame: Frame | null = null;
    disposalRestoreFromIdx: number = 0;

    using: boolean = false;
    updated: boolean = false;
}