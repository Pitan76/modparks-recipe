/**
 * @fileoverview 「まだ描けないと分かっているアイコン」の記録と、検証を省いてよいかの判断。
 *
 * 空アイコンをゼロにするまで検証を止めておくと、その間に起きる退行を1つも捕まえられません。
 * 現状を記録しておき、そこから増えたときだけ失敗させれば、残件を抱えたままでも退行は止められます。
 *
 * 記録が減った（＝直った）ときも失敗させます。直したのに記録が古いままだと、その項目が再び
 * 壊れても「元から空だった」と見なされ、二度と気づけなくなるためです。
 *
 * 記録には「何を前提に確かめたか」も残します。アイコンの絵はレンダリング系ソースと素材でしか
 * 決まらないため、どちらも変わっていなければ結果は変わりようがなく、検証を丸ごと省けます。
 * デプロイのたびに5秒払わずに済ませつつ、描画を触ったときは必ず確かめられる形にするためです。
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

/** 記録の置き場。生成物として作業ツリーに残します。 */
export const BASELINE_PATH = path.join('src', 'generated', 'icon-baseline.json');

/** 素材の指紋として載せる長さ。 */
const FINGERPRINT_LENGTH = 16;

/** ネームスペース1つ分の記録。 */
export interface NamespaceBaseline {
  /** 確かめたときのレンダラー版。 */
  renderVersion: string;
  /** 確かめたときの素材の指紋。 */
  assetFingerprint: string;
  /** 描けないと分かっているアイテムID。 */
  empty: string[];
}

/** ネームスペースごとの記録。 */
export type Baseline = Record<string, NamespaceBaseline>;

/** 記録と現状の差。 */
export interface BaselineDiff {
  /** 記録に無い空。描画の退行です。 */
  added: string[];
  /** 記録にあるが描けるようになったもの。記録の更新が要ります。 */
  removed: string[];
}

/**
 * 記録を読みます。
 * @returns まだ無ければ空
 */
export function readBaseline(): Baseline {
  if (!fs.existsSync(BASELINE_PATH)) return {};

  const parsed = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  return parsed && typeof parsed === 'object' ? (parsed as Baseline) : {};
}

/**
 * 記録を書き換えます。
 * @param ns ネームスペース
 * @param entry このネームスペースの記録
 */
export function writeBaseline(ns: string, entry: NamespaceBaseline): void {
  const next: Baseline = { ...readBaseline(), [ns]: { ...entry, empty: [...entry.empty].sort() } };
  const ordered = Object.fromEntries(Object.keys(next).sort().map((key) => [key, next[key]]));

  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
}

/**
 * 記録と現状を突き合わせます。
 * @param ns ネームスペース
 * @param empty 現状の空アイテムID
 */
export function diffBaseline(ns: string, empty: string[]): BaselineDiff {
  const known = new Set(readBaseline()[ns]?.empty ?? []);
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
export function isUpToDate(ns: string, renderVersion: string, assetFingerprint: string): boolean {
  const known = readBaseline()[ns];
  if (!known) return false;
  return known.renderVersion === renderVersion && known.assetFingerprint === assetFingerprint;
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
