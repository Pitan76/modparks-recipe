/**
 * @fileoverview レシピやタグのデータフェッチ処理。
 */

import { Env } from './env';
import { parseNamespacedId } from './id';

/**
 * 保存されたJSON文字列を読みます。壊れていれば null を返します。
 *
 * R2 と D1 の中身は書き込みAPIやオフラインパイプラインが入れたもので、
 * 途中で切れた本文や古い形式が混ざりえます。1件の破損で画像APIを500にしないため、
 * ここでは「無かったこと」に倒します。
 * @param text 保存されていたJSON文字列
 */
function parseStored(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * データベース（D1）またはオブジェクトストレージ（R2）からレシピJSONを取得します。
 * DBにキャッシュがない場合はR2から取得し、DBにキャッシュを保存します。
 */
export async function getRecipe(id: string, env: Env): Promise<any | null> {
  const { results } = await env.DB.prepare('SELECT data FROM recipes WHERE id = ?').bind(id).all();
  if (results && results.length > 0) {
    // 壊れたキャッシュ行は R2 から引き直す。次の取得でこの行は上書きされる。
    const cached = parseStored(results[0].data as string);
    if (cached) return cached;
  }

  const { namespace, path } = parseNamespacedId(id);

  let obj = await env.BUCKET.get(`data/${namespace}/recipe/${path}.json`);
  if (!obj) {
    obj = await env.BUCKET.get(`data/${namespace}/recipes/${path}.json`);
  }

  if (!obj) return null;

  const dataStr = await obj.text();
  const data = parseStored(dataStr);
  if (!data) return null;

  let resultItem = "";
  if (data.result && data.result.id) resultItem = data.result.id;
  else if (data.result && typeof data.result === 'string') resultItem = data.result;

  // バックグラウンドで非同期にキャッシュ保存を実行
  env.DB.prepare('INSERT OR REPLACE INTO recipes (id, result_item, data) VALUES (?, ?, ?)')
    .bind(id, resultItem, dataStr)
    .run().catch(console.error);

  return data;
}

/**
 * 指定されたIDに対応するタグ（アイテムグループ等）の構成アイテムリストを取得します。
 * DBにキャッシュがない場合はR2から取得し、DBにキャッシュを保存します。
 */
export async function getTag(id: string, env: Env): Promise<string[]> {
  if (id.startsWith('#')) id = id.substring(1);
  
  const { results } = await env.DB.prepare('SELECT data FROM tags WHERE id = ?').bind(id).all();
  if (results && results.length > 0) {
    // 壊れたキャッシュ行は R2 から引き直す。次の取得でこの行は上書きされる。
    const cached = parseStored(results[0].data as string);
    if (cached) return cached.values || [];
  }

  const { namespace, path } = parseNamespacedId(id);
  
  // タグのパスは items, item, blocks, block のいずれかの配下に存在する可能性があります
  let obj = await env.BUCKET.get(`data/${namespace}/tags/item/${path}.json`);
  if (!obj) obj = await env.BUCKET.get(`data/${namespace}/tags/items/${path}.json`);
  if (!obj) obj = await env.BUCKET.get(`data/${namespace}/tags/block/${path}.json`);
  if (!obj) obj = await env.BUCKET.get(`data/${namespace}/tags/blocks/${path}.json`);

  if (!obj) return [];

  const dataStr = await obj.text();
  const data = parseStored(dataStr);
  if (!data) return [];

  env.DB.prepare('INSERT OR REPLACE INTO tags (id, data) VALUES (?, ?)')
    .bind(id, dataStr)
    .run().catch(console.error);

  return data.values || [];
}
