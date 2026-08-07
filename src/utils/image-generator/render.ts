/**
 * @fileoverview Resvgを用いたPNG/JPEGレンダリング処理。
 */

import { legacyAssetSource } from '../build/asset-source';
import type { AssetReader } from '../../core/asset-reader';
import { Resvg } from '@resvg/resvg-wasm';
import { encode as encodeJpeg } from 'jpeg-js';
import { Env } from '../minecraft';
import { ensureWasm } from '../wasm';
import { generateRecipeSvg } from './svg';
import { DEFAULT_SCALE } from '../../core/image-key';
import { Buffer } from 'buffer'; // ensure we have Buffer for jpeg-js if needed

// 拡大率の定義はブラウザ側も同じ値でキーを組むため core にあります。ここから通して使わせます。
export { DEFAULT_SCALE, MAX_SCALE, normalizeScale } from '../../core/image-key';

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
 * レシピJSONデータをPNG画像（バイナリ）としてレンダリングします。
 */
export async function renderRecipePng(recipeData: any, env: Env, tagOffset: number = 0, scale: number = DEFAULT_SCALE, src: AssetReader = legacyAssetSource(env)): Promise<Uint8Array> {
  await ensureWasm();
  const svg = await generateRecipeSvg(recipeData, env, tagOffset, src);
  const resvg = new Resvg(svg, { fitTo: { mode: 'zoom', value: zoomForScale(scale) }, shapeRendering: 0, imageRendering: 1 });
  return resvg.render().asPng();
}

/**
 * レシピJSONデータをJPEG画像（バイナリ）としてレンダリングします。
 */
export async function renderRecipeJpg(recipeData: any, env: Env, tagOffset: number = 0, scale: number = DEFAULT_SCALE, src: AssetReader = legacyAssetSource(env)): Promise<Uint8Array> {
  await ensureWasm();
  const svg = await generateRecipeSvg(recipeData, env, tagOffset, src);
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
