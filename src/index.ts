require('dotenv').config()

import { Bot } from './Bot';

const CLIENT_ID = process.env.CLIENT_ID as string;
const CLIENT_SECRET = process.env.CLIENT_SECRET as string;
const GQL_OAUTH = process.env.GQL_OAUTH as string;

async function main() {
    let bot = new Bot();

    await bot.initalise(CLIENT_ID, CLIENT_SECRET, GQL_OAUTH);
    bot.chat_client!.onRegister(async () => {
        await bot.run();
    })
    await bot.chat_client!.connect();
}
main();