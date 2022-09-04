import { promises as fs } from 'fs';
import { createCanvas, Canvas, Image, GlobalFonts } from "@napi-rs/canvas";

import path from 'path';
import { TwitchCommentFragment, TwitchCommentInfo } from './TwitchCommentInfo';
import { EmoteType } from './Emote';
import { Decoder } from '@chi_eee/gif-decoder';
import { configuration } from '../../config/default';
import { ImageRenderer } from './ImageRenderer';

const MAIN_STORE_PATH = path.basename("/chat_renders");

const X_OFFSET_LEFT = 20
const Y_OFFSET_TOP = 5

const width = 340
const DEFAULT_HEIGHT_CHATBOX = 32 // 31.45 no decimals

const overflow_width = width - X_OFFSET_LEFT

const font_size = 13;
/// Change when font size is changed
const SPACE_WIDTH = 4;
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
	/**
	 * Used to measure the width of the message / emote
	 */
	private static bold_canvas: Canvas;
	/**
	 * Used to measure the width of the message / emote
	 */
	private static regular_canvas: Canvas;

	imageRenderer: ImageRenderer;

	X_text_position: number = X_OFFSET_LEFT;
	Y_text_position: number = Y_OFFSET_TOP;

	canvas_height: number = Y_OFFSET_TOP;
	/**
	 * When an emote is taller than expected
	 */
	additional_height: number = 0;

	messages_to_render: Array<TextToRender | ImageRender> = new Array<TextToRender | ImageRender>();
	gifs_to_render: Array<GifRender> = new Array<GifRender>();
	static setup(bold_canvas: Canvas, regular_canvas: Canvas) {
		this.bold_canvas = bold_canvas;
		this.regular_canvas = regular_canvas;
	}

	constructor(imageRenderer: ImageRenderer) {
		this.imageRenderer = imageRenderer;
	}

	async create(tmpDirPath: string, i: number, comment: TwitchCommentInfo) {
		await this.draw_badges(comment);

		this.write_username(comment.commenter.display_name, comment.message.user_color)

		await this.write_messages(comment);

		const final_height = DEFAULT_HEIGHT_CHATBOX + (this.Y_text_position - 5);
		const new_canvas = createCanvas(width, DEFAULT_HEIGHT_CHATBOX + (this.canvas_height - 5) + this.additional_height);
		const new_ctx = new_canvas.getContext('2d');
		new_ctx.shadowColor = configuration.shadowColor;
		new_ctx.shadowBlur = configuration.shadowBlur;

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
		if (this.X_text_position + width > overflow_width) {
			this.Y_text_position += 26;
			this.canvas_height += 26;
			this.additional_height = 0;
			this.X_text_position = X_OFFSET_LEFT;
			return true;
		}
		return false;
	}

	private check_emote_height(emote_image_height: number) {
		if (emote_image_height > DEFAULT_HEIGHT_CHATBOX + this.additional_height) {
			this.additional_height = (emote_image_height - DEFAULT_HEIGHT_CHATBOX);
		}
	}

	private async draw_badges(comment: TwitchCommentInfo) {
		if (comment.message.user_badges) {
			for (const badge of comment.message.user_badges) {
				const badge_info = this.imageRenderer.badges.get(`${badge._id}=${badge.version}`);
				if (badge_info) {
					const file = await fs.readFile(badge_info.path);
					const badge_icon = new Image()
					badge_icon.src = file

					this.check_overflow(badge_icon.width + 3);
					this.messages_to_render.push(new ImageRender(badge_icon, this.X_text_position, this.Y_text_position - 1.5))
					this.X_text_position += badge_icon.width + 3;
				}
			}
		}
	}

	private write_username(username: string, user_color: string | null) {
		const ctx = ChatBoxRender.bold_canvas.getContext("2d");
		let message_to_render = new TextToRender(username, this.X_text_position, this.Y_text_position);
		message_to_render.setColour(user_color != null ? user_color : defaultColors[Math.abs(hashCode(username)) % defaultColors.length]);
		message_to_render.setFont(BOLD_FONT);
		this.messages_to_render.push(message_to_render)
		this.X_text_position += ctx.measureText(username).width;
	}


	private async write_messages(comment: TwitchCommentInfo) {
		comment.message.fragments.unshift({ text: ": ", emoticon: null });
		for (let fragment of comment.message.fragments as TwitchCommentFragment[]) {
			if (fragment.emoticon == null) { // No twitch emote
				let split_texts = fragment.text.split(/(\s+)/);
				for (let split_text of split_texts) {
					if (split_text == "") {
						continue;
					}
					if (split_text == " ") {
						if (!this.check_overflow(SPACE_WIDTH)) {
							this.X_text_position += SPACE_WIDTH;
						}
						continue;
					}
					let emotePath: string;
					const emote = this.imageRenderer.thirdPartyEmotes.get(split_text);
					if (emote) {
						switch (emote.type) {
							case EmoteType.PNG:
								if (emote.global) {
									emotePath = path.join(path.basename("/cache"), "emotes", "global", `${emote.id.toString()}.png`);
								} else {
									emotePath = path.join(path.basename("/cache"), "emotes", "bttv", this.imageRenderer.streamerId, `${emote.id.toString()}.png`);
								}
								const file = await fs.readFile(emotePath);
								const emote_image = new Image()
								emote_image.src = file

								this.check_overflow(emote_image.width);
								this.check_emote_height(emote_image.height);
								this.messages_to_render.push(new ImageRender(emote_image, this.X_text_position, this.Y_text_position - 5))
								this.X_text_position += emote_image.width;
								break;
							case EmoteType.GIF:
								if (emote.global) {
									emotePath = path.join(path.basename("/cache"), "emotes", "global", `${emote.id.toString()}.gif`);
								} else {
									emotePath = path.join(path.basename("/cache"), "emotes", "bttv", this.imageRenderer.streamerId, `${emote.id.toString()}.gif`);
								}
								const parsed_gif = Decoder.decode(emotePath);

								this.check_overflow(parsed_gif.lsd.width);
								this.gifs_to_render.push(new GifRender(emote.global, emote.id, this.X_text_position, this.Y_text_position - 5));
								this.X_text_position += parsed_gif.lsd.width;
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
				const emote = ImageRenderer.twitchEmotes.get(fragment.emoticon.emoticon_id);
				if (emote) {
					switch (emote.type) {
						case EmoteType.PNG:
							let emote_path_png = path.join(path.basename("/cache"), "emotes", "global", `${fragment.emoticon.emoticon_id}.png`);
							const file = await fs.readFile(emote_path_png);
							const emote_image = new Image()
							emote_image.src = file

							this.check_overflow(emote_image.width);
							this.check_emote_height(emote_image.height);
							this.messages_to_render.push(new ImageRender(emote_image, this.X_text_position, this.Y_text_position - 5))
							this.X_text_position += emote_image.width;
							break;
						case EmoteType.GIF:
							let emote_path_gif = path.join(path.basename("/cache"), "emotes", "global", `${fragment.emoticon.emoticon_id}.gif`);
							const parsed_gif = Decoder.decode(emote_path_gif);
							this.check_overflow(parsed_gif.lsd.width);
							this.gifs_to_render.push(new GifRender(true, fragment.emoticon.emoticon_id, this.X_text_position, this.Y_text_position - 5));
							this.X_text_position += parsed_gif.lsd.width;
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
		this.messages_to_render.push(new TextToRender(text, this.X_text_position, this.Y_text_position))
		this.X_text_position += message_width;
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
	global: boolean;
	id: string;
	x: number;
	y: number;
	constructor(global: boolean, id: string, x: number, y: number) {
		this.global = global;
		this.id = id;
		this.x = x;
		this.y = y;
	}
}