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

/** 同梱 jar を開くための読み込み口。 */
export type ZipLoader = (data: ArrayBuffer) => Promise<ZipLike>;

/**
 * 同梱 jar（JiJ）の置き場。Fabric は `META-INF/jars/`、NeoForge は `META-INF/jarjar/` を使います。
 * ライブラリの同梱が主目的ですが、複数のサブ mod を1つの jar に束ねる構成ではレシピもここに入ります。
 */
const NESTED_JAR = /^META-INF\/(?:jars|jarjar)\/[^/]+\.jar$/;

/**
 * 同梱 jar を開く合計サイズの上限。
 *
 * 入れ子は呼び出し側が用意した jar の中身次第で膨らみます。ブラウザで展開する経路があるため、
 * 際限なく開かないよう頭を打っておきます。
 */
const NESTED_BUDGET_BYTES = 64 * 1024 * 1024;

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
  /** 実際に開いた同梱 jar の数。開けなかった場合との区別に使えます。 */
  nestedJars: number;
}

/** 空の集計値を作ります。 */
function emptyCounts(): AssetCounts {
  return { recipes: 0, tags: 0, textures: 0, models: 0, items: 0, langs: 0 };
}

/** 空のネームスペース枠を作ります。 */
function emptyAssets(): NamespaceAssets {
  return { recipes: {}, tags: {}, textures: {}, models: {}, items: {}, langs: {} };
}

/**
 * 既定の同梱 jar 読み込み口。ページに読み込まれた JSZip をそのまま使います。
 * @returns JSZip が居なければ null（入れ子は諦め、平坦な走査だけ行います）
 */
function globalZipLoader(): ZipLoader | null {
  const zip = (globalThis as unknown as { JSZip?: { loadAsync(d: ArrayBuffer): Promise<ZipLike> } }).JSZip;
  return zip ? (data) => zip.loadAsync(data) : null;
}

/**
 * 読み込み済みの JSZip インスタンスからアセットを抽出し、ネームスペース別に分けます。
 *
 * 同梱 jar（JiJ）は1段だけ開きます。入れ子は実際上1段で足り、深さに際限を設けない再帰は
 * 細工した jar への入口になるためです。
 * @param zip JSZip のインスタンス
 * @param loadZip 同梱 jar を開く読み込み口。省略時はグローバルの JSZip を使います
 */
export async function analyzeJar(zip: ZipLike, loadZip: ZipLoader | null = globalZipLoader()): Promise<ExtractedJar> {
  const byNs: Record<string, NamespaceAssets> = {};
  const nested = await collectAssets(byNs, zip);

  let nestedJars = 0;
  if (loadZip) {
    let budget = NESTED_BUDGET_BYTES;
    for (const bytes of nested) {
      if (bytes.byteLength > budget) break;
      budget -= bytes.byteLength;
      // 同梱 jar の中身は雑多なので、開けないものは黙って飛ばします。1つの不良で
      // 外側の jar 全体の取り込みを落とすほうが損です。
      const inner = await loadZip(bytes).catch(() => null);
      if (!inner) continue;
      await collectAssets(byNs, inner);
      nestedJars++;
    }
  }

  for (const ns of Object.keys(byNs)) {
    if (isSharedNamespace(ns)) byNs[ns] = { ...emptyAssets(), tags: byNs[ns].tags };
  }

  const counts = emptyCounts();
  for (const assets of Object.values(byNs)) {
    for (const kind of Object.keys(counts) as AssetKind[]) counts[kind] += Object.keys(assets[kind]).length;
  }

  return { byNs, namespaces: namespacesToSend(byNs), counts, nestedJars };
}

/**
 * 1つの zip を走査し、見つけたアセットを `byNs` に積みます。
 * @param byNs 積み先。複数の jar から同じ器へ合流させます
 * @param zip 走査する zip
 * @returns 見つかった同梱 jar の中身
 */
async function collectAssets(byNs: Record<string, NamespaceAssets>, zip: ZipLike): Promise<ArrayBuffer[]> {
  const nested: ArrayBuffer[] = [];

  for (const path of Object.keys(zip.files)) {
    const entry = zip.files[path];
    if (entry.dir) continue;

    if (NESTED_JAR.test(path)) {
      nested.push(await entry.async('arraybuffer'));
      continue;
    }

    const hit = classifyAssetPath(path);
    if (!hit) continue;

    const bucket = (byNs[hit.namespace] ||= emptyAssets())[hit.kind];
    // テクスチャだけはバイナリなので base64 に畳み、キーに拡張子を戻します。
    if (hit.kind === 'textures') {
      bucket[`${hit.id}.png`] = bytesToBase64(new Uint8Array(await entry.async('arraybuffer')));
      continue;
    }
    bucket[hit.id] = await entry.async('string');
  }

  return nested;
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
