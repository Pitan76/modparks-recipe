/**
 * @fileoverview レシピやタグのデータフェッチ処理。
 */

import { Env } from './env';
import { parseNamespacedId } from './id';

/**
 * データベース（D1）またはオブジェクトストレージ（R2）からレシピJSONを取得します。
 * DBにキャッシュがない場合はR2から取得し、DBにキャッシュを保存します。
 */
export async function getRecipe(id: string, env: Env): Promise<any | null> {
  const { results } = await env.DB.prepare('SELECT data FROM recipes WHERE id = ?').bind(id).all();
  if (results && results.length > 0) {
    return JSON.parse(results[0].data as string);
  }

  const { namespace, path } = parseNamespacedId(id);
  
  let obj = await env.BUCKET.get(`data/${namespace}/recipe/${path}.json`);
  if (!obj) {
    obj = await env.BUCKET.get(`data/${namespace}/recipes/${path}.json`);
  }
  
  if (!obj) return null;

  const dataStr = await obj.text();
  const data = JSON.parse(dataStr);
  
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
    return JSON.parse(results[0].data as string).values || [];
  }

  const { namespace, path } = parseNamespacedId(id);
  
  // タグのパスは items, item, blocks, block のいずれかの配下に存在する可能性があります
  let obj = await env.BUCKET.get(`data/${namespace}/tags/item/${path}.json`);
  if (!obj) obj = await env.BUCKET.get(`data/${namespace}/tags/items/${path}.json`);
  if (!obj) obj = await env.BUCKET.get(`data/${namespace}/tags/block/${path}.json`);
  if (!obj) obj = await env.BUCKET.get(`data/${namespace}/tags/blocks/${path}.json`);

  if (!obj) return [];

  const dataStr = await obj.text();
  const data = JSON.parse(dataStr);

  env.DB.prepare('INSERT OR REPLACE INTO tags (id, data) VALUES (?, ?)')
    .bind(id, dataStr)
    .run().catch(console.error);

  return data.values || [];
}
