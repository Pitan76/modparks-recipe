/**
 * @fileoverview 共通タグ（`c:`）の基盤データを R2 に取り込むスクリプト。
 *
 * `c:` タグは個々の mod ではなくローダー側のライブラリが定義しており、mod の jar には
 * 自分が足す分の断片しか入っていません。土台が無いと `#c:ingots/copper` のような
 * ありふれた参照すら解決できないため、ここで一括して入れます。
 *
 * 取得元は Fabric API の `fabric-convention-tags-v2` です。NeoForge も同じ `c:` タグを
 * 配っていますが、タグ名の集合は Fabric 側の部分集合だったので、1つに絞っています。
 * ただし Fabric API は JiJ（jar in jar）なので、本体直下ではなく `META-INF/jars/` の中を見ます。
 *
 * mod 固有の `c:` タグ（`c:ingots/tin` など）は、ポータル経由の投稿が書き込みAPI側の
 * 統合処理でこの土台に積み増します。ここで入れるのはあくまで基盤分です。
 */

import * as unzipper from 'unzipper';
import { uploadToR2, runPool, BUCKET_NAME } from './r2';

const METADATA_URL = 'https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/maven-metadata.xml';

/** JiJ の中から探す、共通タグを持つモジュール。 */
const CONVENTION_JAR = /^META-INF\/jars\/fabric-convention-tags-v2-.*\.jar$/;

/** R2 へ写す対象。jar 内のパスをそのまま R2 キーにします。 */
const TAG_PATH = /^data\/c\/tags\/.*\.json$/;

/**
 * Fabric API の最新リリース版とその jar の URL を取得します。
 */
async function fetchLatestFabricApi(): Promise<{ url: string; version: string }> {
  const res = await fetch(METADATA_URL);
  if (!res.ok) throw new Error(`Failed to fetch fabric-api metadata: ${res.statusText}`);

  const xml = await res.text();
  const version = xml.match(/<release>([^<]+)<\/release>/)?.[1];
  if (!version) throw new Error('Could not find <release> in fabric-api metadata');

  // 版名に `+` を含むため、URL に埋める前にエスケープが要ります
  const encoded = encodeURIComponent(version);
  return {
    url: `https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/${encoded}/fabric-api-${encoded}.jar`,
    version,
  };
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
 * jar から `data/c/tags/**.json` を抜き出します。
 * @param jar 共通タグを持つ jar
 */
async function extractCommonTags(jar: Buffer): Promise<{ key: string; body: Buffer }[]> {
  const dir = await unzipper.Open.buffer(jar);
  const targets = dir.files.filter((f) => f.type === 'File' && TAG_PATH.test(f.path));

  const entries: { key: string; body: Buffer }[] = [];
  for (const file of targets) entries.push({ key: file.path, body: await file.buffer() });
  return entries;
}

/**
 * 取り出したタグを R2 へ書き込みます。
 * @param entries R2 キーと中身の組
 * @returns 失敗した件数
 */
async function uploadAll(entries: { key: string; body: Buffer }[]): Promise<number> {
  let uploaded = 0;
  let failed = 0;

  await runPool(entries, 20, async ({ key, body }) => {
    try {
      await uploadToR2(key, body);
      uploaded++;
      if (uploaded % 100 === 0) console.log(`  Uploaded ${uploaded}/${entries.length}...`);
    } catch (e) {
      failed++;
      console.error(`  Failed to upload ${key}:`, (e as Error).message);
    }
  });

  console.log(`Done. Uploaded ${uploaded} files, ${failed} failures.`);
  return failed;
}

/** 実行本体。 */
async function run() {
  const { url, version } = await fetchLatestFabricApi();
  console.log(`fabric-api ${version}`);

  console.log('Downloading fabric-api...');
  const conventionJar = await extractConventionJar(await download(url));

  const entries = await extractCommonTags(conventionJar);
  console.log(`Extracted ${entries.length} common tags.`);
  if (entries.length === 0) throw new Error('No common tags found; the jar layout may have changed');

  console.log(`Uploading to R2 bucket "${BUCKET_NAME}"...`);
  if (await uploadAll(entries) > 0) process.exit(1);
}

run().catch((error) => {
  console.error('Error during execution:', error);
  process.exit(1);
});
