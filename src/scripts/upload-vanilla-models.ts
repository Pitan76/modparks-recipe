/**
 * @fileoverview バニラのモデルJSON（assets/minecraft/models/**.json）とアイテム定義（assets/minecraft/items/**.json）を
 * R2 にアップロードするスクリプト。
 *
 * Modのブロックモデルはバニラの親モデルを継承するため（"parent": "minecraft:block/cube" など）、
 * これらがないと Worker はModブロックのジオメトリを解決できず、平面的な2Dテクスチャにフォールバックしてしまいます。
 * アイテム定義は 1.21.4 以降の見た目の起点で、`models/item/<id>.json` を持たないアイテム（時計・コンパス・
 * ベッド・頭部）はこれが無いと何も描けず空きスロットになります。
 * 認証付きの一括書き込み API を介してアップロードするため、アップロード用シークレットのみが必要で、R2 S3 の認証情報は不要です。
 *
 * 使用例:
 *   npx tsx src/scripts/upload-vanilla-models.ts [baseUrl]
 *
 * baseUrl はデフォルトで http://localhost:8799（productionバケットに紐付いた `npm run dev:remote` サーバー）です。
 * シークレットは環境変数または `.env` の UPLOAD_SECRET または ADMIN_SECRET から取得します。
 */

import * as unzipper from 'unzipper';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';
const JAR_PATH = path.join(process.cwd(), 'client.jar');
const MODEL_RE = /^assets\/minecraft\/models\/(.+)\.json$/;
/** 1.21.4 以降のアイテムモデル定義。`models/item/<id>.json` を持たないアイテムはここだけが見た目の起点。 */
const ITEM_RE = /^assets\/minecraft\/items\/(.+)\.json$/;
const BATCH_SIZE = 150;

const BASE_URL = (process.argv[2] || 'http://localhost:8799').replace(/\/$/, '');
const SECRET = process.env.UPLOAD_SECRET || process.env.ADMIN_SECRET;

/**
 * 実行ディレクトリに client.jar が存在することを確認し、なければ最新のものを自動でダウンロードします。
 */
async function ensureJar(): Promise<void> {
  if (fs.existsSync(JAR_PATH)) {
    console.log(`Using existing ${JAR_PATH}`);
    return;
  }
  console.log('Fetching version manifest...');
  const manifest = (await (await fetch(MANIFEST_URL)).json()) as any;
  const version = manifest.versions.find((v: any) => v.id === manifest.latest.release);
  const details = (await (await fetch(version.url)).json()) as any;

  console.log(`Downloading client.jar (${manifest.latest.release})...`);
  const res = await fetch(details.downloads.client.url);
  if (!res.body) throw new Error('No response body for client.jar');
  await new Promise<void>((resolve, reject) => {
    Readable.fromWeb(res.body as any)
      .pipe(fs.createWriteStream(JAR_PATH))
      .on('finish', () => resolve())
      .on('error', reject);
  });
}

/** 抽出結果。bulk API のボディのキーと一致させています。 */
type VanillaAssets = { models: Record<string, string>; items: Record<string, string> };

/**
 * `models/` 配下のパス（例: "block/cube"）と `items/` 配下のパスをキーに、バニラ定義を抽出します。
 */
async function readAssets(): Promise<VanillaAssets> {
  const out: VanillaAssets = { models: {}, items: {} };
  const zip = fs.createReadStream(JAR_PATH).pipe(unzipper.Parse({ forceStream: true }));
  for await (const entry of zip) {
    const model = MODEL_RE.exec(entry.path);
    const item = model ? null : ITEM_RE.exec(entry.path);
    if (!model && !item) {
      entry.autodrain();
      continue;
    }
    const body = (await entry.buffer()).toString('utf-8');
    if (model) out.models[model[1]] = body;
    else out.items[item![1]] = body;
  }
  return out;
}

/**
 * 指定されたバッチを一括API経由でアップロードします。
 * @param kind bulk API のボディのキー（`models` または `items`）
 * @param batch パスとJSON文字列のマップ
 * @returns アップロード成功した件数
 */
async function uploadBatch(kind: keyof VanillaAssets, batch: Record<string, string>): Promise<number> {
  const res = await fetch(`${BASE_URL}/api/minecraft/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
    body: JSON.stringify({ [kind]: batch }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return ((await res.json()) as any)[kind] ?? 0;
}

/**
 * 1種別をバッチに割ってアップロードします。
 * @param kind bulk API のボディのキー
 * @param entries パスとJSON文字列のマップ
 */
async function uploadKind(kind: keyof VanillaAssets, entries: Record<string, string>): Promise<void> {
  const paths = Object.keys(entries).sort();
  // 1.21.3 以前の client.jar には `items/` が無く、0件のまま送ると空の bulk でバージョンだけが上がります。
  if (paths.length === 0) return console.log(`No ${kind} in this client.jar. Skipping.`);

  console.log(`Uploading ${paths.length} ${kind} to ${BASE_URL} ...`);

  let uploaded = 0;
  for (let i = 0; i < paths.length; i += BATCH_SIZE) {
    const batch: Record<string, string> = {};
    for (const p of paths.slice(i, i + BATCH_SIZE)) batch[p] = entries[p];
    uploaded += await uploadBatch(kind, batch);
    console.log(`  ${kind} ${uploaded}/${paths.length}`);
  }
}

async function main() {
  if (!SECRET) {
    console.error('Set UPLOAD_SECRET or ADMIN_SECRET (.env or environment).');
    process.exit(1);
  }

  await ensureJar();
  console.log('Extracting vanilla models and item definitions from client.jar...');
  const assets = await readAssets();

  await uploadKind('models', assets.models);
  await uploadKind('items', assets.items);

  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
