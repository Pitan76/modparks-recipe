import * as unzipper from 'unzipper';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import { uploadToR2, runPool, BUCKET_NAME } from './r2';

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

    // Build a static recipe index so the lookup page can show a browsable list
    // without any per-request scanning. Derived purely from the recipe keys we
    // already have (e.g. data/minecraft/recipe/wooden_sword.json -> minecraft:wooden_sword).
    const ids = entries
      .map((e) => e.key)
      .map((key) => key.match(/^data\/([^/]+)\/recipes?\/(.+)\.json$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => `${m[1]}:${m[2]}`)
      .sort();
    const index = { count: ids.length, generatedAt: new Date().toISOString(), ids };
    await uploadToR2('index/recipes.json', Buffer.from(JSON.stringify(index)));
    console.log(`Wrote recipe index with ${ids.length} entries to index/recipes.json`);

    if (failed > 0) process.exit(1);
  } catch (error) {
    console.error('Error during execution:', error);
    process.exit(1);
  }
}

run();
