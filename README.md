# Stream Clipper
This program uses Twurple.js to get the amount of emotes that have been spammed and it clips the moment. When the streamer goes offline, the program merges the videos together to create one giant video.
## Usage
In the config folder, there is a ```template.config.ts``` file. 

You can set the streamers you'd like to track and add different DetectGroups to each one!
### Files needed to be created:
- .env
- token.json

### Content in the listed files:
**.env:**
```
CLIENT_ID = ...
CLIENT_SECRET = ...
GQL_OAUTH = ... # https://github.com/streamlink/streamlink/discussions/4400#discussioncomment-2377338
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
>You may have to install the ffmpeg to allow the program to handle videos

*This program was made using [Twurple.js](https://twurple.js.org/) and Typescript!*
