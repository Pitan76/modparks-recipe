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

// Extract the result item id from a recipe JSON across the various shapes
// Minecraft has used (result as a string, {item}, or {id}).
function resultItemOf(data: any): string | null {
  const r = data?.result;
  if (!r) return null;
  const id = typeof r === 'string' ? r : (r.id || r.item || null);
  if (!id || typeof id !== 'string') return null;
  return id.includes(':') ? id : `minecraft:${id}`;
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
    // (grouped by result item) without any per-request scanning. Both the recipe
    // id and its result item are derived from data we already have in memory.
    const recipes: { id: string; result: string | null }[] = [];
    for (const entry of entries) {
      const m = entry.key.match(/^data\/([^/]+)\/recipes?\/(.+)\.json$/);
      if (!m) continue;
      let result: string | null = null;
      try {
        result = resultItemOf(JSON.parse(entry.body.toString('utf-8')));
      } catch {
        // ignore malformed recipe json
      }
      recipes.push({ id: `${m[1]}:${m[2]}`, result });
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
