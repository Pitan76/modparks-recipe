/**
 * @fileoverview レシピ画像ジェネレーター。
 * クラフトUIレイアウト：参照レンダラーの出力から外側の余白を切り取った値を基準とし、236x112のキャンバスを作成します。
 * 座標はベースピクセル単位であり、`scale` がキャンバス全体をスケーリングします。
 */

import { Resvg } from '@resvg/resvg-wasm';
import { encode as encodeJpeg } from 'jpeg-js';
import { getItemImageBase64, getTag, Env } from './minecraft';
import { encodeGif } from './gif-encoder';
import { ensureWasm } from './wasm';

const CANVAS_W = 236;
const CANVAS_H = 112;

// public/crafting_3x3.png: ネイティブ解像度 118x56 のクラフトUI（スロットと矢印）をここでは2倍で描画します。
// スロットの境界や矢印のギザギザした輪郭は背景画像由来なので、コード内で枠線を再描画する処理は行いません。
const BACKGROUND = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHYAAAA4CAYAAAAo9QwNAAAACXBIWXMAAFxGAABcRgEUlENBAAABk0lEQVR4nO3bUY6DIBSF4cOEVekyZCW6LpYhcVf0YeJjYwqI18P5kkn6MLlp8tdKC3X7vmeQcs49/RQe4wFgXdfqQcuyIMZoZk4IAfM8V895K38+CCFUDdq2DTFGU3OO46ia8WZ/Tz8BuYfCklJYUgpLSmFJKSwphSWlsKQUlpTCklJYUv76X6SFnPttoned1pnt9sVn4QKFhaCfJ7/ob+CVzkcDq21n0VznlP9PNM0lZ6DGhYWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgggWgiy++R+2YC3PinrU+bOULCwEsbBsWvWzkB51/iwlCwtBBAtBBAtB5mvY/l6/v2eu5jywZGEhyLyw/Qnj/WeVvmTOc9n5fTnei4WFIIv7sNX3rfo1Yl8y5zl1fl9u7YZhaK15R/AsFhaCCJaXGIZhXlvuJ1gIIlheytI+RrAQRLCUsLT3ESwEESylLO1tBAtBBMsqWNrrCBaC+E6nN7P2FfPZ499ZWAgiWFbJNe1lgoUgrmFZJdewl1lYCGJh38yrl+vW61DL+jsLC0EsLKtgWa9jYSGIhaWUZb2NhYUgFpYSlvU+FhaCWFheyrI+xsJCEAvLS1jW57CwEMTC8l9Z1ueysBBkXtj+3NP+/NFqzgNLFhaCzAvbnzDef1bpS+Y8l/XzuDZ8TxYWgiz+S9xfwav0a8S+ZM5zqp9nmqbSc1DDwkIQwUIQwUIQn3Rik7Z639zCQhALyyb1+9Rb+2+6hYUggoUggoUggoUggoUggoUggoUggoUggoUggoUggoUggoUggoUggoUggoUggoUggoUggoUggoUggoUggoUggoUggoUg8zf/r+1ZJM4DSxYWgnyM4/hdfQjgOhYWgvwFEw2nBIrT/sIAAAAASUVORK5CYII==';

const ICON = 32;

/** 最初のスロットの内部の左上座標、およびスロット間のピッチ（間隔）。 */
const GRID_X = 4;
const GRID_Y = 4;
const SLOT = 36;

/** 完成品アイコンの左上座標（広い出力スロットの中央に配置されます）。 */
const OUT_X = 192;
const OUT_Y = 40;

/**
 * 指定された座標にアイコンを配置するためのSVGイメージ要素を生成します。
 * @param href アイコン画像のデータURLまたはURL
 * @param x X座標
 * @param y Y座標
 * @returns SVGイメージ要素文字列
 */
function iconSvg(href: string, x: number, y: number): string {
  return `<image href="${href}" x="${x}" y="${y}" width="${ICON}" height="${ICON}"`
    + ` image-rendering="optimizeSpeed" preserveAspectRatio="xMidYMid meet"/>`;
}

/**
 * リクエストごとの「アイテムID -> アイコンデータURL」のメモ（キャッシュ）型。
 * クラフトグリッド内では通常、同じ素材が複数のスロットで繰り返されます（また、3Dブロックアイコンの構築コストは高いため）、
 * 画像ごとに各固有アイテムの解決を1回のみ実行します。
 * 解決された値ではなく Promise を保存することで、並行するスロット間で進行中の同じ検索処理を共有します。
 */
type IconCache = Map<string, Promise<string | null>>;

/**
 * キャッシュを活用して、特定のアイテムIDに対応するアイコンデータURLを取得します。
 * @param id アイテムID
 * @param env 環境変数
 * @param cache アイコンデータキャッシュ
 * @returns アイコンのbase64データURL、または null
 */
function itemIcon(id: string, env: Env, cache: IconCache): Promise<string | null> {
  let pending = cache.get(id);
  if (!pending) {
    pending = getItemImageBase64(id, env);
    cache.set(id, pending);
  }
  return pending;
}

/**
 * レシピの素材オブジェクト（item, tag, 配列など）を解決し、対応するアイテムのアイコンデータURLを返します。
 * @param ingredient レシピの素材情報
 * @param env 環境変数
 * @param tagOffset タグ選択時に使用するインデックスオフセット（アニメーション等用）
 * @param cache アイコンデータキャッシュ
 * @returns アイコンのbase64データURL、または null
 */
async function resolveIngredient(ingredient: any, env: Env, tagOffset: number, cache: IconCache): Promise<string | null> {
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
 * @param recipeData レシピJSONオブジェクト
 * @param env 環境変数
 * @param tagOffset タグ選択のインデックスオフセット
 * @param cache アイコンデータキャッシュ
 * @returns 9スロット分のアイコンデータURL（または null）の配列
 */
export async function createRecipeGrid(
  recipeData: any,
  env: Env,
  tagOffset: number,
  cache: IconCache = new Map()
): Promise<Array<string | null>> {
  // 最初にスロット情報を収集し、それらを一度に並行して解決します：
  // 検索処理は独立したネットワーク往復を伴うため、順次実行すると9スロットのレシピ処理速度が不必要に9倍遅くなってしまいます。
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
 * @param recipeData レシピJSONオブジェクト
 * @param env 環境変数
 * @param tagOffset タグ選択のインデックスオフセット
 * @returns 生成されたSVG文字列
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

// キャンバス全体において、アンチエイリアシングが発生してしまう原因となる小数倍のリサンプリングを避けるため、整数倍のズームでレンダリングします。
// 整数スケーリングにより、ピクセルアートの鮮明さが維持されます。
// ベースのキャンバスサイズは 236x112 なので、スケール N の場合は (236*N)x(112*N) になります。デフォルトの1倍は 236x112 です。
export const DEFAULT_SCALE = 1;
export const MAX_SCALE = 8;

/**
 * 指定されたスケール値を安全な整数範囲（1〜8）に丸めて返します。
 * @param value 判定対象のスケール値
 * @returns 正規化されたスケール整数
 */
export function normalizeScale(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_SCALE;
  return Math.min(n, MAX_SCALE);
}

/**
 * レシピJSONデータをPNG画像（バイナリ）としてレンダリングします。
 * @param recipeData レシピJSON
 * @param env 環境変数
 * @param tagOffset タグ選択のインデックスオフセット
 * @param scale スケール倍率
 * @returns PNG画像のバイナリ
 */
export async function renderRecipePng(recipeData: any, env: Env, tagOffset: number = 0, scale: number = DEFAULT_SCALE): Promise<Uint8Array> {
  await ensureWasm();
  const svg = await generateRecipeSvg(recipeData, env, tagOffset);
  const resvg = new Resvg(svg, { fitTo: { mode: 'zoom', value: scale }, shapeRendering: 0, imageRendering: 1 });
  return resvg.render().asPng();
}

/**
 * レシピJSONデータをJPEG画像（バイナリ）としてレンダリングします。
 * @param recipeData レシピJSON
 * @param env 環境変数
 * @param tagOffset タグ選択のインデックスオフセット
 * @param scale スケール倍率
 * @returns JPEG画像のバイナリ
 */
export async function renderRecipeJpg(recipeData: any, env: Env, tagOffset: number = 0, scale: number = DEFAULT_SCALE): Promise<Uint8Array> {
  await ensureWasm();
  const svg = await generateRecipeSvg(recipeData, env, tagOffset);
  const resvg = new Resvg(svg, { fitTo: { mode: 'zoom', value: scale }, shapeRendering: 0, imageRendering: 1 });
  const rendered = resvg.render();
  const { width, height, pixels } = rendered;

  // JPEGはアルファ（透過）チャンネルを持たないため、透過ピクセルの周囲に黒い縁取り（フリンジ）が発生するのを防ぐために、
  // 透過レシピ画像を不透明な白い背景に合成します。
  const rgba = new Uint8Array(pixels);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    rgba[i]     = Math.round(rgba[i]     * a + 255 * (1 - a));
    rgba[i + 1] = Math.round(rgba[i + 1] * a + 255 * (1 - a));
    rgba[i + 2] = Math.round(rgba[i + 2] * a + 255 * (1 - a));
    rgba[i + 3] = 255;
  }

  const jpg = encodeJpeg({ data: Buffer.from(rgba), width, height }, 90);
  return new Uint8Array(jpg.data);
}

export const TILE_BASE_WIDTH = CANVAS_W;
export const TILE_BASE_HEIGHT = CANVAS_H;

/**
 * ローカル用の簡易Bytes to base64ヘルパー。
 * @param bytes バイナリデータ
 * @returns base64文字列
 */
function bytesToBase64Local(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** スプライトシートの情報を表すインターフェース。 */
export interface SpriteSheet {
  /** スプライトシートのPNGバイナリ */
  png: Uint8Array;
  /** 各タイルの幅 */
  tileWidth: number;
  /** 各タイルの高さ */
  tileHeight: number;
  /** 列数 */
  columns: number;
  /** 行数 */
  rows: number;
  /** 総タイル（レシピ）数 */
  count: number;
  /** タイル順のレシピIDリスト（行優先）。レンダリングに失敗したスロットは null になります */
  order: Array<string | null>;
  /** レンダリングに失敗した、またはレシピデータが見つからなかったIDのリスト */
  missing: string[];
}

/**
 * 複数のレシピを行優先（row-major）で並べた1つのPNGスプライトシート画像にレンダリングします。
 * 各タイルのサイズは TILE_BASE_WIDTH x TILE_BASE_HEIGHT * scale です。
 * コールバックや利用側は、インデックスに基づいてタイルをスライスします：
 *   col = i % columns, row = floor(i / columns)
 *   x = col * tileWidth, y = row * tileHeight
 * 各レシピは一度PNGにレンダリングされた後、1つの大きなSVGを介して合成され、1回のresvg処理でシートが生成されます。
 * @param entries レシピIDとデータの配列
 * @param env 環境変数
 * @param columns スプライトシートの列数（デフォルトは8）
 * @param scale スケール倍率
 * @returns スプライトシートオブジェクト
 */
export async function renderRecipeSpriteSheet(
  entries: Array<{ id: string; recipe: any | null }>,
  env: Env,
  columns: number = 8,
  scale: number = DEFAULT_SCALE
): Promise<SpriteSheet> {
  await ensureWasm();

  const tileWidth = TILE_BASE_WIDTH * scale;
  const tileHeight = TILE_BASE_HEIGHT * scale;
  const cols = Math.max(1, Math.floor(columns));
  const count = entries.length;
  const rows = Math.max(1, Math.ceil(count / cols));

  const order: Array<string | null> = [];
  const missing: string[] = [];
  const tiles: string[] = [];

  await Promise.all(
    entries.map(async (entry, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * tileWidth;
      const y = row * tileHeight;
      if (!entry.recipe) {
        order[i] = null;
        missing.push(entry.id);
        return;
      }
      const png = await renderRecipePng(entry.recipe, env, 0, scale);
      const dataUrl = `data:image/png;base64,${bytesToBase64Local(png)}`;
      order[i] = entry.id;
      tiles[i] = `<image x="${x}" y="${y}" width="${tileWidth}" height="${tileHeight}" image-rendering="optimizeSpeed" href="${dataUrl}" />`;
    })
  );

  const sheetWidth = cols * tileWidth;
  const sheetHeight = rows * tileHeight;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetWidth}" height="${sheetHeight}" viewBox="0 0 ${sheetWidth} ${sheetHeight}">` +
    tiles.filter(Boolean).join('') +
    `</svg>`;

  const resvg = new Resvg(svg, { fitTo: { mode: 'original' }, shapeRendering: 0, imageRendering: 1 });
  const png = resvg.render().asPng();

  return { png, tileWidth, tileHeight, columns: cols, rows, count, order, missing };
}

/**
 * レシピのタグローテーション（素材切り替え）などを考慮し、アニメーションGIF画像を生成します。
 * @param recipeData レシピJSON
 * @param env 環境変数
 * @param maxFrames 最大フレーム数（デフォルトは5フレーム）
 * @param scale スケール倍率
 * @returns GIF画像のバイナリ
 */
export async function renderRecipeGif(recipeData: any, env: Env, maxFrames: number = 5, scale: number = DEFAULT_SCALE): Promise<Uint8Array> {
  await ensureWasm();
  const frames = [];

  for (let i = 0; i < maxFrames; i++) {
    const svg = await generateRecipeSvg(recipeData, env, i);
    const resvg = new Resvg(svg, { fitTo: { mode: 'zoom', value: scale }, shapeRendering: 0, imageRendering: 1 });
    const rendered = resvg.render();
    frames.push({
      width: rendered.width,
      height: rendered.height,
      pixels: rendered.pixels,
      delayMs: 1000 // 1フレームあたり1秒
    });
  }
  
  return encodeGif(frames);
}
