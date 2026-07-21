/**
 * @fileoverview レシピ画像用SVGジェネレーター。
 */

import { getItemImageBase64, getTag, Env } from '../minecraft';

export const CANVAS_W = 236;
export const CANVAS_H = 112;

// public/crafting_3x3.png: ネイティブ解像度 118x56 のクラフトUI（スロットと矢印）をここでは2倍で描画します。
// スロットの境界や矢印のギザギザした輪郭は背景画像由来なので、コード内で枠線を再描画する処理は行いません。
export const BACKGROUND = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHYAAAA4CAYAAAAo9QwNAAAACXBIWXMAAFxGAABcRgEUlENBAAABk0lEQVR4nO3bUY6DIBSF4cOEVekyZCW6LpYhcVf0YeJjYwqI18P5kkn6MLlp8tdKC3X7vmeQcs49/RQe4wFgXdfqQcuyIMZoZk4IAfM8V895K38+CCFUDdq2DTFGU3OO46ia8WZ/Tz8BuYfCklJYUgpLSmFJKSwphSWlsKQUlpTCklJYUv76X6SFnPttoned1pnt9sVn4QKFhaCfJ7/ob+CVzkcDq21n0VznlP9PNM0lZ6DGhYWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgiy++R+2YC3PinrU+bOULCwEsbBsWvWzkB51/iwlCwtBBAtBBAtB5mvY/l6/v2eu5jywZGEhyLyw/Qnj/WeVvmTOc9n5fTnei4WFIIv7sNX3rfo1Yl8y5zl1fl9u7YZhaK15R/AsFhaCCJaXGIZhXlvuJ1gIIlheytI+RrAQRLCUsLT3ESwEESylLO1tBAtBBMsqWNrrCBaC+E6nN7P2FfPZ499ZWAgiWFbJNe1lgoUgrmFZJdewl1lYCGJh38yrl+vW61DL+jsLC0EsLKtgWa9jYSGIhaWUZb2NhYUgFpYSlvU+FhaCWFheyrI+xsJCEAvLS1jW57CwEMTC8l9Z1ueysBBkXtj+3NP+/NFqzgNLFhaCzAvbnzDef1bpS+Y8l/XzuDZ8TxYWgiz+S9xfwav0a8S+ZM5zqp9nmqbSc1DDwkIQwUIQwUIQn3Rik7Z639zCQhALyyb1+9Rb+2+6hYUggoUggoUggoUggoUggoUggoUggoUggoUggoUggoUggoUggoUggoUggoUggoUggoUggoUggoUggoUggoUggoUg8zf/r+1ZJM4DSxYWgnyM4/hdfQjgOhYWgvwFEw2nBIrT/sIAAAAASUVORK5CYII==';

export const ICON = 32;

/** 最初のスロットの内部の左上座標、およびスロット間のピッチ（間隔）。 */
export const GRID_X = 4;
export const GRID_Y = 4;
export const SLOT = 36;

/** 完成品アイコンの左上座標（広い出力スロットの中央に配置されます）。 */
export const OUT_X = 192;
export const OUT_Y = 40;

/**
 * 指定された座標にアイコンを配置するためのSVGイメージ要素を生成します。
 * @param href アイコン画像のデータURLまたはURL
 * @param x X座標
 * @param y Y座標
 * @returns SVGイメージ要素文字列
 */
export function iconSvg(href: string, x: number, y: number): string {
  return `<image href="${href}" x="${x}" y="${y}" width="${ICON}" height="${ICON}"`
    + ` image-rendering="optimizeSpeed" preserveAspectRatio="xMidYMid meet"/>`;
}

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

  const resultId = recipeData.result
    ? (typeof recipeData.result === 'string' ? recipeData.result : recipeData.result.id || recipeData.result.item)
    : null;

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

  if (resultImage) body += iconSvg(resultImage, OUT_X, OUT_Y);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}"`
    + ` viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" shape-rendering="crispEdges">${body}</svg>`;
}
