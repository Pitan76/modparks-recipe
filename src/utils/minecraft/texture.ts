/**
 * @fileoverview 画像およびテクスチャ解決処理。
 */

import { Env } from './env';
import { parseNamespacedId } from './id';
import { renderBlockIconPng } from '../block-icon';
import { bytesToBase64 } from '../http';

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

/**
 * リソースID（例: "ns:item/foo"）に対応するテクスチャPNGをR2から取得し、データURLとして返します。
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

export const TRANSPARENT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAcSURBVDhPY3hAIP+PgYGBkIGxAaNgFIwCFAYGBgA9Vww1u0dD/wAAAABJRU5ErkJggg==";

/**
 * 指定されたアイテムIDに対応するテクスチャ/アイコン画像を解決し、base64データURLとして返します。
 */
export async function getItemImageBase64(id: string, env: Env): Promise<string | null> {
  const { namespace, path } = parseNamespacedId(id);

  let obj = await env.BUCKET.get(`assets/${namespace}/textures/render3d/${path}.png`);
  if (obj) return `data:image/png;base64,${bufferToBase64(await obj.arrayBuffer())}`;

  obj = await env.BUCKET.get(`assets/${namespace}/textures/item/${path}.png`);
  if (obj) return `data:image/png;base64,${bufferToBase64(await obj.arrayBuffer())}`;

  const icon = await renderBlockIconPng(env, namespace, path).catch(() => null);
  if (icon) {
    await env.BUCKET.put(`assets/${namespace}/textures/render3d/${path}.png`, icon, {
      httpMetadata: { contentType: 'image/png' },
    }).catch(() => {});
    return `data:image/png;base64,${bytesToBase64(icon)}`;
  }

  obj = await env.BUCKET.get(`assets/${namespace}/textures/block/${path}.png`);
  if (obj) return `data:image/png;base64,${bufferToBase64(await obj.arrayBuffer())}`;

  const viaModel = await resolveViaModel(namespace, path, env);
  if (viaModel) return viaModel;

  return TRANSPARENT_PNG;
}
