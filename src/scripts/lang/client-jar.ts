/**
 * @fileoverview 最新リリースの client.jar を取得するモジュール。
 *
 * バニラの en_us はアセットインデックスに無く jar の中にしか存在しないため、
 * `fetch-mc-data` を通さずにアイテム名だけ取り込みたい場合にも jar が必要になります。
 */

import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';

/** `fetch-mc-data` と同じ場所に置き、後続のスクリプトから再利用できるようにします。 */
export const CLIENT_JAR_PATH = path.join(process.cwd(), 'client.jar');

/**
 * JSONを取得します。
 * @param url 取得先URL
 */
async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/**
 * 最新リリースの client.jar のダウンロードURLを取得します。
 */
async function fetchLatestClientUrl(): Promise<string> {
  const manifest = await fetchJson<any>(MANIFEST_URL);
  const entry = manifest.versions.find((v: any) => v.id === manifest.latest.release);
  if (!entry) throw new Error(`Could not find version ${manifest.latest.release} in manifest`);

  const detail = await fetchJson<any>(entry.url);
  return detail.downloads.client.url;
}

/**
 * client.jar が手元に無ければダウンロードします。
 * 数百MBあるため、既にあるものは再取得しません。
 * @returns client.jar のパス
 */
export async function ensureClientJar(): Promise<string> {
  if (fs.existsSync(CLIENT_JAR_PATH)) {
    console.log(`Using existing ${CLIENT_JAR_PATH}`);
    return CLIENT_JAR_PATH;
  }

  const url = await fetchLatestClientUrl();
  console.log(`Downloading client JAR from ${url}...`);

  const res = await fetch(url);
  if (!res.body) throw new Error('Failed to get response body');

  const fileStream = fs.createWriteStream(CLIENT_JAR_PATH);
  const nodeStream = Readable.fromWeb(res.body as any);
  await new Promise<void>((resolve, reject) => {
    nodeStream.pipe(fileStream).on('finish', () => resolve()).on('error', reject);
  });

  return CLIENT_JAR_PATH;
}
