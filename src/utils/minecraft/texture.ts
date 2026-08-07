/**
 * @fileoverview 画像およびテクスチャ解決処理。
 */

import { Env } from './env';
import { parseNamespacedId } from './id';
import { renderBlockIconPng, renderBlockIconSvg } from '../block-icon';
import { bytesToBase64 } from '../http';
import { getIcon, setIcon, noteVersion } from '../icon-memo';
import { getAssetVersion } from '../cache-version';
import { rendererVersion } from '../render-version';
import { legacyAssetSource } from '../build/asset-source';
import type { AssetReader } from '../../core/asset-reader';

/**
 * ArrayBufferをbase64のdataURLに変換します。
 * @param buffer 変換対象の ArrayBuffer
 */
function pngDataUrl(buffer: ArrayBuffer): string {
  return `data:image/png;base64,${bytesToBase64(new Uint8Array(buffer))}`;
}

/**
 * リソースID（例: "ns:item/foo"）に対応するテクスチャPNGをR2から取得し、データURLとして返します。
 */
async function textureDataUrl(texId: string, defaultNs: string, src: AssetReader): Promise<string | null> {
  const tns = texId.includes(':') ? texId.split(':')[0] : defaultNs;
  const tpath = texId.includes(':') ? texId.split(':').slice(1).join(':') : texId;
  let obj = await src.get(tns, `textures/${tpath}.png`);
  // プレフィックスのない参照はデフォルトで minecraft になります。Modのネームスペースで見つからない場合は minecraft も試します。
  if (!obj && tns !== 'minecraft') obj = await src.get('minecraft', `textures/${tpath}.png`);
  if (!obj) return null;
  return pngDataUrl(await obj.arrayBuffer());
}

/**
 * モデルの親チェーンを走査し、テクスチャマップをマージします（子が親の設定を上書きします）。
 */
async function mergedModelTextures(
  ns: string,
  modelPath: string,
  src: AssetReader,
  seen: Set<string>
): Promise<Record<string, string>> {
  const key = `${ns}:${modelPath}`;
  if (seen.has(key) || seen.size > 12) return {};
  seen.add(key);

  const obj = await src.get(ns, `models/${modelPath}.json`);
  if (!obj) return {};
  let model: any;
  try { model = JSON.parse(await obj.text()); } catch { return {}; }

  let base: Record<string, string> = {};
  if (typeof model.parent === 'string' && !model.parent.includes('builtin/')) {
    const p = model.parent;
    const pns = p.includes(':') ? p.split(':')[0] : ns;
    const pPath = p.includes(':') ? p.split(':').slice(1).join(':') : p;
    base = await mergedModelTextures(pns, pPath, src, seen);
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
async function resolveViaModel(namespace: string, path: string, src: AssetReader): Promise<string | null> {
  for (const kind of ['item', 'block']) {
    const textures = await mergedModelTextures(namespace, `${kind}/${path}`, src, new Set());
    const texId = pickModelTexture(textures);
    if (texId) {
      const url = await textureDataUrl(texId, namespace, src);
      if (url) return url;
    }
  }
  return null;
}

export const TRANSPARENT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAcSURBVDhPY3hAIP+PgYGBkIGxAaNgFIwCFAYGBgA9Vww1u0dD/wAAAABJRU5ErkJggg==";

/**
 * 指定されたアイテムIDに対応するテクスチャ/アイコン画像を解決し、base64データURLとして返します。
 *
 * 3層で解決します: L0 アイソレート内メモ → L1 解決済みアイコン(R2) → 最大5段の直列プローブ。
 * L1/L0 のおかげで、温まったアイソレートや2回目以降の冷レンダリングでは、あの多段探索
 * （失敗時 1秒超）を R2 GET 1回、あるいは往復ゼロに畳み込めます。
 */
export async function getItemImageBase64(
  id: string,
  env: Env | null,
  src: AssetReader = legacyAssetSource(env!)
): Promise<string | null> {
  const { namespace, path } = parseNamespacedId(id);

  // L0 と L1 で同じ世代を使う。ここで実バージョンを引くため、`?v=` の有無や
  // 経路（個別画像 / batch / sprite）に関わらずメモの世代が揃う。
  // アイソレート内でメモされるため、通常は R2 往復を伴わない。
  // build を持つ ns では build ID がそのまま世代になる（内容ハッシュなので取り違えが起きない）。
  const version = await generationOf(env, src, namespace);
  noteVersion(namespace, version);

  const memoized = getIcon(namespace, version, path);
  if (memoized !== undefined) return memoized;

  // L1: 解決済みアイコン。キーに ns バージョンとレンダラー版を含むため、テクスチャ更新や
  // レンダラー変更で自動的に別キーとなり、古いものは参照されなくなる（削除不要）。
  // 永続キャッシュは Worker 側だけの仕組みです。ブラウザ側の描画では素通しにします。
  const persist = !!env && src.persistIcons !== false;
  const l1Key = persist ? iconCacheKey(env, namespace, version, path) : null;
  const l1 = l1Key ? await env!.BUCKET.get(l1Key) : null;
  if (l1) {
    const dataUrl = await l1.text();
    setIcon(namespace, version, path, dataUrl);
    return dataUrl;
  }

  const resolved = await resolveItemImage(namespace, path, env, src);
  setIcon(namespace, version, path, resolved);

  // 解決失敗（透明フォールバック）は永続化しない。テクスチャ未着の投入中に固定してしまうのを防ぐ。
  if (l1Key && resolved !== TRANSPARENT_PNG) {
    await env!.BUCKET.put(l1Key, resolved, { httpMetadata: { contentType: 'text/plain' } }).catch(() => {});
  }
  return resolved;
}

/**
 * アイコンキャッシュの世代を決めます。
 *
 * build を持つネームスペースでは build ID（内容ハッシュ）をそのまま使います。内容が同じなら
 * 世代も同じになるため、mod のバージョンを上げただけでアイコンを作り直す無駄が消えます。
 * build を持たない移行前のネームスペースは従来のアセットバージョンに落ちます。
 * @param env 環境変数
 * @param src アセット読み出し口
 * @param ns ネームスペース
 */
async function generationOf(env: Env | null, src: AssetReader, ns: string): Promise<string> {
  const buildId = await src.buildOf(ns);
  if (buildId) return buildId.slice(0, 16);
  return env ? getAssetVersion(env, ns) : 'local';
}

/**
 * L1 アイコンキャッシュのキーを組み立てます。ns バージョンとレンダラー版を世代として含めます。
 */
function iconCacheKey(env: Env | null, ns: string, version: string, path: string): string {
  return `cache/icon/${rendererVersion(env!)}/${ns}/${version}/${path}.dataurl`;
}

/**
 * 拡大時の補間を切る指定を差し込みます。
 *
 * SVG が持つのは `image-rendering="optimizeSpeed"`（SVG 1.1 の値）で、ブラウザによっては補間されます。
 * このアイコンはレシピのSVGに入れ子で埋め込まれ、外側に付けた指定は内側の文書へ継承されないため、
 * ここで直接入れます。ラスタライザ側はこの値で正しく動くので、書き換えはしません。
 * @param svg SVG文字列
 */
function pixelated(svg: string): string {
  const close = svg.indexOf('>');
  if (close < 0) return svg;
  return `${svg.slice(0, close + 1)}<style>image{image-rendering:pixelated}</style>${svg.slice(close + 1)}`;
}

/**
 * アイコンの実解決。最大5段の直列 R2 プローブを伴うため、呼び出し側で必ずメモしてください。
 */
async function resolveItemImage(namespace: string, path: string, env: Env | null, src: AssetReader): Promise<string> {
  let obj = await src.get(namespace, `textures/render3d/${path}.png`);
  if (obj) return pngDataUrl(await obj.arrayBuffer());

  obj = await src.get(namespace, `textures/item/${path}.png`);
  if (obj) return pngDataUrl(await obj.arrayBuffer());

  // ブラウザ側には resvg がありません。ラスタライズせず SVG のまま埋め込みます。
  if (!env) {
    const svg = await renderBlockIconSvg(null, namespace, path, src).catch(() => null);
    if (svg) return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(pixelated(svg))))}`;
  } else {
    const icon = await renderBlockIconPng(env, namespace, path, src).catch(() => null);
    if (icon) {
      await env.BUCKET.put(`assets/${namespace}/textures/render3d/${path}.png`, icon, {
        httpMetadata: { contentType: 'image/png' },
      }).catch(() => {});
      return `data:image/png;base64,${bytesToBase64(icon)}`;
    }
  }

  obj = await src.get(namespace, `textures/block/${path}.png`);
  if (obj) return pngDataUrl(await obj.arrayBuffer());

  const viaModel = await resolveViaModel(namespace, path, src);
  if (viaModel) return viaModel;

  return TRANSPARENT_PNG;
}
