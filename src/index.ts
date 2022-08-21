require('dotenv').config()

import path from 'path';
import { Bot } from './Bot';
import { DirectoryHandler } from './DirectoryHandler';

const CLIENT_ID = process.env.CLIENT_ID as string;
const CLIENT_SECRET = process.env.CLIENT_SECRET as string;

async function main() {
    await DirectoryHandler.attemptCreateDirectory(path.basename("cache"));
    await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("cache"), "emotes"));
    await DirectoryHandler.attemptCreateDirectory(path.join(path.basename("cache"), "badges"));

    let bot = new Bot();

    await bot.initalise(CLIENT_ID, CLIENT_SECRET);
    bot.chat_client!.onRegister(async () => {
        await bot.run();
    })
    await bot.chat_client!.connect();
}
main();