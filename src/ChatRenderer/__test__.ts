require('dotenv').config()
import { RefreshingAuthProvider } from '@twurple/auth';
import { ApiClient } from '@twurple/api';
import { ChatRenderer } from './ChatRenderer';
import { promises as fs } from 'fs';
import { ImageRenderer } from './ImageRenderer';

const CLIENT_ID = process.env.CLIENT_ID as string;
const CLIENT_SECRET = process.env.CLIENT_SECRET as string;

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
	if (clip != null) {
		await ChatRenderer.renderClip(imageRenderer, clip, "./Test.webm");
	} else {
		console.log(`Clip: ${CLIP_ID} is not available`);
	}
}
main();