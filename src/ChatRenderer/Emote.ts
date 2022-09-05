
export enum EmoteType {
	PNG,
	GIF,
	NULL
}

export namespace EmoteType {
	const convertFromString = new Map<string, EmoteType>(
		[
			["jpeg", EmoteType.PNG],
			["png", EmoteType.PNG],
			["gif", EmoteType.GIF]
		]
	)
	export function fromString(type: string): EmoteType {
		const emote_type = convertFromString.get(type);
		if (emote_type != undefined) {
			return emote_type;
		} else {
			return EmoteType.NULL;
		}
	}
}

abstract class Emote {
	readonly type: EmoteType;
	constructor(type: EmoteType) {
		this.type = type;
	}
}

export class TwitchEmote extends Emote {
	constructor(type: EmoteType) {
		super(type);
	}
}

export class ThirdPartyEmote extends Emote {
	readonly id: string;
	readonly global: boolean;
	constructor(type: EmoteType, id: string, global: boolean) {
		super(type);
		this.id = id;
		this.global = global;
	}
}