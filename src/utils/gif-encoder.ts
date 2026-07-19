import { GifWriter } from 'omggif';

export interface GifFrame {
  width: number;
  height: number;
  pixels: Uint8ClampedArray | Uint8Array; // RGBA pixels
  delayMs?: number; // Delay in milliseconds
}

export function encodeGif(frames: GifFrame[], globalDelayMs: number = 1000): Uint8Array {
  if (frames.length === 0) {
    throw new Error("No frames provided");
  }

  const width = frames[0].width;
  const height = frames[0].height;

  // Pre-calculate total buffer size (rough estimate)
  const buffer = new Uint8Array(width * height * frames.length + 1024);
  
  const gifWriter = new GifWriter(buffer, width, height, { loop: 0 });

  for (const frame of frames) {
    if (frame.width !== width || frame.height !== height) {
      throw new Error("All frames must have the same dimensions");
    }

    // Convert RGBA to indexed color using a simple palette strategy
    // Since this is pixel art (Minecraft), unique colors are limited.
    // However, omggif requires palette (RGB) and index buffer.
    
    // Simple 256 color median cut or just unique colors mapper
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
        // Transparent
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
            // Find closest color (fallback, slow but safe)
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

    // omggif requires the palette length to be a power of two (2..256).
    // Pad with black entries so encoding never throws "Invalid color table size".
    let palSize = 2;
    while (palSize < palette.length) palSize <<= 1;
    while (palette.length < palSize) palette.push(0x000000);

    // omggif's types declare number[], but it accepts any indexable byte buffer.
    gifWriter.addFrame(0, 0, width, height, indexedPixels as unknown as number[], {
      palette: palette,
      delay: Math.round((frame.delayMs || globalDelayMs) / 10), // omggif delay is in hundredths of a second
      transparent: transparentIndex >= 0 ? transparentIndex : undefined,
    });
  }

  // Return the sliced buffer to exact length
  return buffer.slice(0, gifWriter.end());
}
