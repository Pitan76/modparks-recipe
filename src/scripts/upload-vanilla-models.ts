// Push the vanilla model JSONs (assets/minecraft/models/**.json) into R2.
//
// Mod block models inherit vanilla parents ("parent": "minecraft:block/cube"),
// so without these the Worker can't resolve a mod block's geometry and falls
// back to a flat 2D texture. Uploads through the authenticated bulk write API,
// so it needs only the upload secret — no R2 S3 credentials.
//
//   npx tsx src/scripts/upload-vanilla-models.ts [baseUrl]
//
// baseUrl defaults to http://localhost:8799 (the `npm run dev:remote` server,
// which is bound to the production bucket). Secret comes from UPLOAD_SECRET or
// ADMIN_SECRET in the environment / .env.

import * as unzipper from 'unzipper';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';
const JAR_PATH = path.join(process.cwd(), 'client.jar');
const MODEL_RE = /^assets\/minecraft\/models\/(.+)\.json$/;
const BATCH_SIZE = 150;

const BASE_URL = (process.argv[2] || 'http://localhost:8799').replace(/\/$/, '');
const SECRET = process.env.UPLOAD_SECRET || process.env.ADMIN_SECRET;

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

/** Extract every vanilla model, keyed by its path under models/ (e.g. "block/cube"). */
async function readModels(): Promise<Record<string, string>> {
  const models: Record<string, string> = {};
  const zip = fs.createReadStream(JAR_PATH).pipe(unzipper.Parse({ forceStream: true }));
  for await (const entry of zip) {
    const m = MODEL_RE.exec(entry.path);
    if (!m) {
      entry.autodrain();
      continue;
    }
    models[m[1]] = (await entry.buffer()).toString('utf-8');
  }
  return models;
}

async function uploadBatch(batch: Record<string, string>): Promise<number> {
  const res = await fetch(`${BASE_URL}/api/minecraft/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
    body: JSON.stringify({ models: batch }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return ((await res.json()) as any).models ?? 0;
}

async function main() {
  if (!SECRET) {
    console.error('Set UPLOAD_SECRET or ADMIN_SECRET (.env or environment).');
    process.exit(1);
  }

  await ensureJar();
  console.log('Extracting vanilla models from client.jar...');
  const models = await readModels();
  const paths = Object.keys(models).sort();
  console.log(`Found ${paths.length} models. Uploading to ${BASE_URL} ...`);

  let uploaded = 0;
  for (let i = 0; i < paths.length; i += BATCH_SIZE) {
    const batch: Record<string, string> = {};
    for (const p of paths.slice(i, i + BATCH_SIZE)) batch[p] = models[p];
    uploaded += await uploadBatch(batch);
    console.log(`  ${uploaded}/${paths.length}`);
  }

  console.log(`Done. Uploaded ${uploaded} vanilla model JSONs.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
