/**
 * @fileoverview ネームスペースごとのアセットバージョン管理。レンダリングされた画像のキャッシュを無効化するために使用されます。
 *
 * 書き込み時に個々のキャッシュエントリを削除することは困難です。1つのテクスチャアップロードが数十個のレシピ画像に影響を与える可能性があり、
 * 各画像にはクエリバリアント（`?scale=`, `?tagOffset=` など）ごとにキャッシュエントリが存在するためです。
 * 代わりに、バージョン番号をキャッシュキーに組み込みます。
 * バージョンを上げることで、古いエントリが一斉にアクセス不能（無効化）になり、時間が経てば自動的に消去されます。
 */

import type { Env } from './minecraft';

const KEY = (ns: string) => `meta/version/${ns}`;

/** 読み取ったバージョンがアイソレート内で信頼される期間（ミリ秒単位）。 */
const MEMO_TTL = 10_000;

const memo = new Map<string, { value: string; readAt: number }>();

/**
 * 特定のネームスペースの現在のバージョンを取得します（一度も書き込まれていない場合は '0'）。
 * @param env 環境変数
 * @param ns ネームスペース
 * @returns バージョン文字列
 */
export async function getAssetVersion(env: Env, ns: string): Promise<string> {
  const hit = memo.get(ns);
  if (hit && Date.now() - hit.readAt < MEMO_TTL) return hit.value;

  const obj = await env.BUCKET.get(KEY(ns));
  const value = obj ? (await obj.text()).trim() || '0' : '0';
  memo.set(ns, { value, readAt: Date.now() });
  return value;
}

/**
 * ネームスペースのアセットが変更されたことをマーク（バージョンを更新）します。
 * レンダリングされた画像に影響を与える可能性のある書き込み（レシピ、テクスチャ、モデル、タグなど）が行われた後に呼び出します。
 * MEMO_TTL 以内にすべてのクライアントに適用されます。
 * @param env 環境変数
 * @param ns ネームスペース
 */
export async function bumpAssetVersion(env: Env, ns: string): Promise<void> {
  const value = Date.now().toString(36);
  memo.set(ns, { value, readAt: Date.now() });
  await env.BUCKET.put(KEY(ns), value, {
    httpMetadata: { contentType: 'text/plain' },
  }).catch(() => {});
}
