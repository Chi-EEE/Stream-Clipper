export interface TwitchCommentInfo {
    _id: string;
    created_at: string;
    updated_at: string;
    channel_id: string;
    content_type: string;
    content_id: string;
    content_offset_seconds: number;
    commenter: {
        display_name: string;
        _id: string;
        name: string;
        type: string;
        bio: string;
        created_at: string;
        updated_at: string;
        logo: string;
    };
    source: string;
    state: string;
    message: {
        body: string;
        fragments: Array<TwitchCommentFragment>;
        is_action: false;
        user_badges: Array<TwitchCommentBadge> | null;
        user_color: string | null;
        user_notice_params: {
            "msg-id": null;
        };
        emoticons: Array<TwitchEmoticon> | null;
    }
    more_replies: false | true;
}

export interface TwitchCommentFragment {
    text: string;
    emoticon: {
        emoticon_id: string;
        emoticon_set_id: string | null;
    } | null;
}

export interface TwitchCommentBadge {
    _id: string;
    version: string;
}

export interface TwitchEmoticon {
    _id: string;
    begin: number;
    end: number;
}
