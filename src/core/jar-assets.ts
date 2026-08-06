/**
 * @fileoverview jar（zip）からレシピ・タグ・テクスチャ・モデル・言語ファイルを抜き出します。
 *
 * 特定のフレームワークやUIライブラリに依存しない純粋な処理として実装しており、
 * ModParks（メインアプリ）側へそのまま持っていけます。JSZip の実体は呼び出し側が渡します。
 */

import { isSharedNamespace } from './namespaces';
import { classifyAssetPath, type AssetKind } from './paths';

/** JSZip のうち、ここで必要な部分だけを写した型。 */
export interface ZipLike {
  files: Record<string, { dir: boolean; async(type: 'string'): Promise<string>; async(type: 'arraybuffer'): Promise<ArrayBuffer> }>;
}

/** 1ネームスペース分の抽出結果。bulk 投入APIのボディとしてそのまま送れます。 */
export type NamespaceAssets = Record<AssetKind, Record<string, string>>;

/** 種別ごとの件数。 */
export type AssetCounts = Record<AssetKind, number>;

/** `analyzeJar` の返り値。 */
export interface ExtractedJar {
  byNs: Record<string, NamespaceAssets>;
  /** 投入対象のネームスペース一覧。 */
  namespaces: string[];
  counts: AssetCounts;
}

/** 空の集計値を作ります。 */
function emptyCounts(): AssetCounts {
  return { recipes: 0, tags: 0, textures: 0, models: 0, langs: 0 };
}

/** 空のネームスペース枠を作ります。 */
function emptyAssets(): NamespaceAssets {
  return { recipes: {}, tags: {}, textures: {}, models: {}, langs: {} };
}

/**
 * 読み込み済みの JSZip インスタンスからアセットを抽出し、ネームスペース別に分けます。
 * @param zip JSZip のインスタンス
 */
export async function analyzeJar(zip: ZipLike): Promise<ExtractedJar> {
  const byNs: Record<string, NamespaceAssets> = {};
  const ensureNs = (ns: string) => (byNs[ns] ||= emptyAssets());

  for (const path of Object.keys(zip.files)) {
    const entry = zip.files[path];
    if (entry.dir) continue;

    const hit = classifyAssetPath(path);
    if (!hit) continue;

    const bucket = ensureNs(hit.namespace)[hit.kind];
    // テクスチャだけはバイナリなので base64 に畳み、キーに拡張子を戻します。
    if (hit.kind === 'textures') {
      bucket[`${hit.id}.png`] = bytesToBase64(new Uint8Array(await entry.async('arraybuffer')));
      continue;
    }
    bucket[hit.id] = await entry.async('string');
  }

  for (const ns of Object.keys(byNs)) {
    if (isSharedNamespace(ns)) byNs[ns] = { ...emptyAssets(), tags: byNs[ns].tags };
  }

  const counts = emptyCounts();
  for (const assets of Object.values(byNs)) {
    for (const kind of Object.keys(counts) as AssetKind[]) counts[kind] += Object.keys(assets[kind]).length;
  }

  return { byNs, namespaces: namespacesToSend(byNs), counts };
}

/**
 * 投入対象のネームスペースを選びます。
 *
 * レシピかタグを持つものだけを送ります。テクスチャやモデルだけを含むネームスペース
 * （バニラ資産を差し替える同梱リソース等）まで送ると、共有側の資産を壊しかねません。
 * @param byNs ネームスペース別の抽出結果
 */
function namespacesToSend(byNs: Record<string, NamespaceAssets>): string[] {
  return Object.keys(byNs).filter(
    (ns) => Object.keys(byNs[ns].recipes).length > 0 || Object.keys(byNs[ns].tags).length > 0
  );
}

/**
 * Uint8Array を、ブラウザのスタック制限を避けつつ base64 にエンコードします。
 * @param bytes バイナリデータ
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
