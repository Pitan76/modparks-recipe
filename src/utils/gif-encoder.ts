/**
 * @fileoverview ピクセルアート画像（マイクラのテクスチャなど）向けの簡易カラーパレット型アニメーションGIFエンコーダー。
 */

import { GifWriter } from 'omggif';

/** GIFの各フレームを表すインターフェース。 */
export interface GifFrame {
  /** フレームの横幅 */
  width: number;
  /** フレームの縦幅 */
  height: number;
  /** RGBAピクセルデータの配列 */
  pixels: Uint8ClampedArray | Uint8Array;
  /** フレームの表示時間（ミリ秒単位。オプション） */
  delayMs?: number;
}

/** GIFのカラーテーブルに入る最大色数。 */
const MAX_COLORS = 256;

/** 透過色に固定で割り当てるパレット位置。 */
const TRANSPARENT_INDEX = 0;

/** アルファがこの値未満のピクセルを透過として扱う閾値。 */
const ALPHA_THRESHOLD = 128;

/** 1フレームを量子化した結果。 */
type QuantizedFrame = { palette: number[]; indexedPixels: Uint8Array };

/**
 * 出力バッファに必要なバイト数を見積もります。
 *
 * LZWは最悪ケースで元データより膨らみ（9bit符号化＋255バイトごとのブロックヘッダ）、
 * さらにフレームごとにカラーテーブル（最大768B）と記述子が付きます。
 * omggif は Uint8Array の範囲外書き込みを黙って捨てるため、足りないとエラーではなく
 * 壊れたGIFが返ります。ここは余裕を持って確保します。
 * @param width フレーム幅
 * @param height フレーム高
 * @param frameCount フレーム数
 */
function estimateBufferSize(width: number, height: number, frameCount: number): number {
  const perFrame = width * height * 2 + MAX_COLORS * 3 + 1024;
  return perFrame * frameCount + 1024;
}

/**
 * RGBAピクセルを、GIFのカラーテーブルとインデックス列に変換します。
 *
 * マインクラフトのピクセルアートは使用色が少ないため、単純な出現順の割り当てで足ります。
 * 256色を超えた分だけ最近傍色に寄せます。
 * @param frame 変換対象のフレーム
 */
function quantizeFrame(frame: GifFrame): QuantizedFrame {
  // 透過は常に先頭に予約します。パレットが埋まってから確保しようとすると、
  // 既存の色に透過を割り当てることになり、その色が抜け落ちます。
  const palette: number[] = [0x000000];
  const colorMap = new Map<number, number>();
  const indexedPixels = new Uint8Array(frame.width * frame.height);

  for (let i = 0, p = 0; i < frame.pixels.length; i += 4, p++) {
    if (frame.pixels[i + 3] < ALPHA_THRESHOLD) {
      indexedPixels[p] = TRANSPARENT_INDEX;
      continue;
    }
    const rgb = (frame.pixels[i] << 16) | (frame.pixels[i + 1] << 8) | frame.pixels[i + 2];
    let index = colorMap.get(rgb);
    if (index === undefined) {
      index = palette.length < MAX_COLORS ? palette.push(rgb) - 1 : nearestIndex(palette, rgb);
      colorMap.set(rgb, index);
    }
    indexedPixels[p] = index;
  }

  // omggifはカラーテーブル長が2のべき乗であることを要求します（"Invalid color table size" 対策）。
  let size = 2;
  while (size < palette.length) size <<= 1;
  while (palette.length < size) palette.push(0x000000);

  return { palette, indexedPixels };
}

/**
 * パレット中で最も近い色の位置を返します（256色を超えたときのフォールバック）。
 * @param palette 現在のパレット
 * @param rgb 探したい色
 */
function nearestIndex(palette: number[], rgb: number): number {
  const [r, g, b] = [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff];

  let best = 1;
  let minDist = Infinity;
  for (let j = 1; j < palette.length; j++) {
    const dist =
      (((palette[j] >> 16) & 0xff) - r) ** 2 +
      (((palette[j] >> 8) & 0xff) - g) ** 2 +
      ((palette[j] & 0xff) - b) ** 2;
    if (dist >= minDist) continue;
    minDist = dist;
    best = j;
  }
  return best;
}

/**
 * 複数のフレーム画像から、アニメーションGIFをエンコードして生成します。
 * @param frames GIFの各フレームデータの配列
 * @param globalDelayMs 各フレームの標準的な表示時間（ミリ秒単位。デフォルトは1000ms）
 * @returns エンコードされたGIFファイルのバイナリデータ
 */
export function encodeGif(frames: GifFrame[], globalDelayMs: number = 1000): Uint8Array {
  if (frames.length === 0) {
    throw new Error("No frames provided");
  }

  const { width, height } = frames[0];
  const buffer = new Uint8Array(estimateBufferSize(width, height, frames.length));
  const gifWriter = new GifWriter(buffer, width, height, { loop: 0 });

  for (const frame of frames) {
    if (frame.width !== width || frame.height !== height) {
      throw new Error("All frames must have the same dimensions");
    }

    const { palette, indexedPixels } = quantizeFrame(frame);
    // omggifの型定義では number[] が宣言されていますが、インデックスアクセス可能な任意のバイトバッファを受け入れます。
    gifWriter.addFrame(0, 0, width, height, indexedPixels as unknown as number[], {
      palette,
      delay: Math.round((frame.delayMs || globalDelayMs) / 10), // omggifのディレイは「10ミリ秒（100分の1秒）」単位です
      transparent: TRANSPARENT_INDEX,
    });
  }

  return buffer.slice(0, gifWriter.end());
}
