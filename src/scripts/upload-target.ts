/**
 * @fileoverview パイプラインスクリプトの出力先を制御し、アップロード処理を抽象化するモジュール。
 *
 * デフォルトでは R2 に S3 経由で直接通信するため、R2 アクセスキーが必要です。
 * 環境変数 `MP_RECIPE_URL` を設定すると、Worker の認証付き一括書き込み API に切り替わります。
 * この場合はアップロード用シークレットのみが必要となり、R2 認証情報を持たないマシンからパイプラインを実行する際に便利です。
 */

import dotenv from 'dotenv';
import { uploadToR2, runPool } from './r2';

dotenv.config();

const API_URL = process.env.MP_RECIPE_URL?.replace(/\/$/, '');
const SECRET = process.env.UPLOAD_SECRET || process.env.ADMIN_SECRET;

/** HTTP経由でアップロードする際、1回の一括リクエストに含まれるオブジェクト数。 */
const BATCH_SIZE = 50;

/**
 * 現在設定されているアップロード先の簡単な説明を取得します。
 */
export function describeTarget(): string {
  return API_URL ? `write API at ${API_URL}` : 'R2 (S3 credentials)';
}

/**
 * `assets/<ns>/textures/<path>` 形式のキーから、一括APIが想定するネームスペースとパスのパーツに分割します。
 * @param key R2オブジェクトキー
 */
function splitTextureKey(key: string): { ns: string; path: string } | null {
  const m = /^assets\/([^/]+)\/textures\/(.+)$/.exec(key);
  return m ? { ns: m[1], path: m[2] } : null;
}

/**
 * HTTPの書き込みAPI（バルクエンドポイント）を介してアセットをアップロードします。
 * @param items アップロードするアイテムの配列
 * @param onProgress 進捗コールバック関数
 */
async function uploadViaApi(items: { key: string; body: Buffer }[], onProgress?: (done: number) => void): Promise<void> {
  // 一括（バルク）エンドポイントはネームスペース単位であるため、最初にグループ化します。
  const byNs = new Map<string, Record<string, string>>();
  for (const { key, body } of items) {
    const parts = splitTextureKey(key);
    if (!parts) throw new Error(`Not a texture key, cannot upload over HTTP: ${key}`);
    const bucket = byNs.get(parts.ns) || {};
    bucket[parts.path] = body.toString('base64');
    byNs.set(parts.ns, bucket);
  }

  let done = 0;
  for (const [ns, textures] of byNs) {
    const paths = Object.keys(textures);
    for (let i = 0; i < paths.length; i += BATCH_SIZE) {
      const batch: Record<string, string> = {};
      for (const p of paths.slice(i, i + BATCH_SIZE)) batch[p] = textures[p];
      const res = await fetch(`${API_URL}/api/${ns}/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
        body: JSON.stringify({ textures: batch }),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      done += Object.keys(batch).length;
      onProgress?.(done);
    }
  }
}

/**
 * 設定されたアップロード先（S3 または HTTP API）を使用して、すべてのアイテムをアップロードします。
 * @param items アップロード対象アイテムの配列
 * @param onProgress 進捗コールバック関数
 */
export async function uploadAll(
  items: { key: string; body: Buffer }[],
  onProgress?: (done: number) => void
): Promise<void> {
  if (API_URL) {
    if (!SECRET) throw new Error('MP_RECIPE_URL is set but UPLOAD_SECRET/ADMIN_SECRET is not.');
    return uploadViaApi(items, onProgress);
  }

  let done = 0;
  await runPool(items, 20, async ({ key, body }) => {
    await uploadToR2(key, body);
    onProgress?.(++done);
  });
}
