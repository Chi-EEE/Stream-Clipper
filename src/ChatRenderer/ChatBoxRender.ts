import { promises as fs } from 'fs';
import { createCanvas, Canvas, Image, GlobalFonts } from "@napi-rs/canvas";

import path from 'path';
import { TwitchCommentInfo } from './TwitchCommentInfo';
import { TwitchEmote, ThirdPartyEmote, EmoteType } from './Emote';
import { HelixClip } from '@twurple/api/lib';
import { Badge } from './Badge';
import { Decoder } from '@chi_eee/gif-decoder';

const MAIN_STORE_PATH = path.basename("/chat_renders");

const x_offset = 20
const y_offset = 5

const width = 340
const height = 32 // 31.45 no decimals

const overflow_width = width - x_offset

const font_size = 13;
/// Change when font size is changed
const space_width = 4;
///

const REGULAR_FONT = `${font_size}px Inter`
const BOLD_FONT = `bold ${font_size}px Inter`
const defaultColors = ["#FF0000", "#0000FF", "#00FF00", "#B22222", "#FF7F50", "#9ACD32", "#FF4500", "#2E8B57", "#DAA520", "#D2691E", "#5F9EA0", "#1E90FF", "#FF69B4", "#8A2BE2", "#00FF7F"];

/**
 * Returns a hash code from a string
 * @param  {String} str The string to hash.
 * @return {Number}    A 32bit integer
 * @see http://werxltd.com/wp/2010/05/13/javascript-implementation-of-javas-string-hashcode-method/
 */
function hashCode(str: string) {
    let hash = 0;
    for (let i = 0, len = str.length; i < len; i++) {
        let chr = str.charCodeAt(i);
        hash = (hash << 5) - hash + chr;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
}

export class ChatBoxRender {
    private static clip: HelixClip;

    private static badges: Map<string, Badge>;
    private static third_party_emotes: Map<string, ThirdPartyEmote>;
    private static emotes: Map<string, TwitchEmote>;

    private static bold_canvas: Canvas;
    private static regular_canvas: Canvas;

    current_text_width: number;
    current_text_height: number;

    messages_to_render: Array<TextToRender | ImageRender>;
    gifs_to_render: Array<GifRender>;
    static setup(clip: HelixClip, bold_canvas: Canvas, regular_canvas: Canvas, badges: Map<string, Badge>, third_party_emotes: Map<string, ThirdPartyEmote>, emotes: Map<string, TwitchEmote>) {
        this.clip = clip;

        this.badges = badges;
        this.third_party_emotes = third_party_emotes;
        this.emotes = emotes;

        this.bold_canvas = bold_canvas;
        this.regular_canvas = regular_canvas;
    }

    constructor() {
        this.current_text_width = x_offset;
        this.current_text_height = y_offset;

        this.messages_to_render = new Array<TextToRender | ImageRender>();
        this.gifs_to_render = new Array<GifRender>();
    }

    async create(tmpDirPath: string, i: number, comment: TwitchCommentInfo) {
        await this.draw_badges(comment);

        this.write_username(comment.commenter.display_name, comment.message.user_color)

        await this.write_messages(comment);

        const final_height = height + (this.current_text_height - 5);
        const new_canvas = createCanvas(width, final_height);
        const new_ctx = new_canvas.getContext('2d');

        new_ctx.textBaseline = 'top';
        new_ctx.textAlign = 'left';

        for (let message_to_render of this.messages_to_render) {
            if (message_to_render instanceof TextToRender) {
                new_ctx.font = message_to_render.font;
                new_ctx.fillStyle = message_to_render.colour;
                new_ctx.fillText(message_to_render.text, message_to_render.x, message_to_render.y);
            } else if (message_to_render instanceof ImageRender) {
                new_ctx.drawImage(message_to_render.image, message_to_render.x, message_to_render.y);
            }
        }

        const buffer = new_canvas.toBuffer('image/png');
        await fs.writeFile(`${path.join(tmpDirPath, i.toString())}.png`, buffer);
        return { "gifs": this.gifs_to_render, "height": final_height }
    }

    private check_overflow(width: number) {
        if (this.current_text_width + width > overflow_width) {
            this.current_text_height += 20;
            this.current_text_width = x_offset;
            return true;
        }
        return false;
    }

    private async draw_badges(comment: TwitchCommentInfo) {
        if (comment.message.user_badges) {
            const ctx = ChatBoxRender.regular_canvas.getContext("2d");
            for (let badge of comment.message.user_badges) {
                const badge_info = ChatBoxRender.badges.get(`${badge._id}=${badge.version}`);
                if (badge_info) {
                    const file = await fs.readFile(badge_info.path);
                    const badge_icon = new Image()
                    badge_icon.src = file

                    this.check_overflow(badge_icon.width + 3);
                    this.messages_to_render.push(new ImageRender(badge_icon, this.current_text_width, this.current_text_height - 1.5))
                    this.current_text_width += badge_icon.width + 3;
                }
            }
        }
    }

    private write_username(username: string, user_color: string | null) {
        const ctx = ChatBoxRender.bold_canvas.getContext("2d");
        let message_to_render = new TextToRender(username, this.current_text_width, this.current_text_height);
        message_to_render.setColour(user_color != null ? user_color : defaultColors[Math.abs(hashCode(username)) % defaultColors.length]);
        message_to_render.setFont(BOLD_FONT);
        this.messages_to_render.push(message_to_render)
        this.current_text_width += ctx.measureText(username).width;
    }


    private async write_messages(comment: TwitchCommentInfo) {
        const ctx = ChatBoxRender.regular_canvas.getContext("2d");
        comment.message.fragments.unshift({ text: ": ", emoticon: null });
        for (var fragment of comment.message.fragments) {
            if (fragment.emoticon == null) { // No twitch emote
                var split_texts = fragment.text.split(/(\s+)/);
                for (let split_text of split_texts) {
                    if (split_text == "") {
                        continue;
                    }
                    if (split_text == " ") {
                        if (!this.check_overflow(space_width)) {
                            this.current_text_width += space_width;
                        }
                        continue;
                    }
                    const emote = ChatBoxRender.third_party_emotes.get(split_text);
                    if (emote) {
                        switch (emote.type) {
                            case EmoteType.PNG:
                                const file = await fs.readFile(`${path.join(path.basename("/cache"), "emotes", emote.id.toString())}.png`);
                                const emote_image = new Image()
                                emote_image.src = file

                                this.check_overflow(emote_image.width);
                                this.messages_to_render.push(new ImageRender(emote_image, this.current_text_width, this.current_text_height - 5))
                                this.current_text_width += emote_image.width;
                                break;
                            case EmoteType.GIF:
                                let emote_path_gif = path.join(path.basename("/cache"), "emotes", `${emote.id.toString()}.gif`);
                                const parsed_gif = Decoder.decode(emote_path_gif);

                                this.check_overflow(parsed_gif.lsd.width);
                                this.gifs_to_render.push(new GifRender(emote.id, this.current_text_width, this.current_text_height - 5));
                                this.current_text_width += parsed_gif.lsd.width;
                                break;
                            case EmoteType.NULL:
                                this.handle_text(split_text);
                                break;
                        }
                    } else {
                        this.handle_text(split_text);
                    }
                }
            } else { // Has twitch emote
                const emote = ChatBoxRender.emotes.get(fragment.emoticon.emoticon_id);
                if (emote != undefined) {
                    switch (emote.type) {
                        case EmoteType.PNG:
                            let emote_path_png = path.join(path.basename("/cache"), "emotes", `${fragment.emoticon.emoticon_id}.png`);
                            const file = await fs.readFile(emote_path_png);
                            const emote_image = new Image()
                            emote_image.src = file

                            this.check_overflow(emote_image.width); // Possible error here: emote_image is undefined
                            this.messages_to_render.push(new ImageRender(emote_image, this.current_text_width, this.current_text_height - 5))
                            this.current_text_width += emote_image.width;
                            break;
                        case EmoteType.GIF:
                            let emote_path_gif = path.join(path.basename("/cache"), "emotes", `${fragment.emoticon.emoticon_id}.gif`);
                            const parsed_gif = Decoder.decode(emote_path_gif);
                            this.check_overflow(parsed_gif.lsd.width);
                            this.gifs_to_render.push(new GifRender(fragment.emoticon.emoticon_id, this.current_text_width, this.current_text_height - 5));
                            this.current_text_width += parsed_gif.lsd.width;
                            break;
                        case EmoteType.NULL:
                            this.handle_text(fragment.text);
                            break;
                    }
                } else { // Broken twitch emote
                    this.handle_text(fragment.text);
                }
            }
        }
    }

    private handle_text(text: string) {
        const ctx = ChatBoxRender.regular_canvas.getContext("2d");
        const message_width = ctx.measureText(text).width;
        this.check_overflow(message_width);
        this.messages_to_render.push(new TextToRender(text, this.current_text_width, this.current_text_height))
        this.current_text_width += message_width;
    }
}

class TextToRender {
    text: string;
    x: number;
    y: number;
    colour: string = "#fff";
    font: string = REGULAR_FONT;
    constructor(text: string, x: number, y: number) {
        this.text = text;
        this.x = x;
        this.y = y;
    }

    setColour(colour: string) {
        this.colour = colour;
    }

    setFont(font: string) {
        this.font = font;
    }
}

export class ImageRender {
    image: Image;
    x: number;
    y: number;
    constructor(image: Image, x: number, y: number) {
        this.image = image;
        this.x = x;
        this.y = y;
    }
}

export class GifRender {
    id: string;
    x: number;
    y: number;
    constructor(id: string, x: number, y: number) {
        this.id = id;
        this.x = x;
        this.y = y;
    }
}