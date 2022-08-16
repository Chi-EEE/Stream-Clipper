import { config } from '../config/default';
import { exec } from "child_process";
const execPromise = require('util').promisify(exec);

const FADE_DURATION_TIME = 1;

export class FFmpeg {
    start_command: string = "ffmpeg ";
    format_command: string = "";
    overlay_command: string = "";
    audio_command: string = "";
    maximum_length: number;
    public constructor(maximum_length: number) {
        this.maximum_length = maximum_length;
    }

    public initalize() {
        this.format_command = `-filter_complex "[0:v]setpts=PTS-STARTPTS[v1];`;
        this.overlay_command = `[v1][v2]overlay[o1];`
        this.audio_command = `[0:a][1:a]acrossfade=d=1[a1];`;
    }

    public input_clip(clip_dir: string) {
        this.start_command += `-i ${clip_dir} `;
    }

    public step_1(i: number) {
        this.format_command += `[${i}:v]format=yuva420p,fade=in:st=0:d=${config.fadeDuration}:alpha=1,setpts=PTS-STARTPTS+((${(26.006 * i) - (i * FADE_DURATION_TIME)})/TB)[v${i + 1}];`
        this.overlay_command += `[o${i}][v${i + 2}]overlay,format=yuv420p[o${i + 1}];`
        this.audio_command += `[a${i}][${i + 1}:a]acrossfade=d=${FADE_DURATION_TIME}[a${i + 1}];`
    }

    public step_2() {
        this.overlay_command += `[o${this.maximum_length - 2}][v${this.maximum_length}]overlay,format=yuv420p[v];`
        this.audio_command += `[a${this.maximum_length - 2}][${this.maximum_length - 1}:a]acrossfade=d=${FADE_DURATION_TIME}[a]`
    }

    public step_3(i: number) {
        this.format_command += `[${i}:v]format=yuva420p,fade=in:st=0:d=${FADE_DURATION_TIME}:alpha=1,setpts=PTS-STARTPTS+((${(26.006 * i) - (i * FADE_DURATION_TIME)})/TB)[v${i + 1}];`
    }

    public async execute_command(dir_name: string) {
        try {
            const { stdout, stderr } = await execPromise(`${this.start_command}${this.format_command}${this.overlay_command}${this.audio_command}" -map [v] -map [a] ${dir_name}/merged.mp4`);
        } catch (error) {
            console.log(error);
        }
    }
}