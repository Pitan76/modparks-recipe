/**
 * @fileoverview Minecraftのデータやテクスチャの解決、キャッシュDBへの保存、3Dレンダリングアイコンの生成などを行うユーティリティ。
 */

import { renderBlockIconPng } from './block-icon';
import { bytesToBase64 } from './http';

// レシピJSONの純粋な読み取り関数は core/ にあります（Nodeスクリプトからも import
// できるようにするため）。既存の呼び出し元のためにここから再エクスポートします。
export { resultItemOf, isCraftingType } from '../core/recipe';

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ADMIN_SECRET: string;
  // 書き込み/アップロードAPIに必要なシークレット。設定されていない場合は ADMIN_SECRET が使用されます。
  UPLOAD_SECRET?: string;
}

/**
 * ネームスペース付きID（例: "minecraft:stone"）を分割して、ネームスペースとパスのオブジェクトを返します。
 * ネームスペースが省略されている場合はデフォルトで "minecraft" になります。
 * @param id アイテムID文字列
 */
export function parseNamespacedId(id: string): { namespace: string; path: string } {
  // 例: "minecraft:wooden_sword" -> { namespace: "minecraft", path: "wooden_sword" }
  // 例: "stone" -> { namespace: "minecraft", path: "stone" }
  if (id.includes(':')) {
    const [namespace, ...rest] = id.split(':');
    return { namespace, path: rest.join(':') };
  }
  return { namespace: 'minecraft', path: id };
}

/**
 * ArrayBufferをbase64文字列に変換します。
 * @param buffer 変換対象 of ArrayBuffer
 */
function bufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ----------------------------------------------------
// レシピ (Recipes)
// ----------------------------------------------------

/**
 * データベース（D1）またはオブジェクトストレージ（R2）からレシピJSONを取得します。
 * DBにキャッシュがない場合はR2から取得し、DBにキャッシュを保存します。
 * @param id 完全修飾レシピID (例: "minecraft:stone")
 * @param env 環境変数
 * @returns レシピJSON、存在しない場合は null
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

  // バックグラウンドで非同期にキャッシュ保存を実行（例外はログ出力のみ）
  env.DB.prepare('INSERT OR REPLACE INTO recipes (id, result_item, data) VALUES (?, ?, ?)')
    .bind(id, resultItem, dataStr)
    .run().catch(console.error);

  return data;
}

// ----------------------------------------------------
// タグ (Tags)
// ----------------------------------------------------

/**
 * 指定されたIDに対応するタグ（アイテムグループ等）の構成アイテムリストを取得します。
 * DBにキャッシュがない場合はR2から取得し、DBにキャッシュを保存します。
 * @param id タグID (先頭の#は省略可能)
 * @param env 環境変数
 * @returns タグに含まれるアイテムIDの配列
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

// ----------------------------------------------------
// 画像 (Images)
// ----------------------------------------------------

/**
 * リソースID（例: "ns:item/foo"）に対応するテクスチャPNGをR2から取得し、データURLとして返します。
 * @param texId テクスチャのリソースID
 * @param defaultNs デフォルトのネームスペース
 * @param env 環境変数
 * @returns テクスチャ画像のbase64データURL、取得できない場合は null
 */
async function textureDataUrl(texId: string, defaultNs: string, env: Env): Promise<string | null> {
  const tns = texId.includes(':') ? texId.split(':')[0] : defaultNs;
  const tpath = texId.includes(':') ? texId.split(':').slice(1).join(':') : texId;
  let obj = await env.BUCKET.get(`assets/${tns}/textures/${tpath}.png`);
  // プレフィックスのない参照はデフォルトで minecraft になります。Modのネームスペースで見つからない場合は minecraft も試します。
  if (!obj && tns !== 'minecraft') obj = await env.BUCKET.get(`assets/minecraft/textures/${tpath}.png`);
  if (!obj) return null;
  return `data:image/png;base64,${bufferToBase64(await obj.arrayBuffer())}`;
}

/**
 * モデルの親チェーンを走査し、テクスチャマップをマージします（子が親の設定を上書きします）。
 * @param ns ネームスペース
 * @param modelPath モデルファイルへの相対パス
 * @param env 環境変数
 * @param seen 循環参照を防ぐための訪問済みモデルキーのセット
 */
async function mergedModelTextures(
  ns: string,
  modelPath: string,
  env: Env,
  seen: Set<string>
): Promise<Record<string, string>> {
  const key = `${ns}:${modelPath}`;
  if (seen.has(key) || seen.size > 12) return {};
  seen.add(key);

  const obj = await env.BUCKET.get(`assets/${ns}/models/${modelPath}.json`);
  if (!obj) return {};
  let model: any;
  try { model = JSON.parse(await obj.text()); } catch { return {}; }

  let base: Record<string, string> = {};
  if (typeof model.parent === 'string' && !model.parent.includes('builtin/')) {
    const p = model.parent;
    const pns = p.includes(':') ? p.split(':')[0] : ns;
    const pPath = p.includes(':') ? p.split(':').slice(1).join(':') : p;
    base = await mergedModelTextures(pns, pPath, env, seen);
  }
  return { ...base, ...(model.textures || {}) };
}

/**
 * マージされたモデルのテクスチャマップから、具体的な（#参照ではない）実際のテクスチャパスを選択します。
 * @param textures テクスチャマップオブジェクト
 * @returns テクスチャパス、見つからない場合は null
 */
function pickModelTexture(textures: Record<string, string>): string | null {
  const prefer = ['layer0', 'all', 'texture', 'side', 'front', 'particle', 'end', 'top'];
  for (const k of prefer) {
    const v = textures[k];
    if (typeof v === 'string' && v && !v.startsWith('#')) return v;
  }
  for (const v of Object.values(textures)) {
    if (typeof v === 'string' && v && !v.startsWith('#')) return v;
  }
  return null;
}

/**
 * アイテム/ブロックのモデルJSONを介して、そのテクスチャパスを解決します（IDとテクスチャのファイル名が異なるアイテム用）。
 * @param namespace ネームスペース
 * @param path リソースパス
 * @param env 環境変数
 * @returns テクスチャ画像のデータURL、解決できない場合は null
 */
async function resolveViaModel(namespace: string, path: string, env: Env): Promise<string | null> {
  for (const kind of ['item', 'block']) {
    const textures = await mergedModelTextures(namespace, `${kind}/${path}`, env, new Set());
    const texId = pickModelTexture(textures);
    if (texId) {
      const url = await textureDataUrl(texId, namespace, env);
      if (url) return url;
    }
  }
  return null;
}

const TRANSPARENT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAcSURBVDhPY3hAIP+PgYGBkIGxAaNgFIwCFAYGBgA9Vww1u0dD/wAAAABJRU5ErkJggg==";

/**
 * 指定されたアイテムIDに対応するテクスチャ/アイコン画像を解決し、base64データURLとして返します。
 * @param id アイテムID
 * @param env 環境変数
 * @returns アイコンのbase64データURL、見つからない場合は透明なPNGデータ
 */
export async function getItemImageBase64(id: string, env: Env): Promise<string | null> {
  const { namespace, path } = parseNamespacedId(id);

  // 1. オフラインのブロックレンダリングパイプラインから生成された、事前レンダリング済みのPNG。
  let obj = await env.BUCKET.get(`assets/${namespace}/textures/render3d/${path}.png`);
  if (obj) return `data:image/png;base64,${bufferToBase64(await obj.arrayBuffer())}`;

  // 2. ファイル名がアイテムIDと一致する平面のPNG。
  obj = await env.BUCKET.get(`assets/${namespace}/textures/item/${path}.png`);
  if (obj) return `data:image/png;base64,${bufferToBase64(await obj.arrayBuffer())}`;

  // 3. ブロック: そのモデルを3Dの等角投影（isometric）アイコンにレンダリングします（オフラインパイプラインがバニラのブロックをレンダリングする方法に相当）。
  //    レンダリング結果は render3d/ 配下にキャッシュされるため、次回以降のリクエストはステップ1で取得されます。
  //    モデルチェーンが実際のジオメトリに解決されない場合は null を返します。その場合、以下の手順4で平面的なテクスチャが試行されます。
  const icon = await renderBlockIconPng(env, namespace, path).catch(() => null);
  if (icon) {
    await env.BUCKET.put(`assets/${namespace}/textures/render3d/${path}.png`, icon, {
      httpMetadata: { contentType: 'image/png' },
    }).catch(() => {});
    return `data:image/png;base64,${bytesToBase64(icon)}`;
  }

  // 4. 平面的なブロックテクスチャ（レンダリング可能なモデルがないブロック用）。
  obj = await env.BUCKET.get(`assets/${namespace}/textures/block/${path}.png`);
  if (obj) return `data:image/png;base64,${bufferToBase64(await obj.arrayBuffer())}`;

  // 5. ファイル名がIDと異なる場合: item/block のモデルJSONを解析し、テクスチャを特定します。
  const viaModel = await resolveViaModel(namespace, path, env);
  if (viaModel) return viaModel;

  // 6. 利用可能なテクスチャがない場合。特別な処理が必要なブロックエンティティ（チェストなど）は、オフラインのブロックレンダリングパイプラインによってカバーされています。
  return TRANSPARENT_PNG;
}
