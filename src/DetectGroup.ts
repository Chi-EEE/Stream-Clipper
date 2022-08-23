import { HelixClip } from '@twurple/api';

export class DetectGroup {
    position: number = 0;
    creatingClip: boolean = false;
    clipsCreated: Array<HelixClip> = new Array();
    userMessages: Map<string, Array<string>> = new Map();
    public clear() {
        this.clipsCreated = new Array();
        this.userMessages = new Map();
    }
}
