export class ClipInfo {
	groupName: string;
	clipId: string;
	offset: number | undefined;

	cycleCount: number = 0;
	constructor(groupName: string, clipId: string, offset?: number) {
		this.groupName = groupName;
		this.clipId = clipId;
		this.offset = offset;
	}
}
