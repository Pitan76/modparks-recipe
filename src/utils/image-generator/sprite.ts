/**
 * @fileoverview スプライトシート生成処理。
 */

import { AssetSource, legacyAssetSource } from '../build/asset-source';
import { Resvg } from '@resvg/resvg-wasm';
import { Env } from '../minecraft';
import { ensureWasm } from '../wasm';
import { runPool } from '../pool';
import { CANVAS_W, CANVAS_H } from './svg';
import { renderRecipePng, DEFAULT_SCALE, zoomForScale } from './render';

export const TILE_BASE_WIDTH = CANVAS_W;
export const TILE_BASE_HEIGHT = CANVAS_H;

/** 同時に描画するタイル数。最大200枚を一斉にラスタライズさせないための幅。 */
const TILE_CONCURRENCY = 8;

/**
 * ローカル用の簡易Bytes to base64ヘルパー。
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
 * 1タイル分を描画し、描画できなければ null を返します。
 * @param recipe レシピJSONデータ
 * @param env 環境変数
 * @param scale スケール倍率
 */
async function renderTile(recipe: any, env: Env, scale: number, src: AssetSource): Promise<Uint8Array | null> {
  try {
    return await renderRecipePng(recipe, env, 0, scale, src);
  } catch (err) {
    console.error('sprite tile render failed', err);
    return null;
  }
}

/**
 * 複数のレシピを行優先（row-major）で並べた1つのPNGスプライトシート画像にレンダリングします。
 */
export async function renderRecipeSpriteSheet(
  entries: Array<{ id: string; recipe: any | null }>,
  env: Env,
  columns: number = 8,
  scale: number = DEFAULT_SCALE,
  src: AssetSource = legacyAssetSource(env)
): Promise<SpriteSheet> {
  await ensureWasm();

  const tileWidth = Math.round(TILE_BASE_WIDTH * zoomForScale(scale));
  const tileHeight = Math.round(TILE_BASE_HEIGHT * zoomForScale(scale));
  const cols = Math.max(1, Math.floor(columns));
  const count = entries.length;
  const rows = Math.max(1, Math.ceil(count / cols));

  const order: Array<string | null> = [];
  const missing: string[] = [];
  const tiles: string[] = [];

  await runPool(entries, TILE_CONCURRENCY, async (entry, i) => {
    const x = (i % cols) * tileWidth;
    const y = Math.floor(i / cols) * tileHeight;
    // 1タイルの失敗でシート全体を落とさない。落とすと残りのタイルも
    // 再取得させることになり、そのシートは永久に描けなくなる。
    const png = entry.recipe ? await renderTile(entry.recipe, env, scale, src) : null;
    if (!png) {
      order[i] = null;
      missing.push(entry.id);
      return;
    }
    const dataUrl = `data:image/png;base64,${bytesToBase64Local(png)}`;
    order[i] = entry.id;
    tiles[i] = `<image x="${x}" y="${y}" width="${tileWidth}" height="${tileHeight}" image-rendering="optimizeSpeed" href="${dataUrl}" />`;
  });

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
