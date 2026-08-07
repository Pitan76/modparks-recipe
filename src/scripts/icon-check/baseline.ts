/**
 * @fileoverview 「まだ描けないと分かっているアイコン」の記録と突き合わせ。
 *
 * 空アイコンをゼロにするまで検証を止めておくと、その間に起きる退行を1つも捕まえられません。
 * 現状を記録しておき、そこから増えたときだけ失敗させれば、残件を抱えたままでも退行は止められます。
 *
 * 記録が減った（＝直った）ときも失敗させます。直したのに記録が古いままだと、その項目が再び
 * 壊れても「元から空だった」と見なされ、二度と気づけなくなるためです。
 */

import fs from 'fs';
import path from 'path';

/** 記録の置き場。生成物として作業ツリーに残します。 */
export const BASELINE_PATH = path.join('src', 'generated', 'icon-baseline.json');

/** ネームスペースごとの、描けないと分かっているアイテムID。 */
export type Baseline = Record<string, string[]>;

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
 * @param empty 現状の空アイテムID
 */
export function writeBaseline(ns: string, empty: string[]): void {
  const next: Baseline = { ...readBaseline() };
  // 空になるものが無くなったネームスペースは、行ごと消します。空配列を残すと、
  // 「未確認」と「確認済みで0件」の区別が付かなくなります。
  if (empty.length === 0) delete next[ns];
  else next[ns] = [...empty].sort();

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
  const known = new Set(readBaseline()[ns] ?? []);
  const now = new Set(empty);

  return {
    added: [...now].filter((id) => !known.has(id)).sort(),
    removed: [...known].filter((id) => !now.has(id)).sort(),
  };
}
