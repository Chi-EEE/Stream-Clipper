# twitch-chat-logger
Program which uses Discord.js and Twurple.js to log and upload chat logs to a discord channel.
## Usage
This program can be ran using the free dyno inside of [Heroku](https://dashboard.heroku.com/).
### Files needed to be created:
- .env
- token.json

### Content in the listed files:
**.env:**
```
clientId = ClientIdFromTwitch
clientSecret = ClientSecretFromTwitch
TOKEN = BotTokenFromDiscord
CHANNEL_ID = ChannelIdFromDiscord
STREAMER_NAME = StreamerNameFromTwitch
```
**token.json:**
```
{
	"accessToken": "0123456789abcdefghijABCDEFGHIJ",
	"refreshToken": "eyJfaWQmNzMtNGCJ9%6VFV5LNrZFUj8oU231/3Aj",
	"expiresIn": 0,
	"obtainmentTimestamp": 0
}
```
>The values in the listed files need to be changed in order for this program to run
>
>You may have to install the node modules if you're running this program locally

*This program was made using [Discord.js](https://discord.js.org/#/) and [Twurple.js](https://twurple.js.org/).*
