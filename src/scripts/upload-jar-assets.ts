/**
 * @fileoverview 書き込みAPIを介して、client.jar のアセットの一部を R2 にアップロードするスクリプト。
 * 使用例:
 *   npx tsx src/scripts/upload-jar-assets.ts '<in-jar path regex>' [baseUrl]
 *   npx tsx src/scripts/upload-jar-assets.ts '^assets/minecraft/textures/entity/'
 *
 * R2 S3 の認証情報は不要で、アップロード用シークレット（UPLOAD_SECRET または ADMIN_SECRET）のみが必要です。
 * そのため、Workerのシークレットのみを持つマシンからでも動作します。
 * `fetch-mc-data.ts` が以前抽出しなかったパスのアセットを後から補完するために使用します。
 */

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
    // JAR内のパスがそのまま R2 のオブジェクトキーになります。
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
