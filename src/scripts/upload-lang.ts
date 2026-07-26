/**
 * @fileoverview アイテム名（言語ファイル）を R2 / 書き込みAPI に取り込むスクリプト。
 *
 * 使用例:
 *   npx tsx src/scripts/upload-lang.ts                      # バニラの ja_jp, en_us
 *   npx tsx src/scripts/upload-lang.ts ja_jp,en_us,zh_cn    # 対応言語を増やす
 *   npx tsx src/scripts/upload-lang.ts ja_jp,en_us --download-jar  # 必要なら client.jar も取得
 *   npx tsx src/scripts/upload-lang.ts ja_jp --jar mymod.jar  # Modのjarから抽出
 *
 * ロケールはAPI側で固定していないため、増やしたい言語をここで指定するだけで対応できます。
 *
 * バニラは2つの出所を使い分けます。en_us は client.jar にしか無く、それ以外の言語は
 * アセットインデックスにしか無いためです。アセットインデックスを先に引き、そこに無かった
 * ロケールだけ手元の client.jar から拾います（`npm run fetch-mc-data` 実行後に存在します）。
 */

import fs from 'fs';
import path from 'path';
import * as unzipper from 'unzipper';
import dotenv from 'dotenv';
import { uploadLangs, describeTarget } from './upload-target';
import { fetchVanillaLangs } from './lang/mojang-assets';
import { ensureClientJar, CLIENT_JAR_PATH } from './lang/client-jar';
import { DEFAULT_LOCALES } from '../utils/lang-store';

dotenv.config();

type LangEntry = { ns: string; locale: string; body: string };

/**
 * コマンドライン引数を解釈します。
 * @param argv `process.argv.slice(2)` 相当の引数列
 */
function parseArgs(argv: string[]): { locales: string[]; jar: string | null; download: boolean } {
  const jarIndex = argv.indexOf('--jar');
  const jar = jarIndex >= 0 ? argv[jarIndex + 1] : null;
  if (jarIndex >= 0 && !jar) throw new Error('--jar requires a path');

  const positional = argv.filter((a, i) => !a.startsWith('--') && i !== jarIndex + 1);
  const locales = positional[0] ? positional[0].split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_LOCALES;
  return { locales, jar, download: argv.includes('--download-jar') };
}

/**
 * jar内の `assets/<ns>/lang/<locale>.json` を抽出します。
 * Mod側が同梱している翻訳はこの経路で取れます。
 * @param jarPath jarファイルのパス
 * @param locales 対象ロケール
 */
async function extractFromJar(jarPath: string, locales: string[]): Promise<LangEntry[]> {
  if (!fs.existsSync(jarPath)) throw new Error(`${jarPath} not found`);

  const wanted = new Set(locales);
  const entries: LangEntry[] = [];

  const zip = fs.createReadStream(jarPath).pipe(unzipper.Parse({ forceStream: true }));
  for await (const entry of zip) {
    const match = /^assets\/([^/]+)\/lang\/([^/]+)\.json$/.exec(entry.path);
    if (entry.type !== 'File' || !match || !wanted.has(match[2])) {
      entry.autodrain();
      continue;
    }
    entries.push({ ns: match[1], locale: match[2], body: (await entry.buffer()).toString('utf8') });
  }
  return entries;
}

/**
 * バニラの言語ファイルを取得します。
 * アセットインデックスに無いロケール（en_us）は手元の client.jar から補います。
 * @param locales 対象ロケール
 */
async function collectVanilla(locales: string[], download: boolean): Promise<LangEntry[]> {
  const langs = await fetchVanillaLangs(locales);
  const entries = Object.entries(langs).map(([locale, body]) => ({ ns: 'minecraft', locale, body }));

  const missing = locales.filter((l) => !langs[l]);
  if (missing.length === 0) return entries;

  if (!download && !fs.existsSync(CLIENT_JAR_PATH)) {
    console.warn(`Not in asset index and ${CLIENT_JAR_PATH} is absent: ${missing.join(', ')}`);
    console.warn('Pass --download-jar, or run `npm run fetch-mc-data` first.');
    return entries;
  }

  console.log(`Falling back to client.jar for: ${missing.join(', ')}`);
  const jarPath = await ensureClientJar();
  const fromJar = await extractFromJar(jarPath, missing);
  return entries.concat(fromJar.filter((e) => e.ns === 'minecraft'));
}

async function main() {
  const { locales, jar, download } = parseArgs(process.argv.slice(2));
  console.log(`Locales: ${locales.join(', ')}`);
  console.log(`Target: ${describeTarget()}`);

  const entries = jar
    ? await extractFromJar(path.resolve(jar), locales)
    : await collectVanilla(locales, download);

  if (entries.length === 0) {
    console.log('No lang files found.');
    return;
  }

  const missing = locales.filter((l) => !entries.some((e) => e.locale === l));
  if (missing.length > 0) console.warn(`Not found, skipped: ${missing.join(', ')}`);

  for (const { ns, locale, body } of entries) {
    console.log(`  ${ns}/${locale}: ${Object.keys(JSON.parse(body)).length} keys`);
  }

  await uploadLangs(entries);
  console.log(`Uploaded ${entries.length} lang file(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
