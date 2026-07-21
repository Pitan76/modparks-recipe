// Push a subset of client.jar's assets into R2 through the write API.
//
//   npx tsx src/scripts/upload-jar-assets.ts '<in-jar path regex>' [baseUrl]
//   npx tsx src/scripts/upload-jar-assets.ts '^assets/minecraft/textures/entity/'
//
// Only needs the upload secret (UPLOAD_SECRET or ADMIN_SECRET), not the R2 S3
// credentials, so it works from a machine that only has the Worker's secret.
// Use it to backfill a path that fetch-mc-data.ts did not previously extract.

import fs from 'fs';
import path from 'path';
import * as unzipper from 'unzipper';
import dotenv from 'dotenv';
import { uploadAll } from './upload-target';

dotenv.config();

const JAR_PATH = path.join(process.cwd(), 'client.jar');

async function main() {
  const pattern = process.argv[2];
  if (!pattern) {
    console.error("Usage: upload-jar-assets.ts '<in-jar path regex>' [baseUrl]");
    process.exit(1);
  }
  if (!fs.existsSync(JAR_PATH)) {
    console.error(`${JAR_PATH} not found. Run: npm run fetch-mc-data`);
    process.exit(1);
  }

  const re = new RegExp(pattern);
  const items: { key: string; body: Buffer }[] = [];

  const zip = fs.createReadStream(JAR_PATH).pipe(unzipper.Parse({ forceStream: true }));
  for await (const entry of zip) {
    if (entry.type !== 'File' || !re.test(entry.path)) {
      entry.autodrain();
      continue;
    }
    // In-jar paths are already the R2 keys.
    items.push({ key: entry.path, body: await entry.buffer() });
  }

  if (items.length === 0) {
    console.log(`No jar entries matched ${pattern}`);
    return;
  }

  console.log(`Uploading ${items.length} entries matching ${pattern} ...`);
  await uploadAll(items, (done) => {
    if (done % 50 === 0 || done === items.length) console.log(`  ${done}/${items.length}`);
  });
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
