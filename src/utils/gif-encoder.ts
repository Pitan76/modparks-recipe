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

  const width = frames[0].width;
  const height = frames[0].height;

  // 大まかなバッファ全体のサイズを事前に計算します。
  const buffer = new Uint8Array(width * height * frames.length + 1024);
  
  const gifWriter = new GifWriter(buffer, width, height, { loop: 0 });

  for (const frame of frames) {
    if (frame.width !== width || frame.height !== height) {
      throw new Error("All frames must have the same dimensions");
    }

    // シンプルなパレット戦略を使用して、RGBAをインデックス付きカラーに変換します。
    // マインクラフトのピクセルアートであるため、使用される色の数は限定されています。
    // ただし、omggifはパレット（RGB）とインデックスバッファを必要とします。
    
    // シンプルな256色のメディアンカット、または一意の色のマッパー。
    const palette: number[] = [];
    const colorMap = new Map<number, number>();
    const indexedPixels = new Uint8Array(width * height);
    let transparentIndex = -1;

    for (let i = 0, p = 0; i < frame.pixels.length; i += 4, p++) {
      const r = frame.pixels[i];
      const g = frame.pixels[i + 1];
      const b = frame.pixels[i + 2];
      const a = frame.pixels[i + 3];

      if (a < 128) {
        // 透過色
        if (transparentIndex === -1) {
          if (palette.length < 256) {
            transparentIndex = palette.length;
            palette.push(0x000000);
          } else {
            transparentIndex = 255;
          }
        }
        indexedPixels[p] = transparentIndex;
      } else {
        const rgb = (r << 16) | (g << 8) | b;
        let index = colorMap.get(rgb);
        if (index === undefined) {
          if (palette.length < 256) {
            index = palette.length;
            palette.push(rgb);
            colorMap.set(rgb, index);
          } else {
            // 最も近い色を検索（フォールバック用：処理は遅いが安全）。
            index = 0;
            let minDist = Infinity;
            for (let j = 0; j < palette.length; j++) {
              if (j === transparentIndex) continue;
              const pr = (palette[j] >> 16) & 0xff;
              const pg = (palette[j] >> 8) & 0xff;
              const pb = palette[j] & 0xff;
              const dist = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
              if (dist < minDist) {
                minDist = dist;
                index = j;
              }
            }
          }
        }
        indexedPixels[p] = index;
      }
    }

    // omggifはパレットの長さが2のべき乗（2から256の間）であることを要求します。
    // エンコード時に "Invalid color table size" エラーが発生するのを防ぐため、黒でパディングします。
    let palSize = 2;
    while (palSize < palette.length) palSize <<= 1;
    while (palette.length < palSize) palette.push(0x000000);

    // omggifの型定義では number[] が宣言されていますが、インデックスアクセス可能な任意のバイトバッファを受け入れます。
    gifWriter.addFrame(0, 0, width, height, indexedPixels as unknown as number[], {
      palette: palette,
      delay: Math.round((frame.delayMs || globalDelayMs) / 10), // omggifのディレイは「10ミリ秒（100分の1秒）」単位です
      transparent: transparentIndex >= 0 ? transparentIndex : undefined,
    });
  }

  // 正確な長さにスライスしたバッファを返します。
  return buffer.slice(0, gifWriter.end());
}
