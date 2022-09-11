import { exec } from 'child_process';
import { promises as fs } from 'fs';
import { Queue } from "./Queue";

export function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export const execPromise = require('util').promisify(exec);

export function getRandomInt(min: number, max: number) {
	return Math.floor(Math.random() * max) + min;
}

const downloadClipQueue: Queue<() => void> = new Queue();
let downloadingClips = false;
// Source: https://github.com/lay295/TwitchDownloader/blob/master/TwitchDownloaderCore/TwitchHelper.cs#L76
export async function downloadClip(clipId: string, resultUrl: string) {
	if (!downloadingClips) {
		downloadingClips = true;
		(async function () {
			while (!downloadClipQueue.isEmpty()) {
				(downloadClipQueue.pop()!)();
				await delay(1000);
			}
			downloadingClips = false;
		})
	}
	return new Promise<void>((resolve) => {
		downloadClipQueue.push((async function () {
			let taskLinks = await fetch("https://gql.twitch.tv/gql", { method: 'POST', headers: { "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko" }, body: "[{\"operationName\":\"VideoAccessToken_Clip\",\"variables\":{\"slug\":\"" + clipId + "\"},\"extensions\":{\"persistedQuery\":{\"version\":1,\"sha256Hash\":\"36b89d2507fce29e5ca551df756d27c1cfe079e2609642b4390aa4c35796eb11\"}}}]" })
				.then(res => res.json());
			let downloadUrl = "";

			downloadUrl = taskLinks[0]["data"]["clip"]["videoQualities"][0]["sourceURL"].toString();

			downloadUrl += "?sig=" + taskLinks[0]["data"]["clip"]["playbackAccessToken"]["signature"] + "&token=" + taskLinks[0]["data"]["clip"]["playbackAccessToken"]["value"].toString();

			const mp4Data = await fetch(downloadUrl).then((response) => {
				return response.arrayBuffer();
			});

			await fs.writeFile(resultUrl, Buffer.from(mp4Data), {
				encoding: 'binary'
			});
			resolve();
		}))
	})
}