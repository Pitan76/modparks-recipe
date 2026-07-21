/**
 * @fileoverview GIF生成処理。
 */

import { Resvg } from '@resvg/resvg-wasm';
import { Env } from '../minecraft';
import { encodeGif } from '../gif-encoder';
import { ensureWasm } from '../wasm';
import { generateRecipeSvg } from './svg';
import { DEFAULT_SCALE } from './render';

/**
 * レシピのタグローテーション（素材切り替え）などを考慮し、アニメーションGIF画像を生成します。
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
