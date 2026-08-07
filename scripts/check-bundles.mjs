/**
 * @fileoverview 配布するクライアントバンドルが揃っているかを確かめます。
 *
 * `build:client` は出力先を空にしてから作り直します。途中で失敗すると `public/app` が欠けたまま
 * Worker は固定名の `/app/<entry>.js` を指し続け、ページが真っ白になります。
 * デプロイ前にここで止めれば、その状態を配らずに済みます。
 *
 * 分割チャンクはハッシュ付きの名前でエントリから参照されるため、参照先の実在も併せて見ます。
 */

import { existsSync, readFileSync, readdirSync } from 'fs';

const OUT_DIR = 'public/app';

/** ページごとのエントリ。`vite.client.config.ts` の入力と対応させています。 */
const ENTRY_SOURCES = { search: 'src/client/search/main.tsx', portal: 'src/client/portal/main.tsx' };

const expected = Object.keys(ENTRY_SOURCES).filter((name) => existsSync(ENTRY_SOURCES[name]));
if (expected.length === 0) {
  console.error('クライアントのエントリが1つも見つかりません。');
  process.exit(1);
}

const built = new Set(existsSync(OUT_DIR) ? readdirSync(OUT_DIR) : []);
const problems = [];

for (const name of expected) {
  const file = `${name}.js`;
  if (!built.has(file)) {
    problems.push(`${name}: ${OUT_DIR}/${file} がありません`);
    continue;
  }
  for (const chunk of importedChunks(`${OUT_DIR}/${file}`)) {
    if (!built.has(chunk)) problems.push(`${name}: 参照している ${chunk} が ${OUT_DIR} にありません`);
  }
}

if (problems.length > 0) {
  console.error('クライアントバンドルが揃っていません。この状態でデプロイするとページが表示されません。');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('npm run build:client が成功していることを確かめてください。');
  process.exit(1);
}

console.log(`client bundles OK (${expected.map((name) => `${name}.js`).join(', ')})`);

/**
 * エントリJSが読み込む同階層のチャンク名を拾います。
 * @param path エントリJSのパス
 * @returns チャンクのファイル名
 */
function importedChunks(path) {
  const source = readFileSync(path, 'utf8');
  return [...source.matchAll(/["'`]\.\/(chunk-[\w-]+\.js)["'`]/g)].map((m) => m[1]);
}
