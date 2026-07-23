/**
 * @fileoverview レシピ画像用SVGジェネレーター。
 */

import { getItemImageBase64, getTag, Env } from '../minecraft';

// レイアウト定数と純粋な描画ヘルパーは layout.ts に集約し、ここから再エクスポートします。
// （ローカルのプレビュー/検証スクリプトが wasm/R2 依存を引き込まずに再利用できるようにするため。）
export {
  CANVAS_W,
  CANVAS_H,
  BACKGROUND,
  ICON,
  GRID_X,
  GRID_Y,
  SLOT,
  OUT_X,
  OUT_Y,
  iconSvg,
} from './layout';

import {
  CANVAS_W,
  CANVAS_H,
  BACKGROUND,
  GRID_X,
  GRID_Y,
  SLOT,
  OUT_X,
  OUT_Y,
  ICON,
  iconSvg,
  countSvg,
} from './layout';

/**
 * リクエストごとの「アイテムID -> アイコンデータURL」のメモ（キャッシュ）型。
 */
export type IconCache = Map<string, Promise<string | null>>;

/**
 * キャッシュを活用して、特定のアイテムIDに対応するアイコンデータURLを取得します。
 */
export function itemIcon(id: string, env: Env, cache: IconCache): Promise<string | null> {
  let pending = cache.get(id);
  if (!pending) {
    pending = getItemImageBase64(id, env);
    cache.set(id, pending);
  }
  return pending;
}

/**
 * レシピの素材オブジェクト（item, tag, 配列など）を解決し、対応するアイテムのアイコンデータURLを返します。
 */
export async function resolveIngredient(ingredient: any, env: Env, tagOffset: number, cache: IconCache): Promise<string | null> {
  if (!ingredient) return null;
  if (typeof ingredient === 'string') {
    if (ingredient.startsWith('#')) {
      return resolveIngredient({ tag: ingredient.substring(1) }, env, tagOffset, cache);
    } else {
      return resolveIngredient({ item: ingredient }, env, tagOffset, cache);
    }
  }
  if (Array.isArray(ingredient)) {
    return resolveIngredient(ingredient[0], env, tagOffset, cache);
  }
  if (ingredient.item) {
    return await itemIcon(ingredient.item, env, cache);
  }
  if (ingredient.tag) {
    const tagItems = await getTag(ingredient.tag, env);
    if (tagItems.length > 0) {
      const targetItem = tagItems[tagOffset % tagItems.length];
      return resolveIngredient(targetItem, env, tagOffset, cache);
    }
  }
  return null;
}

/**
 * レシピデータから3x3クラフトグリッドに対応する9スロットのアイコン画像データURLの配列を作成します。
 */
export async function createRecipeGrid(
  recipeData: any,
  env: Env,
  tagOffset: number,
  cache: IconCache = new Map()
): Promise<Array<string | null>> {
  const slots: { index: number; ingredient: any }[] = [];

  if (recipeData.type === 'minecraft:crafting_shaped' || recipeData.type === 'crafting_shaped') {
    const pattern = recipeData.pattern;
    const key = recipeData.key;

    for (let r = 0; r < pattern.length; r++) {
      for (let c = 0; c < pattern[r].length; c++) {
        const char = pattern[r][c];
        if (char !== ' ') slots.push({ index: r * 3 + c, ingredient: key[char] });
      }
    }
  } else if (recipeData.type === 'minecraft:crafting_shapeless' || recipeData.type === 'crafting_shapeless') {
    const ingredients = recipeData.ingredients;
    for (let i = 0; i < ingredients.length; i++) slots.push({ index: i, ingredient: ingredients[i] });
  }

  const grid: Array<string | null> = Array(9).fill(null);
  await Promise.all(
    slots.map(async ({ index, ingredient }) => {
      grid[index] = await resolveIngredient(ingredient, env, tagOffset, cache);
    })
  );
  return grid;
}

/**
 * レシピ全体のUIを表現するSVG文字列を生成します。
 */
export async function generateRecipeSvg(recipeData: any, env: Env, tagOffset: number = 0) {
  const cache: IconCache = new Map();

  const result = recipeData.result ?? recipeData.output;
  const resultId = result
    ? (typeof result === 'string' ? result : result.id || result.item)
    : null;
  const resultCount = result && typeof result === 'object' && Number(result.count) > 1
    ? Math.floor(Number(result.count))
    : 0;

  const [grid, resultImage] = await Promise.all([
    createRecipeGrid(recipeData, env, tagOffset, cache),
    resultId ? itemIcon(resultId, env, cache) : Promise.resolve(null),
  ]);

  let body = `<image href="${BACKGROUND}" x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}"`
    + ` image-rendering="optimizeSpeed"/>`;

  for (let i = 0; i < 9; i++) {
    if (!grid[i]) continue;
    body += iconSvg(grid[i]!, GRID_X + (i % 3) * SLOT, GRID_Y + Math.floor(i / 3) * SLOT);
  }

  if (resultImage) {
    body += iconSvg(resultImage, OUT_X, OUT_Y);
    // 出力が2個以上ならバニラ同様、右下にスタック数を表示（SVG座標はネイティブの2倍なので px=2）。
    if (resultCount > 1) {
      body += countSvg(String(resultCount), OUT_X + ICON, OUT_Y + ICON, 2);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}"`
    + ` viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" shape-rendering="crispEdges">${body}</svg>`;
}
