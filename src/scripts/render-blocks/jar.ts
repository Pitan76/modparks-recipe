/**
 * @fileoverview client.jar からエントリを読み取るユーティリティ。
 *
 * 以前は外部の `unzip` コマンドに依存していましたが、Windows など unzip が無い環境でも
 * 動くように、純JS の fflate でzipを読みます。jar は一度だけ読み込んでキャッシュします。
 */

import fs from 'fs';
import path from 'path';
import { unzipSync, type Unzipped } from 'fflate';

export const JAR_PATH = path.join(process.cwd(), 'client.jar');

/** 展開済みエントリのキャッシュ（プロセス内で1回だけ jar を読む）。 */
let entriesCache: Unzipped | null = null;

/**
 * client.jar を（初回のみ）読み込み、全エントリを展開してキャッシュを返します。
 * jar が存在しない・読めない場合は null。
 */
function loadEntries(): Unzipped | null {
    if (entriesCache) return entriesCache;
    try {
        const buf = fs.readFileSync(JAR_PATH);
        entriesCache = unzipSync(new Uint8Array(buf));
        return entriesCache;
    } catch {
        return null;
    }
}

/**
 * client.jar から指定されたパスのエントリのバイナリデータ（Buffer）を読み取ります。
 * @param entryPath エントリのパス
 */
export function readJarBuffer(entryPath: string): Buffer | null {
    const entries = loadEntries();
    if (!entries) return null;
    const data = entries[entryPath];
    if (!data) return null;
    return Buffer.from(data);
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
