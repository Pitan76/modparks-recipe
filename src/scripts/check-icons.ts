/**
 * @fileoverview 全アイテムのアイコンが描けるかを総当たりで確かめます。
 *
 * 空きスロットは、レシピ画像が出来上がってしまうぶん壊れていることに気づきにくい不具合です。
 * 時計とコンパスは「`items/` の定義に既定が無い」と「`items/` がサーバに載っていない」の2つが
 * 重なって長く空のままでした。どちらも1件ずつ目で見ていては見つかりません。ここで全件を回します。
 *
 * まだ描けないものは記録（{@link BASELINE_PATH}）に残し、そこから増えたときだけ失敗させます。
 * 残件を抱えたままでも退行だけは止められるようにするためです。
 *
 * 使用例:
 *   npx tsx src/scripts/check-icons.ts                       # 記録と突き合わせ（デプロイ前の検証）
 *   npx tsx src/scripts/check-icons.ts --update              # 現状を記録し直す
 *   npx tsx src/scripts/check-icons.ts --url https://<host>  # 稼働中のサーバの資産で確かめる
 *   npx tsx src/scripts/check-icons.ts --ns mymod            # ネームスペース指定
 */

import path from 'path';
import fs from 'fs';
import { renderBlockIconSvg } from '../utils/block-icon';
import { RENDERER_VERSION } from '../generated/render-version';
import { jarSource, remoteSource, type IconSource } from './icon-check/readers';
import {
  BASELINE_PATH,
  assetFingerprintOf,
  diffBaseline,
  isVerified,
  markVerified,
  writeBaseline,
} from './icon-check/baseline';

const JAR_PATH = path.join(process.cwd(), 'client.jar');

/** 同時に描く本数。サーバ経由では1件ごとに複数回の資産取得が走るため、控えめにします。 */
const CONCURRENCY = 16;

/**
 * 空で正しいもの。空気には見た目がありません。
 *
 * 記録とは別に持ちます。記録は「いつか描けるようにしたいもの」で減らしていく対象ですが、
 * こちらは仕様として永久に空です。混ぜると残件の数が読めなくなります。
 */
const EXPECTED_EMPTY = new Set(['air']);

/** コマンドラインから読んだ指示。 */
interface Options {
  update: boolean;
  url: string | null;
  ns: string;
}

/**
 * 引数を読みます。
 * @param argv 引数（実行ファイル部分を除いたもの）
 */
function parseArgs(argv: string[]): Options {
  const valueOf = (name: string) => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] ?? null : null;
  };
  return { update: argv.includes('--update'), url: valueOf('--url'), ns: valueOf('--ns') ?? 'minecraft' };
}

/**
 * 読み出し口を選びます。
 * @param url 指定されていればサーバ経由、無ければ手元の jar
 */
async function sourceFor(url: string | null): Promise<IconSource> {
  if (!fs.existsSync(JAR_PATH)) throw new Error(`client.jar not found at ${JAR_PATH}. Run fetch-mc-data first.`);
  return url ? remoteSource(url, JAR_PATH) : jarSource(JAR_PATH);
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

/**
 * 空アイコンを数え上げます。
 * @param opts 指示
 * @returns 対象件数と、空になったID
 */
async function collectEmpty(opts: Options): Promise<{ total: number; empty: string[] }> {
  const src = await sourceFor(opts.url);
  const all = await src.itemIds(opts.ns);
  if (all.length === 0) throw new Error(`No items found for namespace "${opts.ns}".`);

  const ids = all.filter((id) => !EXPECTED_EMPTY.has(id));
  console.log(`Checking ${ids.length} icons for "${opts.ns}" via ${opts.url ?? JAR_PATH} ...`);
  return { total: ids.length, empty: await findEmpty(ids, src, opts.ns) };
}

/**
 * 現状を記録し直します。
 * @param opts 指示
 * @param fingerprint 素材の指紋
 */
async function update(opts: Options, fingerprint: string): Promise<void> {
  const { total, empty } = await collectEmpty(opts);
  writeBaseline(opts.ns, empty);
  markVerified(opts.ns, RENDERER_VERSION, fingerprint);
  console.log(`${BASELINE_PATH} updated: ${empty.length}/${total} known empty (render ${RENDERER_VERSION}).`);
}

/**
 * 記録と突き合わせます。
 * @param opts 指示
 * @param fingerprint 素材の指紋
 */
async function check(opts: Options, fingerprint: string): Promise<void> {
  // 絵はレンダリング系ソースと素材でしか決まりません。どちらも前回と同じなら描き直す意味がなく、
  // 普段のデプロイでは何も走りません。
  if (!opts.url && isVerified(opts.ns, RENDERER_VERSION, fingerprint)) {
    console.log(`icons OK (unchanged since render ${RENDERER_VERSION}; nothing to re-check)`);
    return;
  }

  const { total, empty } = await collectEmpty(opts);
  const { added, removed } = diffBaseline(opts.ns, empty);

  if (added.length > 0) {
    console.error(`\n描けなくなったアイコンが ${added.length} 件あります。この状態で配ると空きスロットになります。`);
    for (const id of added) console.error(`  ${opts.ns}:${id}`);
    process.exitCode = 1;
    return;
  }

  if (removed.length > 0) {
    console.error(`\n描けるようになったアイコンが ${removed.length} 件あります。記録が古いままです。`);
    for (const id of removed) console.error(`  ${opts.ns}:${id}`);
    console.error(`  npm run gen:icon-baseline で ${BASELINE_PATH} を更新してください。`);
    console.error('  更新しないと、この項目が再び壊れても「元から空だった」と見なされ気づけません。');
    process.exitCode = 1;
    return;
  }

  // 記録どおりだったので、次回は省けるよう前提を控えます。追跡しないファイルなので差分は濁りません。
  if (!opts.url) markVerified(opts.ns, RENDERER_VERSION, fingerprint);
  console.log(`icons OK (${total - empty.length}/${total} render, ${empty.length} known empty)`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const fingerprint = await assetFingerprintOf(JAR_PATH);

  if (opts.update) return update(opts, fingerprint);
  return check(opts, fingerprint);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
