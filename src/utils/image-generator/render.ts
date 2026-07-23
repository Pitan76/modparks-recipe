/**
 * @fileoverview Resvgを用いたPNG/JPEGレンダリング処理。
 */

import { Resvg } from '@resvg/resvg-wasm';
import { encode as encodeJpeg } from 'jpeg-js';
import { Env } from '../minecraft';
import { ensureWasm } from '../wasm';
import { generateRecipeSvg } from './svg';
import { Buffer } from 'buffer'; // ensure we have Buffer for jpeg-js if needed

// ベースのキャンバスサイズは 236x112 です。
// scale は 0.5 倍を1単位とする整数指標で、実際のズーム倍率は scale * 0.5 になります。
//   scale=1 → ズーム0.5 → 118x56（ハーフサイズのサムネイル）
//   scale=2 → ズーム1.0 → 236x112（デフォルト、等倍）
//   scale=4 → ズーム2.0 → 472x224
// scale が偶数のときは整数倍ズームになり、ピクセルアートの鮮明さが維持されます。
export const DEFAULT_SCALE = 2;
export const MAX_SCALE = 8;

/** scale 指標から実際のズーム倍率へ変換する係数。 */
export const SCALE_ZOOM_FACTOR = 0.5;

/**
 * scale 指標を実際のレンダリングズーム倍率に変換します。
 * @param scale 正規化済みの scale 値
 * @returns resvg に渡すズーム倍率
 */
export function zoomForScale(scale: number): number {
  return scale * SCALE_ZOOM_FACTOR;
}

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
  const resvg = new Resvg(svg, { fitTo: { mode: 'zoom', value: zoomForScale(scale) }, shapeRendering: 0, imageRendering: 1 });
  return resvg.render().asPng();
}

/**
 * レシピJSONデータをJPEG画像（バイナリ）としてレンダリングします。
 */
export async function renderRecipeJpg(recipeData: any, env: Env, tagOffset: number = 0, scale: number = DEFAULT_SCALE): Promise<Uint8Array> {
  await ensureWasm();
  const svg = await generateRecipeSvg(recipeData, env, tagOffset);
  const resvg = new Resvg(svg, { fitTo: { mode: 'zoom', value: zoomForScale(scale) }, shapeRendering: 0, imageRendering: 1 });
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
