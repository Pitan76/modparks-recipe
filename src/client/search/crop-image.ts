/**
 * @fileoverview 受け取った画像をブラウザ側で切り抜きます。
 *
 * 表示は CSS で切り抜けますが、ダウンロードや zip に入るのは受け取ったバイトそのものです。
 * 見えている絵と保存される絵を揃えるため、詰める直前にここで実際に削ります。
 */

import { DEFAULT_CROP, NATIVE_H, NATIVE_W, normalizeCrop } from '../../core/crop';

/**
 * 画像の上下左右を削った Blob を返します。
 *
 * GIF はそのまま返します。canvas に描けるのは1コマ目だけで、切り抜くと
 * 素材が切り替わるレシピのアニメーションが失われるためです。
 * @param blob 元の画像
 * @param crop 削る量（ネイティブpx）
 * @returns 切り抜いた画像。触らなかった場合は元の Blob
 */
export async function cropImageBlob(blob: Blob, crop: number): Promise<Blob> {
  const n = normalizeCrop(crop);
  if (n === DEFAULT_CROP || blob.type === 'image/gif') return blob;

  // 描画・書き出しはどちらも外部（ブラウザの実装）に委ねる境界です。
  // 1枚の失敗でzip全体を捨てないよう、ここで元のBlobへ落とします。
  try {
    return await drawCropped(blob, n);
  } catch {
    return blob;
  }
}

/**
 * 実際に canvas へ切り抜いて描き、同じ形式で書き出します。
 * @param blob 元の画像
 * @param crop 削る量（ネイティブpx）
 */
async function drawCropped(blob: Blob, crop: number): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const insetX = (bitmap.width * crop) / NATIVE_W;
  const insetY = (bitmap.height * crop) / NATIVE_H;
  const width = Math.max(1, Math.round(bitmap.width - insetX * 2));
  const height = Math.max(1, Math.round(bitmap.height - insetY * 2));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return blob;

  // ドット絵なので、拡大縮小の補間が入ると輪郭が滲みます。
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, insetX, insetY, bitmap.width - insetX * 2, bitmap.height - insetY * 2, 0, 0, width, height);
  bitmap.close();

  const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, blob.type));
  return out ?? blob;
}
