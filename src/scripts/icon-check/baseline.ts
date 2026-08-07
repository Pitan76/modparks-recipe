/**
 * @fileoverview 「まだ描けないと分かっているアイコン」の記録と、検証を省いてよいかの判断。
 *
 * 空アイコンをゼロにするまで検証を止めておくと、その間に起きる退行を1つも捕まえられません。
 * 現状を記録しておき、そこから増えたときだけ失敗させれば、残件を抱えたままでも退行は止められます。
 *
 * 記録が減った（＝直った）ときも失敗させます。直したのに記録が古いままだと、その項目が再び
 * 壊れても「元から空だった」と見なされ、二度と気づけなくなるためです。
 *
 * 保存先を2つに分けています。片方は「まだ描けないもの」という主張で、人が読んで意味があり、
 * 増減がそのままレビュー対象になるため追跡します。もう片方は「何を前提に確かめ終えたか」という
 * 手元の事情で、client.jar のハッシュを含むため人によって値が違い、共有する意味がありません。
 * 1つのファイルに混ぜると、デプロイのたびに追跡ファイルが書き換わって差分が濁ります。
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

/** 描けないアイテムの記録。主張なので追跡します。 */
export const BASELINE_PATH = path.join('src', 'generated', 'icon-baseline.json');

/** 検証済みの印。手元の事情なので追跡しません。 */
const VERIFIED_PATH = path.join('node_modules', '.cache', 'icon-check.json');

/** 素材の指紋として載せる長さ。 */
const FINGERPRINT_LENGTH = 16;

/** ネームスペースごとの、描けないと分かっているアイテムID。 */
export type Baseline = Record<string, string[]>;

/** 何を前提に確かめ終えたか。 */
interface Verified {
  renderVersion: string;
  assetFingerprint: string;
}

/** 記録と現状の差。 */
export interface BaselineDiff {
  /** 記録に無い空。描画の退行です。 */
  added: string[];
  /** 記録にあるが描けるようになったもの。記録の更新が要ります。 */
  removed: string[];
}

/**
 * JSONを読みます。
 * @param file 読み出し先
 * @returns 無ければ、または壊れていれば空
 */
function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * JSONを書きます。
 * @param file 書き出し先
 * @param value 中身
 */
function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/**
 * 記録を読みます。
 * @returns まだ無ければ空
 */
export function readBaseline(): Baseline {
  return readJson<Baseline>(BASELINE_PATH) ?? {};
}

/**
 * 記録を書き換えます。
 * @param ns ネームスペース
 * @param empty 描けないアイテムID
 */
export function writeBaseline(ns: string, empty: string[]): void {
  const next: Baseline = { ...readBaseline() };
  // 空になるものが無くなったネームスペースは行ごと消します。空配列を残すと、
  // 「未確認」と「確認済みで0件」の区別が付きません。
  if (empty.length === 0) delete next[ns];
  else next[ns] = [...empty].sort();

  writeJson(BASELINE_PATH, Object.fromEntries(Object.keys(next).sort().map((key) => [key, next[key]])));
}

/**
 * 記録と現状を突き合わせます。
 * @param ns ネームスペース
 * @param empty 現状の空アイテムID
 */
export function diffBaseline(ns: string, empty: string[]): BaselineDiff {
  const known = new Set(readBaseline()[ns] ?? []);
  const now = new Set(empty);

  return {
    added: [...now].filter((id) => !known.has(id)).sort(),
    removed: [...known].filter((id) => !now.has(id)).sort(),
  };
}

/**
 * 前回と同じ前提かどうかを返します。同じなら結果も同じなので、描き直して確かめる意味がありません。
 * @param ns ネームスペース
 * @param renderVersion 現在のレンダラー版
 * @param assetFingerprint 現在の素材の指紋
 */
export function isVerified(ns: string, renderVersion: string, assetFingerprint: string): boolean {
  const known = readJson<Record<string, Verified>>(VERIFIED_PATH)?.[ns];
  if (!known) return false;
  return known.renderVersion === renderVersion && known.assetFingerprint === assetFingerprint;
}

/**
 * 確かめ終えた前提を残します。
 * @param ns ネームスペース
 * @param renderVersion 現在のレンダラー版
 * @param assetFingerprint 現在の素材の指紋
 */
export function markVerified(ns: string, renderVersion: string, assetFingerprint: string): void {
  const all = readJson<Record<string, Verified>>(VERIFIED_PATH) ?? {};
  writeJson(VERIFIED_PATH, { ...all, [ns]: { renderVersion, assetFingerprint } });
}

/**
 * 素材の指紋を計算します。
 *
 * 手元の jar を丸ごと畳みます。MCの版が変われば新しいアイテムが増え、描けないものも変わりうる
 * ため、レンダラー版だけを見ていると差し替えを見落とします。
 * @param jarPath jar のパス
 */
export function assetFingerprintOf(jarPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(jarPath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex').slice(0, FINGERPRINT_LENGTH)));
    stream.on('error', reject);
  });
}
