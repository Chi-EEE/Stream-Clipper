export class ClipInfo {
    groupName: string;
    clipId: string;
    offset: number;
    isGQL: boolean;
    cycleCount: number = 0;
    constructor(groupName: string, clipId: string, offset: number, isGQL: boolean) {
        this.groupName = groupName;
        this.clipId = clipId;
        this.offset = offset;
        this.isGQL = isGQL;
    }
}
