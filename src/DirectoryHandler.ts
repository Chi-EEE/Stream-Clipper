import { promises as fs, constants } from 'fs';

export class DirectoryHandler {
    public static async exists(dir: string) {
        try {
            await fs.access(dir, constants.R_OK)
        } catch {
            return false;
        }
        return true;
    }

    public static async attemptCreateDirectory(dir: string) {
        if (!await this.exists(dir)) {
            await fs.mkdir(dir, { recursive: true });
        }
    }
}