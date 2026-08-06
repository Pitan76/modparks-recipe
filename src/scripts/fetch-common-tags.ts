/**
 * @fileoverview ローダーが定義するタグ（`c:` と `neoforge:`）の基盤データを R2 に取り込むスクリプト。
 *
 * これらのタグは個々の mod ではなくローダー側が定義しており、mod の jar には自分が足す分の
 * 断片しか入っていません。土台が無いと `#c:ingots/copper` のようなありふれた参照すら解決できません。
 *
 * 取得元は2つです。
 * - Fabric API: `c:` の共通タグ。JiJ（jar in jar）なので `META-INF/jars/` の中を見ます。
 *   NeoForge も同じ `c:` を配っていますが、タグ名の集合は Fabric 側の部分集合でした。
 * - NeoForge: `neoforge:` 固有のタグ。`neoforge:enchanting_fuels` のように `c:` には無いものがあります。
 *
 * mod 固有のタグ（`c:ingots/tin` など）は、ポータル経由の投稿が書き込みAPI側の統合処理で
 * この土台に積み増します。ここで入れるのはあくまで基盤分です。
 */

import * as unzipper from 'unzipper';
import { TAG_DIRS } from '../core/paths';
import { describeTarget, pushTags, targetProblem, type TagEntry } from './tag-push';

/** JiJ の中から探す、共通タグを持つモジュール。 */
const CONVENTION_JAR = /^META-INF\/jars\/fabric-convention-tags-v2-.*\.jar$/;

/**
 * 取り込む対象のパターンを組み立てます。
 *
 * 描画で引かれるディレクトリだけに絞ります。jar には `worldgen` や `damage_type` のタグも
 * 入っていますが、レシピの素材解決からは辿り着かないため置いても読まれません。
 * @param ns タグのネームスペース
 */
function tagPathOf(ns: string): RegExp {
  return new RegExp(`^data/${ns}/tags/(?:${TAG_DIRS.join('|')})/.*\\.json$`);
}

/** タグの取得元。 */
interface TagSource {
  name: string;
  /** 投入先のネームスペース */
  ns: string;
  /** maven-metadata.xml の場所 */
  metadata: string;
  /** 版から jar の URL を組み立てます */
  jarUrl: (version: string) => string;
  /** 同梱 jar を使う場合の取り出し方 */
  unwrap?: (jar: Buffer) => Promise<Buffer>;
  /** 写す対象 */
  path: RegExp;
}

const FABRIC_MAVEN = 'https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api';
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';

const SOURCES: TagSource[] = [
  {
    name: 'fabric-api',
    ns: 'c',
    metadata: `${FABRIC_MAVEN}/maven-metadata.xml`,
    // 版名に `+` を含むため、URL に埋める前にエスケープが要ります
    jarUrl: (v) => `${FABRIC_MAVEN}/${encodeURIComponent(v)}/fabric-api-${encodeURIComponent(v)}.jar`,
    unwrap: extractConventionJar,
    path: tagPathOf('c'),
  },
  {
    name: 'neoforge',
    ns: 'neoforge',
    metadata: `${NEOFORGE_MAVEN}/maven-metadata.xml`,
    jarUrl: (v) => `${NEOFORGE_MAVEN}/${v}/neoforge-${v}-universal.jar`,
    path: tagPathOf('neoforge'),
  },
];

/**
 * maven-metadata.xml から最新のリリース版を読みます。
 * @param source 取得元
 */
async function fetchLatestVersion(source: TagSource): Promise<string> {
  const res = await fetch(source.metadata);
  if (!res.ok) throw new Error(`Failed to fetch ${source.name} metadata: ${res.statusText}`);

  const version = (await res.text()).match(/<release>([^<]+)<\/release>/)?.[1];
  if (!version) throw new Error(`Could not find <release> in ${source.name} metadata`);
  return version;
}

/**
 * URL の中身をメモリ上に読み込みます。
 * @param url 取得先
 */
async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Fabric API の jar から、共通タグを持つ内側の jar を取り出します。
 * @param jar Fabric API 本体の jar
 */
async function extractConventionJar(jar: Buffer): Promise<Buffer> {
  const dir = await unzipper.Open.buffer(jar);
  const entry = dir.files.find((f) => CONVENTION_JAR.test(f.path));
  if (!entry) throw new Error('fabric-convention-tags-v2 jar not found in fabric-api');

  console.log(`  Found nested jar: ${entry.path}`);
  return entry.buffer();
}

/**
 * jar からタグJSONを抜き出します。
 * @param jar 対象の jar
 * @param path 写す対象のパターン
 */
async function extractTags(jar: Buffer, source: TagSource): Promise<TagEntry[]> {
  const dir = await unzipper.Open.buffer(jar);
  const targets = dir.files.filter((f) => f.type === 'File' && source.path.test(f.path));
  // 書き込みAPIが受けるのは `item/planks` のような種別からの相対パスです。
  const prefix = `data/${source.ns}/tags/`;

  const entries: TagEntry[] = [];
  for (const file of targets) {
    entries.push({ path: file.path.slice(prefix.length), body: (await file.buffer()).toString('utf-8') });
  }
  return entries;
}

/**
 * 1つの取得元からタグを集めます。
 * @param source 取得元
 */
async function collectFrom(source: TagSource): Promise<TagEntry[]> {
  const version = await fetchLatestVersion(source);
  console.log(`${source.name} ${version}`);

  console.log(`  Downloading ${source.name}...`);
  const jar = await download(source.jarUrl(version));
  const target = source.unwrap ? await source.unwrap(jar) : jar;

  const entries = await extractTags(target, source);
  console.log(`  Extracted ${entries.length} tags.`);
  if (entries.length === 0) throw new Error(`No tags found in ${source.name}; the jar layout may have changed`);
  return entries;
}

/** 実行本体。 */
async function run() {
  const problem = targetProblem();
  if (problem) throw new Error(problem);
  console.log(`Target: ${describeTarget()}`);

  for (const source of SOURCES) {
    const entries = await collectFrom(source);
    await pushTags(source.ns, entries);
  }
}

run().catch((error) => {
  console.error('Error during execution:', error);
  process.exit(1);
});
