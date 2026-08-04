/**
 * @fileoverview 内容アドレスのオブジェクト置き場。テクスチャ/モデル/タグ/lang/レシピJSON の実体を保持します。
 *
 * mod のバージョンが上がっても中身が同じファイルは同じキーになるため、書き込み自体が発生しません。
 * これが modVersion の履歴を全部残しても容量が膨らまない根拠です。
 */

import type { Env } from '../minecraft';
import { sha256Hex, sha256Text } from './hash';

const PREFIX = 'blobs';

/** このアイソレートで存在を確認済みのハッシュ。同一取り込み中の `head` 往復を省きます。 */
const known = new Set<string>();

/**
 * blob のR2キーを返します。
 * @param hash 内容ハッシュ
 */
export function blobKey(hash: string): string {
  return `${PREFIX}/${hash}`;
}

/**
 * バイト列を保存し、内容ハッシュを返します。既に同じ内容があれば書き込みません。
 * @param env 環境変数
 * @param bytes 保存するバイト列
 * @param contentType 保存時に付ける Content-Type
 * @returns 内容ハッシュ
 */
export async function putBlob(env: Env, bytes: Uint8Array, contentType: string): Promise<string> {
  const hash = await sha256Hex(bytes);
  await writeIfAbsent(env, hash, bytes, contentType);
  return hash;
}

/**
 * 文字列（JSON等）を保存し、内容ハッシュを返します。
 * @param env 環境変数
 * @param text 保存する文字列
 * @param contentType 保存時に付ける Content-Type
 * @returns 内容ハッシュ
 */
export async function putBlobText(env: Env, text: string, contentType = 'application/json'): Promise<string> {
  const hash = await sha256Text(text);
  await writeIfAbsent(env, hash, new TextEncoder().encode(text), contentType);
  return hash;
}

/**
 * blob をそのまま取得します。
 * @param env 環境変数
 * @param hash 内容ハッシュ
 * @returns 見つからなければ null
 */
export async function getBlob(env: Env, hash: string): Promise<R2ObjectBody | null> {
  return env.BUCKET.get(blobKey(hash));
}

/**
 * blob をJSONとして取得します。壊れていれば未作成と同じ扱いにします。
 * @param env 環境変数
 * @param hash 内容ハッシュ
 */
export async function getBlobJson<T>(env: Env, hash: string): Promise<T | null> {
  const obj = await getBlob(env, hash);
  if (!obj) return null;

  try {
    return await obj.json<T>();
  } catch {
    return null;
  }
}

/**
 * まだ存在しない場合のみ書き込みます。
 *
 * 同じ内容を上書きしても結果は変わりませんが、取り込み1回あたり数千回になりうる
 * 書き込みクラスの操作を丸ごと省けるため、存在確認の方が安上がりです。
 * @param env 環境変数
 * @param hash 内容ハッシュ
 * @param bytes 保存するバイト列
 * @param contentType 保存時に付ける Content-Type
 */
async function writeIfAbsent(env: Env, hash: string, bytes: Uint8Array, contentType: string): Promise<void> {
  if (known.has(hash)) return;

  const key = blobKey(hash);
  if (!(await env.BUCKET.head(key))) {
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType } });
  }
  known.add(hash);
}
