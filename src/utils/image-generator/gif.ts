/**
 * @fileoverview GIF生成処理。
 */

import { AssetSource, legacyAssetSource } from '../build/asset-source';
import { Resvg } from '@resvg/resvg-wasm';
import { Env } from '../minecraft';
import { encodeGif } from '../gif-encoder';
import { ensureWasm } from '../wasm';
import { generateRecipeSvg } from './svg';
import { DEFAULT_SCALE, zoomForScale } from './render';

/**
 * 2つのピクセルバッファが同一かどうかを判定します。
 */
function samePixels(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * レシピのタグローテーション（素材切り替え）などを考慮し、アニメーションGIF画像を生成します。
 *
 * タグを持たないレシピや、構成アイテムが maxFrames 未満のタグでは、途中で1周して
 * 1枚目と同じ絵に戻ります。そこで打ち切らないと、同じ絵のラスタライズを
 * 最大5回繰り返したうえで、静止画を無駄に5フレームのGIFとして配ることになります。
 */
export async function renderRecipeGif(recipeData: any, env: Env, maxFrames: number = 5, scale: number = DEFAULT_SCALE, src: AssetSource = legacyAssetSource(env)): Promise<Uint8Array> {
  await ensureWasm();
  const frames = [];

  for (let i = 0; i < maxFrames; i++) {
    const svg = await generateRecipeSvg(recipeData, env, i, src);
    const resvg = new Resvg(svg, { fitTo: { mode: 'zoom', value: zoomForScale(scale) }, shapeRendering: 0, imageRendering: 1 });
    const rendered = resvg.render();
    if (i > 0 && samePixels(rendered.pixels, frames[0].pixels)) break;

    frames.push({
      width: rendered.width,
      height: rendered.height,
      pixels: rendered.pixels,
      delayMs: 1000 // 1フレームあたり1秒
    });
  }

  return encodeGif(frames);
}
