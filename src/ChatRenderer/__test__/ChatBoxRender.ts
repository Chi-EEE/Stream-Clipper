require('dotenv').config()
import { RefreshingAuthProvider } from '@twurple/auth';
import { ApiClient } from '@twurple/api';
import { ChatRenderer } from '../ChatRenderer';
import { promises as fs } from 'fs';
import { ImageRenderer } from '../ImageRenderer';
import { ChatBoxRender } from '../ChatBoxRender';
import { createCanvas } from '@napi-rs/canvas';

const CLIENT_ID = process.env.CLIENT_ID as string;
const CLIENT_SECRET = process.env.CLIENT_SECRET as string;

const font_size = 13;

const REGULAR_FONT = `${font_size}px Inter, "Noto Color Emoji"`
const BOLD_FONT = `bold ${font_size}px Inter, "Noto Color Emoji"`

// const CLIP_ID = "DeterminedAlertBubbleteaYouDontSay-A4J1300K3hRLYze8"; // Broken clip with @napi-rs/canvas 
const CLIP_ID = "TacitSpikyDumplingsDancingBaby-VjyvCoU94CzpEpDo";

async function main() {
	const tokenData = JSON.parse(await fs.readFile('./tokens.json', "utf-8"));
	const authProvider = new RefreshingAuthProvider(
		{
			clientId: CLIENT_ID,
			clientSecret: CLIENT_SECRET,
			onRefresh: async newTokenData => await fs.writeFile('./tokens.json', JSON.stringify(newTokenData, null, 4), 'utf-8')
		},
		tokenData
	);
	const api_client = new ApiClient({ authProvider });
	const clip = await api_client.clips.getClipById(CLIP_ID);
	let imageRenderer = new ImageRenderer(clip!.broadcasterId);
	await imageRenderer.initalise();

	const bold_canvas = createCanvas(1, 1);
	bold_canvas.getContext("2d").font = BOLD_FONT;
	const regular_canvas = createCanvas(1, 1);
	regular_canvas.getContext("2d").font = REGULAR_FONT;

	ChatBoxRender.setup(bold_canvas, regular_canvas);
	const chatBox = new ChatBoxRender(imageRenderer);
	console.log("creating");
	await chatBox.create("", 0, {
		_id: '',
		created_at: '',
		updated_at: '',
		channel_id: '',
		content_type: '',
		content_id: '',
		content_offset_seconds: 0,
		commenter: {
			display_name: 'Chi',
			_id: '',
			name: '',
			type: '',
			bio: '',
			created_at: '',
			updated_at: '',
			logo: ''
		},
		source: '',
		state: '',
		message: {
			body: 'hey! 📣',
			fragments: [{ "text": "hey! 📣", emoticon: null }],
			is_action: false,
			user_badges: null,
			user_color: null,
			user_notice_params: {
				msg_id: ''
			},
			emoticons: null
		},
		more_replies: false
	})
	console.log("done");
}
main();