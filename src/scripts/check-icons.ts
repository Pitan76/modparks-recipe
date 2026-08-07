/**
 * @fileoverview 全アイテムのアイコンが描けるかを総当たりで確かめ、1つでも空なら失敗で終わる検証。
 *
 * 空きスロットは、レシピ画像が出来上がってしまうぶん壊れていることに気づきにくい不具合です。
 * 時計とコンパスは「`items/` の定義に既定が無い」と「`items/` がサーバに載っていない」の2つが
 * 重なって長く空のままでした。どちらも1件ずつ目で見ていては見つかりません。ここで全件を回します。
 *
 * 使用例:
 *   npx tsx src/scripts/check-icons.ts                       # 手元の client.jar を読んで検証
 *   npx tsx src/scripts/check-icons.ts https://<host>        # 稼働中のサーバの資産を読んで検証
 *   npx tsx src/scripts/check-icons.ts https://<host> mymod  # ネームスペース指定
 */

import path from 'path';
import fs from 'fs';
import { renderBlockIconSvg } from '../utils/block-icon';
import { jarSource, remoteSource, type IconSource } from './icon-check/readers';

const JAR_PATH = path.join(process.cwd(), 'client.jar');

/** 同時に描く本数。サーバ経由では1件ごとに複数回の資産取得が走るため、控えめにします。 */
const CONCURRENCY = 16;

/** 空で正しいもの。空気には見た目がありません。 */
const EXPECTED_EMPTY = new Set(['air']);

/**
 * 引数から読み出し口を選びます。
 * @param baseUrl 指定されていればサーバ経由、無ければ手元の jar
 */
async function sourceFor(baseUrl: string | undefined): Promise<IconSource> {
  if (!fs.existsSync(JAR_PATH)) throw new Error(`client.jar not found at ${JAR_PATH}. Run fetch-mc-data first.`);
  if (!baseUrl) return jarSource(JAR_PATH);
  return remoteSource(baseUrl, JAR_PATH);
}

/**
 * IDを並行に処理し、空になったものだけを返します。
 * @param ids 検証対象のアイテムID
 * @param src 読み出し口
 * @param ns ネームスペース
 */
async function findEmpty(ids: string[], src: IconSource, ns: string): Promise<string[]> {
  const empty: string[] = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      const svg = await renderBlockIconSvg(null, ns, id, src);
      if (!svg) empty.push(id);
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return empty.sort();
}

async function main() {
  const baseUrl = process.argv[2];
  const ns = process.argv[3] || 'minecraft';

  const src = await sourceFor(baseUrl);
  const all = await src.itemIds(ns);
  if (all.length === 0) throw new Error(`No items found for namespace "${ns}".`);

  const ids = all.filter((id) => !EXPECTED_EMPTY.has(id));

  console.log(`Checking ${ids.length} icons for "${ns}" via ${baseUrl ?? JAR_PATH} ...`);
  const empty = await findEmpty(ids, src, ns);

  if (empty.length === 0) {
    console.log(`OK. All ${ids.length} icons render.`);
    return;
  }

  console.error(`\n${empty.length}/${ids.length} icons render empty:`);
  for (const id of empty) console.error(`  ${ns}:${id}`);
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
