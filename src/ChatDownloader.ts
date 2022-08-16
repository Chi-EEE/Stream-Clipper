import { TwitchCommentInfo } from "./ChatRenderer/TwitchCommentInfo";

const fetch = require('node-fetch');

const TWITCH_COMMENTS_API = "https://api.twitch.tv/v5/videos";

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export class ChatDownloader {
    // From: https://github.com/lay295/TwitchDownloader/blob/master/TwitchDownloaderCore/ChatDownloader.cs
    static async downloadSection(videoId: number, videoStart: number, videoEnd: number) {
        let latestMessage = videoStart - 1;
        let isFirst = true;
        let cursor = "";
        let errorCount = 0;

        let comments = new Array<TwitchCommentInfo>();
        while (latestMessage < videoEnd) {
            let response;
            try {
                if (isFirst) {
                    response = await fetch(`${TWITCH_COMMENTS_API}/${videoId}/comments?content_offset_seconds=${videoStart}`, {
                        headers: {
                            "client-id": "kimne78kx3ncx6brgo4mv6wki5h1ko",
                            "content-type": "application/json; charset=UTF-8"
                        }
                    });
                }
                else {
                    response = await fetch(`${TWITCH_COMMENTS_API}/${videoId}/comments?cursor=${cursor}`, {
                        headers: {
                            "client-id": "kimne78kx3ncx6brgo4mv6wki5h1ko",
                            "content-type": "application/json; charset=UTF-8"
                        }
                    })
                }
                errorCount = 0;
            }
            catch (ex) {
                await delay(1000 * errorCount);
                errorCount++;
                if (errorCount >= 10)
                    throw ex;
                continue;
            }

            const commentResponse = await response.json();
            for (let [_, comment] of new Map([...Object.entries(commentResponse.comments)]) as any) {
                if (latestMessage < videoEnd && comment.content_offset_seconds > videoStart)
                    comments.push(comment);
                latestMessage = comment.content_offset_seconds;
            }
            if (commentResponse._next == null)
                break;
            else
                cursor = commentResponse._next;
            if (isFirst)
                isFirst = false;
        }
        return comments;
    }
}