import { promises as fs } from 'fs';
import fetch from 'node-fetch';

export class VideoHandler {
    public static async downloadMP4(download_url: string, result_dir: string) {
        const mp4_data = await fetch(download_url).then((response) => {
            return response.arrayBuffer();
        });

        await fs.writeFile(result_dir, Buffer.from(mp4_data), {
            encoding: 'binary'
        });
    }
}