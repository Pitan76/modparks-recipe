/**
 * @fileoverview GIF生成処理。
 */

import { legacyAssetSource } from '../build/asset-source';
import type { AssetReader } from '../../core/asset-reader';
import { Resvg } from '@resvg/resvg-wasm';
import { Env } from '../minecraft';
import { encodeGif } from '../gif-encoder';
import { ensureWasm } from '../wasm';
import { generateRecipeSvg } from './svg';
import { DEFAULT_SCALE, zoomForScale } from './render';
import { DEFAULT_RENDER_OPTIONS, type RenderOptions } from '../../core/render-options';

/**
 * GIFのコマ数の天井。
 *
 * 実際の長さを決めるのは「1周したら打ち切る」判定の方で、これは事故防止の枠です。
 * `tagOffset` は全スロット共通に進むため、1周するのは各スロットの候補数の最小公倍数です。
 * ネームスペースをバニラに絞っても、`#c:planks`（11）と `#minecraft:wool`（16）が同じレシピに
 * 乗れば176コマになり、1コマごとのR2往復とラスタライズでWorkerのCPU時間を使い切ります。
 */
export const MAX_GIF_FRAMES = 8;

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
 * 1枚目と同じ絵に戻ります。そこで打ち切らないと、同じ絵のラスタライズを maxFrames 回
 * 繰り返したうえで、静止画を無駄に maxFrames コマのGIFとして配ることになります。
 *
 * @param options 見た目の指定。タグ構成アイテムのネームスペースは既定でバニラのみです。
 *   共通タグ（`#c:planks` など）は木材を足す mod が入るほど膨らみ、既定を全部にすると
 *   見た人の知らない mod のアイテムばかりが並ぶコマになります。
 */
export async function renderRecipeGif(recipeData: any, env: Env, maxFrames: number = MAX_GIF_FRAMES, scale: number = DEFAULT_SCALE, src: AssetReader = legacyAssetSource(env), options: RenderOptions = DEFAULT_RENDER_OPTIONS): Promise<Uint8Array> {
  await ensureWasm();
  const frames = [];

  for (let i = 0; i < maxFrames; i++) {
    const svg = await generateRecipeSvg(recipeData, env, i, src, options);
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
