/**
 * @fileoverview Resvgを用いたPNG/JPEGレンダリング処理。
 */

import { Resvg } from '@resvg/resvg-wasm';
import { encode as encodeJpeg } from 'jpeg-js';
import { Env } from '../minecraft';
import { ensureWasm } from '../wasm';
import { generateRecipeSvg } from './svg';
import { Buffer } from 'buffer'; // ensure we have Buffer for jpeg-js if needed

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
 */
export async function renderRecipePng(recipeData: any, env: Env, tagOffset: number = 0, scale: number = DEFAULT_SCALE): Promise<Uint8Array> {
  await ensureWasm();
  const svg = await generateRecipeSvg(recipeData, env, tagOffset);
  const resvg = new Resvg(svg, { fitTo: { mode: 'zoom', value: scale }, shapeRendering: 0, imageRendering: 1 });
  return resvg.render().asPng();
}

/**
 * レシピJSONデータをJPEG画像（バイナリ）としてレンダリングします。
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
