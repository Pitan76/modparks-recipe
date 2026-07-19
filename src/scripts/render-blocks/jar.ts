// Reading entries out of client.jar via `unzip`.

import { execSync } from 'child_process';
import path from 'path';

export const JAR_PATH = path.join(process.cwd(), 'client.jar');

export function readJarBuffer(entryPath: string): Buffer | null {
    try {
        return execSync(`unzip -p "${JAR_PATH}" "${entryPath}"`, { maxBuffer: 4 * 1024 * 1024 });
    } catch { return null; }
}

export function readJarJson(entryPath: string): any {
    const buf = readJarBuffer(entryPath);
    if (!buf) return null;
    try { return JSON.parse(buf.toString('utf-8')); }
    catch { return null; }
}
