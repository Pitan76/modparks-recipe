/**
 * @fileoverview `unzip` コマンドを介して client.jar からエントリを読み取るユーティリティ。
 */

import { execSync } from 'child_process';
import path from 'path';

export const JAR_PATH = path.join(process.cwd(), 'client.jar');

/**
 * client.jar から指定されたパスのエントリのバイナリデータ（Buffer）を読み取ります。
 * @param entryPath エントリのパス
 */
export function readJarBuffer(entryPath: string): Buffer | null {
    try {
        return execSync(`unzip -p "${JAR_PATH}" "${entryPath}"`, { maxBuffer: 4 * 1024 * 1024 });
    } catch { return null; }
}

/**
 * client.jar から指定されたパスのエントリを読み取り、JSONとして解析します。
 * @param entryPath エントリのパス
 */
export function readJarJson(entryPath: string): any {
    const buf = readJarBuffer(entryPath);
    if (!buf) return null;
    try { return JSON.parse(buf.toString('utf-8')); }
    catch { return null; }
}
