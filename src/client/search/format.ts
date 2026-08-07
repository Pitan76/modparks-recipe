/**
 * @fileoverview 画像形式の選択と、レシピ1件ごとの実形式の決定。
 *
 * 「自動」はレシピの性質で形式を選び分けます。素材が切り替わるレシピ（複数のタグを持つもの）だけ
 * アニメーションが要るので GIF、それ以外は静止画のまま PNG です。静止画を GIF で配ると色数が落ち、
 * しかも PNG より重くなるため、一括で GIF にはしません。
 */

import { useMemo } from 'react';
import type { RecipeEntry } from './api';

/** 画面から選べる形式。`auto` はレシピごとに選び分けます。 */
export const FMT_CHOICES = ['auto', 'png', 'gif', 'jpg'] as const;

export type Fmt = (typeof FMT_CHOICES)[number];

/** レシピIDから実際に使う拡張子を引く関数。 */
export type FmtResolver = (recipeId: string) => string;

/**
 * 保存値などの外から来た文字列を、選べる形式に丸めます。
 * @param value 検証したい値
 * @param fallback 選択肢に無いときに返す形式
 */
export function toFmt(value: string | null, fallback: Fmt): Fmt {
  return FMT_CHOICES.includes(value as Fmt) ? (value as Fmt) : fallback;
}

/**
 * 選択中の形式と索引から、レシピごとの拡張子を引く関数を作ります。
 * @param fmt 選択中の形式
 * @param recipes 索引のレシピ一覧。読み込み前は null
 */
export function useFmtResolver(fmt: string, recipes: RecipeEntry[] | null): FmtResolver {
  const animated = useMemo(() => new Set((recipes ?? []).filter((r) => r.tagged).map((r) => r.id)), [recipes]);
  return useMemo(() => {
    if (fmt !== 'auto') return () => fmt;
    return (recipeId: string) => (animated.has(recipeId) ? 'gif' : 'png');
  }, [fmt, animated]);
}
