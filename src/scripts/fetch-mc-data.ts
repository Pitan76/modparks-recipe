import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import https from 'https';
import * as unzipper from 'unzipper';
import dotenv from 'dotenv';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';

// Load environment variables from .env (local runs; in CI these come from secrets)
dotenv.config();

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'mp-recipe-images';

if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
  console.error('Missing R2 credentials in environment variables.');
  console.error('Please set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY (.env for local runs).');
  process.exit(1);
}

// Initialize S3 Client pointing to Cloudflare R2
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
  },
  requestHandler: new NodeHttpHandler({
    httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50 }),
  }),
});

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';

// Files we extract from the jar and mirror into R2. Keys preserve the in-jar
// path so the Worker can read them at data/... and assets/...textures/....
const TARGET_PATHS: RegExp[] = [
  /^assets\/minecraft\/textures\/item\/.*\.png$/,
  /^assets\/minecraft\/textures\/block\/.*\.png$/,
  /^data\/minecraft\/tags\/items?\/.*\.json$/,
  /^data\/minecraft\/tags\/blocks?\/.*\.json$/,
  /^data\/minecraft\/recipe.*\.json$/, // matches recipe/ and recipes/
];

function shouldExtract(p: string): boolean {
  return TARGET_PATHS.some((regex) => regex.test(p));
}

function contentTypeFor(key: string): string {
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

async function uploadToR2(key: string, body: Buffer): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentTypeFor(key),
    })
  );
}

/** Runs async tasks with a bounded concurrency to avoid R2 rate limits. */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  });
  await Promise.all(runners);
}

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

async function run() {
  try {
    const clientJarUrl = await fetchLatestVersionUrl();
    console.log(`Downloading client JAR from ${clientJarUrl}...`);

    const response = await fetch(clientJarUrl);
    if (!response.body) throw new Error('Failed to get response body');

    // Save the jar to disk so downstream steps (render-blocks.ts) can reuse it.
    const tempFilePath = path.join(process.cwd(), 'client.jar');
    const fileStream = fs.createWriteStream(tempFilePath);
    const nodeWebStream = Readable.fromWeb(response.body as any);

    console.log('Saving client JAR to disk...');
    await new Promise<void>((resolve, reject) => {
      nodeWebStream.pipe(fileStream).on('finish', () => resolve()).on('error', reject);
    });

    // Collect the target entries first (buffered), then upload with a bounded pool.
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
    if (failed > 0) process.exit(1);
  } catch (error) {
    console.error('Error during execution:', error);
    process.exit(1);
  }
}

run();
