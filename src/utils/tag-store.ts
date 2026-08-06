/**
 * @fileoverview タグJSONのR2保存。
 *
 * 通常のネームスペースでは受け取った本文をそのまま置きます。共有ネームスペース
 * （`c` / `forge` / `neoforge` / `minecraft`）だけは複数の mod が同じタグを分担して定義するため、
 * 上書きすると後から投入した jar が他 mod の定義を消してしまいます。そこだけ `values` を統合します。
 */

import type { Env } from './minecraft';
import { isSharedNamespace } from '../core/namespaces';

/** タグJSONのR2オブジェクトキーを組み立てます。 */
export function tagKey(namespace: string, id: string): string {
  return `data/${namespace}/tags/${id}.json`;
}

/**
 * タグの1エントリを比較用のキーにします。
 *
 * `values` の要素は `"minecraft:oak_planks"` のような文字列のほか、
 * `{ "id": "...", "required": false }` の形も取ります。
 * @param value `values` の要素
 */
function valueKey(value: unknown): string {
  if (typeof value === 'string') return value;
  const id = (value as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id : JSON.stringify(value);
}

/**
 * 既存のタグ本文に新しい本文を重ねた結果を返します。
 *
 * `replace: true` は「ここまでの定義を捨てる」という宣言なので、その場合は統合せず新しい方を採ります。
 * @param existing 既に保存されている本文（無ければ null）
 * @param incoming 新しく受け取った本文
 * @returns 保存すべき本文
 */
export function mergeTagBodies(existing: string | null, incoming: string): string {
  if (!existing) return incoming;

  let base: any, next: any;
  try {
    base = JSON.parse(existing);
    next = JSON.parse(incoming);
  } catch {
    // 既存が壊れている場合まで統合に付き合う必要はありません。新しい方で置き換えます。
    return incoming;
  }
  if (next?.replace === true) return incoming;

  const merged = new Map<string, unknown>();
  for (const v of [...(base?.values ?? []), ...(next?.values ?? [])]) merged.set(valueKey(v), v);
  return JSON.stringify({ ...base, ...next, values: Array.from(merged.values()) });
}

/**
 * タグJSONを保存し、D1のキャッシュ行を落とします。
 * @param env Worker の環境バインディング
 * @param namespace ネームスペース
 * @param id 拡張子を除いたタグID（例: "item/planks"）
 * @param body 受け取ったタグJSON本文
 * @returns 実際に保存した本文。build 用の収集にはこちらを積みます
 */
export async function putTagBody(env: Env, namespace: string, id: string, body: string): Promise<string> {
  const key = tagKey(namespace, id);
  const stored = isSharedNamespace(namespace)
    ? mergeTagBodies(await readExisting(env, key), body)
    : body;

  await env.BUCKET.put(key, stored, { httpMetadata: { contentType: 'application/json' } });
  await env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(`${namespace}:${id}`).run().catch(() => {});
  return stored;
}

/**
 * 既に置かれている本文を読みます。
 * @param env Worker の環境バインディング
 * @param key R2オブジェクトキー
 */
async function readExisting(env: Env, key: string): Promise<string | null> {
  const obj = await env.BUCKET.get(key);
  return obj ? await obj.text() : null;
}
