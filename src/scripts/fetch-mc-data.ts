/**
 * @fileoverview Minecraft のクライアントJARファイルをダウンロードし、必要なアセット（テクスチャ、モデルJSON、タグ、レシピ）を抽出して R2 バケットにアップロードするスクリプト。
 */

import * as unzipper from 'unzipper';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import { uploadToR2, runPool, BUCKET_NAME } from './r2';
import { resultItemOf, isCraftingType } from '../utils/minecraft';

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';

// JARファイルから抽出して R2 にミラーリングするファイルリスト。
// キーは JAR 内のパスを維持し、Worker が `data/...` や `assets/...textures/...` のパスで読み取れるようにします。
const TARGET_PATHS: RegExp[] = [
  /^assets\/minecraft\/textures\/item\/.*\.png$/,
  /^assets\/minecraft\/textures\/block\/.*\.png$/,
  // ブロックエンティティ（チェストなど）は平面的なブロックテクスチャを持ちません。
  // それらのスキンはエンティティアトラスに存在し、`core/chest.ts` がそれを合成されたボックスモデル上に展開します。
  /^assets\/minecraft\/textures\/entity\/.*\.png$/,
  // バニラのモデルJSON。Modのブロックモデルはこれらを継承するため（`"parent": "minecraft:block/cube"`など）、
  // バニラの親モデルがR2に存在しないと、WorkerはModブロックのジオメトリを解決できません。
  /^assets\/minecraft\/models\/.*\.json$/,
  /^data\/minecraft\/tags\/items?\/.*\.json$/,
  /^data\/minecraft\/tags\/blocks?\/.*\.json$/,
  /^data\/minecraft\/recipe.*\.json$/, // recipe/ および recipes/ にマッチします
];

/**
 * パスが抽出対象のファイルに合致するかどうかを判定します。
 * @param p 判定対象のファイルパス
 */
function shouldExtract(p: string): boolean {
  return TARGET_PATHS.some((regex) => regex.test(p));
}

/**
 * Mojangのバージョンマニフェストから、最新のMinecraftリリースのクライアントJARのダウンロードURLを取得します。
 * @returns クライアントJARのURL
 */
async function fetchLatestVersionUrl(): Promise<string> {
  console.log('Fetching version manifest...');
  const res = await fetch(MANIFEST_URL);
  if (!res.ok) throw new Error(`Failed to fetch manifest: ${res.statusText}`);
  const data = (await res.json()) as any;
  const latestRelease = data.latest.release;
  console.log(`Latest release: ${latestRelease}`);

  const versionData = data.versions.find((v: any) => v.id === latestRelease);
  if (!versionData) throw new Error('Could not find latest release data.');

  console.log('Fetching version details...');
  const versionRes = await fetch(versionData.url);
  if (!versionRes.ok) throw new Error(`Failed to fetch version details: ${versionRes.statusText}`);
  const versionJson = (await versionRes.json()) as any;
  return versionJson.downloads.client.url;
}

/**
 * 実行メイン処理。JARのダウンロード、抽出、R2アップロード、およびレシピインデックスの構築を行います。
 */
async function run() {
  try {
    const clientJarUrl = await fetchLatestVersionUrl();
    console.log(`Downloading client JAR from ${clientJarUrl}...`);

    const response = await fetch(clientJarUrl);
    if (!response.body) throw new Error('Failed to get response body');

    // 後続のステップ（render-blocks.ts）で再利用できるように、JARファイルをディスクに保存します。
    const tempFilePath = path.join(process.cwd(), 'client.jar');
    const fileStream = fs.createWriteStream(tempFilePath);
    const nodeWebStream = Readable.fromWeb(response.body as any);

    console.log('Saving client JAR to disk...');
    await new Promise<void>((resolve, reject) => {
      nodeWebStream.pipe(fileStream).on('finish', () => resolve()).on('error', reject);
    });

    // 最初に抽出対象のエントリを収集（バッファ）し、制限付きの並行プールでアップロードします。
    console.log('Extracting target entries from JAR...');
    const entries: { key: string; body: Buffer }[] = [];

    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(tempFilePath)
        .pipe(unzipper.Parse())
        .on('entry', async (entry: unzipper.Entry) => {
          const fileName = entry.path;
          if (entry.type === 'File' && shouldExtract(fileName)) {
            const buffer = await entry.buffer();
            entries.push({ key: fileName, body: buffer });
          } else {
            entry.autodrain();
          }
        })
        .on('finish', () => resolve())
        .on('error', reject);
    });

    console.log(`Uploading ${entries.length} files to R2 bucket "${BUCKET_NAME}"...`);
    let uploaded = 0;
    let failed = 0;
    await runPool(entries, 20, async ({ key, body }) => {
      try {
        await uploadToR2(key, body);
        uploaded++;
        if (uploaded % 200 === 0) console.log(`  Uploaded ${uploaded}/${entries.length}...`);
      } catch (e) {
        failed++;
        console.error(`  Failed to upload ${key}:`, (e as Error).message);
      }
    });

    console.log(`Done. Uploaded ${uploaded} files, ${failed} failures.`);

    // 検索ページが、リクエストごとのスキャンなしで閲覧可能なリスト（完成品アイテムごとにグループ化）を表示できるように、静的なレシピインデックスを構築します。
    // レシピIDと完成品アイテムは、すでにメモリ上にあるデータから取得されます。
    const recipes: { id: string; result: string | null; type: string }[] = [];
    for (const entry of entries) {
      const m = entry.key.match(/^data\/([^/]+)\/recipes?\/(.+)\.json$/);
      if (!m) continue;
      try {
        const data = JSON.parse(entry.body.toString('utf-8'));
        // 現時点ではクラフト以外のレシピはスキップします。レンダラーはクラフトのみを描画するためです。
        if (!isCraftingType(data.type)) continue;
        recipes.push({
          id: `${m[1]}:${m[2]}`,
          result: resultItemOf(data),
          type: String(data.type).replace(/^minecraft:/, ''),
        });
      } catch {
        // 不正なレシピJSONは無視します
      }
    }
    recipes.sort((a, b) => a.id.localeCompare(b.id));
    const index = { count: recipes.length, generatedAt: new Date().toISOString(), recipes };
    await uploadToR2('index/recipes.json', Buffer.from(JSON.stringify(index)));
    console.log(`Wrote recipe index with ${recipes.length} entries to index/recipes.json`);

    if (failed > 0) process.exit(1);
  } catch (error) {
    console.error('Error during execution:', error);
    process.exit(1);
  }
}

run();
