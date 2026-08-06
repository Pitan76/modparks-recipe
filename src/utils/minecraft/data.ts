/**
 * @fileoverview レシピやタグのデータフェッチ処理。
 */

import { Env } from './env';
import { legacyAssetSource } from '../build/asset-source';
import type { AssetBody, AssetReader } from '../../core/asset-reader';
import { parseNamespacedId } from './id';
import { tagAliasOf } from '../../core/namespaces';
import { TAG_DIRS } from '../../core/paths';

/**
 * タグJSONの実体を読みます。
 * @param src アセット読み出し口
 * @param ns ネームスペース
 * @param path 拡張子を除いたタグのパス
 * @returns 見つからなければ null
 */
async function readTagObject(src: AssetReader, ns: string, path: string): Promise<AssetBody | null> {
  for (const dir of TAG_DIRS) {
    const obj = await src.get(ns, `tags/${dir}/${path}.json`);
    if (obj) return obj;
  }
  return null;
}

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
export async function getRecipe(id: string, env: Env | null, src: AssetReader = legacyAssetSource(env!)): Promise<any | null> {
  const { namespace, path } = parseNamespacedId(id);
  // 同じIDでもMCバージョンごとに中身が違いうるため、キャッシュ行は build ごとに分ける。
  const cacheId = await cacheKeyOf(id, namespace, src);

  // キャッシュはブラウザ側の描画では使えません。無ければ都度読み出します。
  const { results } = env ? await env.DB.prepare('SELECT data FROM recipes WHERE id = ?').bind(cacheId).all() : { results: null };
  if (results && results.length > 0) {
    // 壊れたキャッシュ行は R2 から引き直す。次の取得でこの行は上書きされる。
    const cached = parseStored(results[0].data as string);
    if (cached) return cached;
  }

  let obj = await src.get(namespace, `recipe/${path}.json`);
  if (!obj) obj = await src.get(namespace, `recipes/${path}.json`);

  if (!obj) return null;

  const dataStr = await obj.text();
  const data = parseStored(dataStr);
  if (!data) return null;

  let resultItem = "";
  if (data.result && data.result.id) resultItem = data.result.id;
  else if (data.result && typeof data.result === 'string') resultItem = data.result;

  // バックグラウンドで非同期にキャッシュ保存を実行
  env?.DB.prepare('INSERT OR REPLACE INTO recipes (id, result_item, data) VALUES (?, ?, ?)')
    .bind(cacheId, resultItem, dataStr)
    .run().catch(console.error);

  return data;
}

/**
 * 指定されたIDに対応するタグ（アイテムグループ等）の構成アイテムリストを取得します。
 * DBにキャッシュがない場合はR2から取得し、DBにキャッシュを保存します。
 */
export async function getTag(id: string, env: Env | null, src: AssetReader = legacyAssetSource(env!)): Promise<string[]> {
  if (id.startsWith('#')) id = id.substring(1);

  const { namespace, path } = parseNamespacedId(id);
  const cacheId = await cacheKeyOf(id, namespace, src);

  const { results } = env ? await env.DB.prepare('SELECT data FROM tags WHERE id = ?').bind(cacheId).all() : { results: null };
  if (results && results.length > 0) {
    // 壊れたキャッシュ行は R2 から引き直す。次の取得でこの行は上書きされる。
    const cached = parseStored(results[0].data as string);
    if (cached) return cached.values || [];
  }

  let obj = await readTagObject(src, namespace, path);
  // 実体が無ければ読み替え先を見ます。`#forge:` 参照は移行後 `c:` にしか存在しません。
  const alias = tagAliasOf(namespace);
  if (!obj && alias) obj = await readTagObject(src, alias, path);

  if (!obj) return [];

  const dataStr = await obj.text();
  const data = parseStored(dataStr);
  if (!data) return [];

  env?.DB.prepare('INSERT OR REPLACE INTO tags (id, data) VALUES (?, ?)')
    .bind(cacheId, dataStr)
    .run().catch(console.error);

  return data.values || [];
}

/**
 * D1キャッシュ行のキーを組み立てます。
 *
 * build を持つネームスペースでは build ID を混ぜます。同じレシピIDでもMCバージョンによって
 * 中身が違うため、IDだけを鍵にすると別バージョンの内容を配ってしまいます。
 * @param id 完全修飾ID
 * @param ns ネームスペース
 * @param src アセット読み出し口
 */
async function cacheKeyOf(id: string, ns: string, src: AssetReader): Promise<string> {
  const buildId = await src.buildOf(ns);
  return buildId ? `${id}@${buildId.slice(0, 16)}` : id;
}
