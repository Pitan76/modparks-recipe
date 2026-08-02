/**
 * @fileoverview 複数レシピをまとめて画像化する処理。POST/GET 両方のバッチエンドポイントで共有します。
 */

import { Env, getRecipe } from './minecraft';
import { renderRecipePng, renderRecipeGif, renderRecipeJpg } from './image-generator';
import { bytesToBase64 } from './http';
import { runPool } from './pool';

/**
 * 同時に走らせるレンダリング数。
 * 最大200件を一斉にラスタライズするとCPUとメモリが一度に立ち上がるため、幅を絞ります。
 */
const RENDER_CONCURRENCY = 8;

/** GIFのフレーム数。タグの構成アイテムを切り替えて見せるためのもの。 */
const GIF_FRAMES = 5;

/** バッチレンダリングの結果。 */
export type BatchResult = { images: Record<string, string | null>; missing: string[] };

/**
 * 拡張子から、MIMEタイプと描画関数の組を決めます。
 * @param ext 拡張子（png, gif, jpg, jpeg）
 * @param env 環境変数
 * @param scale スケール倍率
 * @param tagOffset タグオフセット
 */
function rendererFor(
  ext: string,
  env: Env,
  scale: number,
  tagOffset: number
): { mime: string; render: (recipe: any) => Promise<Uint8Array> } {
  if (ext === 'gif') return { mime: 'image/gif', render: (r) => renderRecipeGif(r, env, GIF_FRAMES, scale) };
  if (ext === 'jpg' || ext === 'jpeg') {
    return { mime: 'image/jpeg', render: (r) => renderRecipeJpg(r, env, tagOffset, scale) };
  }
  return { mime: 'image/png', render: (r) => renderRecipePng(r, env, tagOffset, scale) };
}

/**
 * 1レシピを描画し、見つからない・描画できない場合は null を返します。
 * 1件の失敗でバッチ全体を落とさないための境界です。
 * @param render 実際に描画する関数
 * @param fullId 完全修飾レシピID
 * @param env 環境変数
 */
async function renderOrNull(
  render: (recipe: any) => Promise<Uint8Array>,
  fullId: string,
  env: Env
): Promise<Uint8Array | null> {
  try {
    const recipe = await getRecipe(fullId, env);
    if (!recipe) return null;
    return await render(recipe);
  } catch (err) {
    console.error(`render failed: ${fullId}`, err);
    return null;
  }
}

/**
 * 各IDを base64 データURLにレンダリングします。存在しない・描画できないIDは null になります。
 * @param env 環境変数
 * @param namespace ネームスペース（Mod ID など）
 * @param ids レシピIDのリスト（単純名または "ns:id"）
 * @param ext 拡張子（png, gif, jpg）
 * @param scale スケール倍率
 * @param tagOffset タグオフセット
 * @returns レンダリングされた画像データのマップと不足しているIDのリスト
 */
export async function renderBatch(
  env: Env,
  namespace: string,
  ids: string[],
  ext: string,
  scale: number,
  tagOffset: number
): Promise<BatchResult> {
  const { mime, render } = rendererFor(ext, env, scale, tagOffset);

  const images: Record<string, string | null> = {};
  const missing: string[] = [];
  await runPool(ids, RENDER_CONCURRENCY, async (rawId) => {
    const fullId = String(rawId).includes(':') ? String(rawId) : `${namespace}:${rawId}`;
    // 1件の失敗でバッチ全体を落とさない。壊れた1レシピのために
    // 残り199件の再レンダリングをやり直させる方が高くつく。
    const bytes = await renderOrNull(render, fullId, env);
    if (!bytes) {
      images[rawId] = null;
      missing.push(rawId);
      return;
    }
    images[rawId] = `data:${mime};base64,${bytesToBase64(bytes)}`;
  });
  return { images, missing };
}
