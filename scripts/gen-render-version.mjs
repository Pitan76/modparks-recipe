/**
 * @fileoverview レンダリング系ソースの指紋から、レンダラー版を生成・検証します。
 *
 * この値は L1 のキーに載るため、レンダリング結果が変わったのに値が据え置きだと、新しい絵が
 * 出来ているのに古い絵が返り続けます。手で上げる運用にしていたところ、実際に時計の描画を直した
 * 日に上げ忘れが起き、原因の切り分けに時間を取られました。人が覚えておく必要をなくします。
 *
 * 使い方:
 *   node scripts/gen-render-version.mjs          # 生成（build 時）
 *   node scripts/gen-render-version.mjs --check  # 生成物が最新かを確かめ、古ければ失敗する
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

const OUT = 'src/generated/render-version.ts';

/**
 * 指紋の対象。レンダリング結果を左右するものだけを挙げます。
 *
 * 広く採るほど「取りこぼして古い絵が残る」事故は減りますが、無関係な変更でも全画像が作り直され
 * ます。逆に狭すぎると上げ忘れと同じことが起きます。実際に描き方を決めているファイルに限る、
 * という基準で選んでいます。ここに載せ忘れたファイルは版に影響しません。
 */
const SOURCES = [
  'src/core/renderer.ts',
  'src/core/model-parser.ts',
  'src/core/model-compose.ts',
  'src/core/block-geometry.ts',
  'src/core/item-definition.ts',
  'src/core/entity-box.ts',
  'src/core/chest.ts',
  'src/core/skull.ts',
  'src/core/math.ts',
  'src/utils/block-icon.ts',
  'src/utils/image-generator',
];

/** 版の先頭に付ける印。値の出所が分かるようにしておきます。 */
const PREFIX = 'r';

/** 指紋として載せる長さ。キーに入るので短く保ちます。 */
const FINGERPRINT_LENGTH = 10;

/**
 * パスがディレクトリならその中のソースを、ファイルならそれ自身を並べます。
 * @param path 対象パス
 * @returns ファイルパスの配列
 */
function expand(path) {
  if (!existsSync(path)) throw new Error(`${path} が見つかりません。SOURCES を見直してください。`);
  if (!statSync(path).isDirectory()) return [path];

  return readdirSync(path)
    .map((name) => join(path, name))
    .flatMap((child) => expand(child))
    .filter((file) => file.endsWith('.ts'));
}

/**
 * レンダリング系ソースの指紋を計算します。
 * @returns レンダラー版の文字列
 */
function computeVersion() {
  const files = SOURCES.flatMap((path) => expand(path)).sort();

  const hash = createHash('sha256');
  // ファイル名も混ぜます。中身を別ファイルへ移しただけの変更でも版が動くようにするためです。
  // 改行は揃えてから畳みます。生バイトのままだと、チェックアウトの仕方（Windows での CRLF 変換）
  // だけで版が変わり、OS の違う環境からデプロイするたびに全画像が無駄に作り直されます。
  for (const file of files) {
    hash.update(file.replace(/\\/g, '/'));
    hash.update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
  }
  return `${PREFIX}${hash.digest('hex').slice(0, FINGERPRINT_LENGTH)}`;
}

/**
 * 生成物の中身を作ります。
 * @param version レンダラー版
 */
function render(version) {
  return `/** 自動生成。\`npm run gen:render-version\` が書き換えます。手で編集しないこと。 */\n`
    + `export const RENDERER_VERSION = '${version}';\n`;
}

const version = computeVersion();
const wanted = render(version);
const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;

if (process.argv.includes('--check')) {
  if (current === wanted) {
    console.log(`render version OK (${version})`);
    process.exit(0);
  }
  console.error('レンダラー版が古いままです。この状態でデプロイすると、新しい絵ができても古い絵が返り続けます。');
  console.error(`  ${OUT} を npm run gen:render-version で作り直してください。`);
  process.exit(1);
}

if (current === wanted) {
  console.log(`render version unchanged (${version})`);
} else {
  writeFileSync(OUT, wanted, 'utf8');
  console.log(`render version updated -> ${version}`);
}
