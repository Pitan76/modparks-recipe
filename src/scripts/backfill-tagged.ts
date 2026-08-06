/**
 * @fileoverview 既存の `index/recipes.json` に `tagged` を埋める移行スクリプト。
 *
 * `tagged` は索引作成時に付くようになりましたが、それ以前に投入されたエントリは持ちません。
 * 持たないエントリは「タグ無し」と同じ扱いになるため壊れはしませんが、素材が切り替わるレシピが
 * 静止画のままになります。ここでレシピ本体を読み直して1回だけ埋めます。
 *
 * 索引は全ネームスペース分が1ファイルなので、読み書きは各1回で済みます。
 */

import { getFromR2, uploadToR2, runPool } from './r2';
import { hasTagIngredient } from '../core/recipe';

const INDEX_KEY = 'index/recipes.json';

/** 索引に載る1レシピ。 */
type Entry = { id: string; result: string | null; type: string; tagged?: boolean };

/**
 * レシピ本体をR2から読みます。単数形・複数形の両方の配置を見ます。
 * @param id 完全修飾レシピID
 * @returns 読めなければ null
 */
async function readRecipe(id: string): Promise<any | null> {
  const [namespace, ...rest] = id.split(':');
  const path = rest.join(':');

  for (const dir of ['recipe', 'recipes']) {
    const buf = await getFromR2(`data/${namespace}/${dir}/${path}.json`);
    if (!buf) continue;
    try {
      return JSON.parse(buf.toString('utf-8'));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 索引の各エントリに `tagged` を埋めます。
 * @param entries 索引のエントリ群
 * @returns 埋めた件数と、本体を読めなかった件数
 */
async function fill(entries: Entry[]): Promise<{ tagged: number; missing: number }> {
  let tagged = 0;
  let missing = 0;
  let done = 0;

  await runPool(entries, 20, async (entry) => {
    const data = await readRecipe(entry.id);
    done++;
    if (done % 200 === 0) console.log(`  ${done}/${entries.length}...`);

    if (!data) {
      missing++;
      return;
    }
    if (!hasTagIngredient(data)) {
      delete entry.tagged;
      return;
    }
    entry.tagged = true;
    tagged++;
  });

  return { tagged, missing };
}

/** 実行本体。 */
async function run() {
  const buf = await getFromR2(INDEX_KEY);
  if (!buf) throw new Error(`${INDEX_KEY} not found`);

  const index = JSON.parse(buf.toString('utf-8'));
  const entries: Entry[] = Array.isArray(index.recipes) ? index.recipes : [];
  if (entries.length === 0) throw new Error('No recipes in index');
  console.log(`Index has ${entries.length} recipes.`);

  const { tagged, missing } = await fill(entries);
  console.log(`tagged: ${tagged}, body missing: ${missing}`);

  await uploadToR2(INDEX_KEY, Buffer.from(JSON.stringify(index)));
  console.log(`Wrote ${INDEX_KEY}.`);
}

run().catch((error) => {
  console.error('Error during execution:', error);
  process.exit(1);
});
