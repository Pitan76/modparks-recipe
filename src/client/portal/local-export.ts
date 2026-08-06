/**
 * @fileoverview 手元で組み立てたレシピを PNG / GIF に書き出す処理。
 *
 * 描画で得られるのは SVG です。表示はそのままで足りますが、配布や貼り付けには実画像が要ります。
 * ラスタライズはブラウザに任せ（canvas）、GIF の組み立ては Worker 側と同じエンコーダを使います。
 * どちらもサーバを経由しないため、まとめて落としても通信も課金も発生しません。
 */

import { encodeGif } from '../../utils/gif-encoder';
import { svgDataUrl } from './local-render';

/** 1フレームあたりの表示時間。Worker 側の GIF と揃えています。 */
const FRAME_DELAY_MS = 1000;

/**
 * SVG を canvas に描き、ピクセルを取り出します。
 * @param svg SVG文字列
 * @param scale 拡大率
 * @returns 取り出せなければ null
 */
async function rasterize(svg: string, scale: number): Promise<ImageData | null> {
  const image = new Image();
  image.src = svgDataUrl(svg);
  await image.decode().catch(() => undefined);
  if (!image.width) return null;

  const canvas = document.createElement('canvas');
  canvas.width = image.width * scale;
  canvas.height = image.height * scale;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  // ドット絵なので、拡大時に補間させません。
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * SVG を PNG のバイト列にします。
 * @param svg SVG文字列
 * @param scale 拡大率
 * @returns 変換できなければ null
 */
export async function svgToPng(svg: string, scale: number): Promise<Uint8Array | null> {
  const image = new Image();
  image.src = svgDataUrl(svg);
  await image.decode().catch(() => undefined);
  if (!image.width) return null;

  const canvas = document.createElement('canvas');
  canvas.width = image.width * scale;
  canvas.height = image.height * scale;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/**
 * 複数コマの SVG を GIF のバイト列にします。
 * @param frames コマごとの SVG文字列
 * @param scale 拡大率
 * @returns 変換できなければ null
 */
export async function svgFramesToGif(frames: string[], scale: number): Promise<Uint8Array | null> {
  const rastered: ImageData[] = [];
  for (const svg of frames) {
    const data = await rasterize(svg, scale);
    if (data) rastered.push(data);
  }
  if (rastered.length === 0) return null;

  return encodeGif(
    rastered.map((d) => ({ width: d.width, height: d.height, pixels: d.data, delayMs: FRAME_DELAY_MS })),
    FRAME_DELAY_MS
  );
}
