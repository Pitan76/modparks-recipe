/**
 * @fileoverview 配布するクライアントバンドルと、Worker が参照する一覧の整合を確かめます。
 *
 * `build:client` は出力先を空にしてから作り直します。途中で失敗すると `public/app` が空のまま
 * `src/generated/client-bundles.ts` だけが古いファイル名を指し、ページが真っ白になります。
 * デプロイ前にここで止めれば、その状態を配らずに済みます。
 */

import { readFileSync, readdirSync } from 'fs';

const MANIFEST = 'src/generated/client-bundles.ts';
const OUT_DIR = 'public/app';

/**
 * 一覧に載っているバンドル名を取り出します。
 * @returns エントリ名からファイル名への対応
 */
function readManifest() {
  const source = readFileSync(MANIFEST, 'utf8');
  return Object.fromEntries([...source.matchAll(/"([\w-]+)":\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]));
}

const entries = Object.entries(readManifest());
if (entries.length === 0) {
  console.error(`${MANIFEST} にバンドルが1つも載っていません。npm run build:client を実行してください。`);
  process.exit(1);
}

const built = new Set(readdirSync(OUT_DIR));
const missing = entries.filter(([, file]) => !built.has(file));

if (missing.length > 0) {
  console.error('クライアントバンドルが揃っていません。この状態でデプロイするとページが表示されません。');
  for (const [name, file] of missing) console.error(`  ${name}: ${file} が ${OUT_DIR} にありません`);
  console.error('npm run build:client が成功していることを確かめてください。');
  process.exit(1);
}

console.log(`client bundles OK (${entries.map(([name, file]) => `${name}=${file}`).join(', ')})`);
