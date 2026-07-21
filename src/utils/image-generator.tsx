import satori from 'satori/standalone';
import { Resvg } from '@resvg/resvg-wasm';
import { encode as encodeJpeg } from 'jpeg-js';
import { getItemImageBase64, getTag, Env } from './minecraft';
import { encodeGif } from './gif-encoder';
import { ensureWasm } from './wasm';

// Cache font
let fontBuffer: ArrayBuffer | null = null;

async function getFont() {
  if (!fontBuffer) {
    const res = await fetch('https://cdn.jsdelivr.net/npm/@fontsource/roboto@5.0.13/files/roboto-latin-400-normal.woff');
    fontBuffer = await res.arrayBuffer();
  }
  return fontBuffer;
}

async function resolveIngredient(ingredient: any, env: Env, tagOffset: number): Promise<string | null> {
  if (!ingredient) return null;
  if (typeof ingredient === 'string') {
    if (ingredient.startsWith('#')) {
      return resolveIngredient({ tag: ingredient.substring(1) }, env, tagOffset);
    } else {
      return resolveIngredient({ item: ingredient }, env, tagOffset);
    }
  }
  if (Array.isArray(ingredient)) {
    return resolveIngredient(ingredient[0], env, tagOffset);
  }
  if (ingredient.item) {
    return await getItemImageBase64(ingredient.item, env);
  }
  if (ingredient.tag) {
    const tagItems = await getTag(ingredient.tag, env);
    if (tagItems.length > 0) {
      const targetItem = tagItems[tagOffset % tagItems.length];
      return resolveIngredient(targetItem, env, tagOffset);
    }
  }
  return null;
}

export async function createRecipeGrid(recipeData: any, env: Env, tagOffset: number): Promise<Array<string | null>> {
  const grid: Array<string | null> = Array(9).fill(null);
  
  if (recipeData.type === 'minecraft:crafting_shaped' || recipeData.type === 'crafting_shaped') {
    const pattern = recipeData.pattern;
    const key = recipeData.key;
    
    for (let r = 0; r < pattern.length; r++) {
      for (let c = 0; c < pattern[r].length; c++) {
        const char = pattern[r][c];
        if (char !== ' ') {
          grid[r * 3 + c] = await resolveIngredient(key[char], env, tagOffset);
        }
      }
    }
  } else if (recipeData.type === 'minecraft:crafting_shapeless' || recipeData.type === 'crafting_shapeless') {
    const ingredients = recipeData.ingredients;
    for (let i = 0; i < ingredients.length; i++) {
      grid[i] = await resolveIngredient(ingredients[i], env, tagOffset);
    }
  }
  
  return grid;
}

export async function generateRecipeSvg(recipeData: any, env: Env, tagOffset: number = 0) {
  const font = await getFont();
  const grid = await createRecipeGrid(recipeData, env, tagOffset);
  
  let resultImage: string | null = null;
  if (recipeData.result) {
    const resId = typeof recipeData.result === 'string'
      ? recipeData.result
      : (recipeData.result.id || recipeData.result.item);
    if (resId) resultImage = await getItemImageBase64(resId, env);
  }
  
  // Base64 of public/crafting_3x3.png
  const bgBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHYAAAA4CAYAAAAo9QwNAAAACXBIWXMAAFxGAABcRgEUlENBAAABk0lEQVR4nO3bUY6DIBSF4cOEVekyZCW6LpYhcVf0YeJjYwqI18P5kkn6MLlp8tdKC3X7vmeQcs49/RQe4wFgXdfqQcuyIMZoZk4IAfM8V895K38+CCFUDdq2DTFGU3OO46ia8WZ/Tz8BuYfCklJYUgpLSmFJKSwphSWlsKQUlpTCklJYUv76X6SFnPttojnnFLanFrtoV85dLYXtrHbX6sq5q6V7LCkP/G9ub9tWPczanJF5AIgxVp9aOE8+WJlzxwmKcwH0hiM3OkHxo5QSpmkyH1f32AIppa4fX0oobCHrcRW2guW4ClvJatwhw+aci/6+sRh32G+eUkrN51laLQ95xd6l9YulhsI2ZOknJUO+FTvniiLknL9elZaiArpim7AWFVDYahajAgpbxWpUQGGLWY4KKGwR61EBhf1J6Wr6CTpBQUonKEjpBAUp3WNJDfmV4lNCCN3WDgrbybmi7nV70FsxKYUlpbCkFJaUwpJSWFIKS0phSSksKYUlpbCkFJaUB9rtOlibMzKXUrL1MzFp4gNTwNqKklCKbAAAAABJRU5ErkJggg==";

  const element = (
    <div style={{ display: 'flex', backgroundImage: `url(${bgBase64})`, backgroundSize: '236px 112px', width: '236px', height: '112px', position: 'relative' }}>
      {/* 3x3 Grid */}
      <div style={{ display: 'flex', flexWrap: 'wrap', width: '108px', height: '108px', position: 'absolute', top: '2px', left: '2px' }}>
        {grid.map((img, i) => (
          <div key={i} style={{ width: '36px', height: '36px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            {img && <img src={img} width={32} height={32} style={{ imageRendering: 'pixelated' }} />}
          </div>
        ))}
      </div>
      
      {/* Output. Slot center measured from crafting_3x3.png at 207,55 in this 236x112 space. */}
      <div style={{ position: 'absolute', top: '37px', left: '188px', width: '36px', height: '36px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        {resultImage && <img src={resultImage} width={32} height={32} style={{ imageRendering: 'pixelated' }} />}
      </div>
    </div>
  );

  const svg = await satori(element, {
    width: 236,
    height: 112,
    fonts: [{ name: 'Roboto', data: font, weight: 400, style: 'normal' }],
  });

  // Force nearest-neighbor sampling on every embedded texture so pixel-art
  // stays crisp. resvg maps image-rendering="optimizeSpeed" to nearest-neighbor;
  // relying on satori's CSS output alone still produced antialiased edges.
  return svg.replace(/<image /g, '<image image-rendering="optimizeSpeed" ');
}

// Render at an integer zoom to avoid fractional resampling of the whole canvas
// (which reintroduces antialiasing). Integer scaling keeps pixel art crisp.
// Base canvas is 236x112, so scale N -> (236*N)x(112*N). Default 2x = 472x224.
export const DEFAULT_SCALE = 2;
export const MAX_SCALE = 8;

/** Clamp a caller-supplied scale to a safe integer range. */
export function normalizeScale(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_SCALE;
  return Math.min(n, MAX_SCALE);
}

export async function renderRecipePng(recipeData: any, env: Env, tagOffset: number = 0, scale: number = DEFAULT_SCALE): Promise<Uint8Array> {
  await ensureWasm();
  const svg = await generateRecipeSvg(recipeData, env, tagOffset);
  const resvg = new Resvg(svg, { fitTo: { mode: 'zoom', value: scale } });
  return resvg.render().asPng();
}

export async function renderRecipeJpg(recipeData: any, env: Env, tagOffset: number = 0, scale: number = DEFAULT_SCALE): Promise<Uint8Array> {
  await ensureWasm();
  const svg = await generateRecipeSvg(recipeData, env, tagOffset);
  const resvg = new Resvg(svg, { fitTo: { mode: 'zoom', value: scale } });
  const rendered = resvg.render();
  const { width, height, pixels } = rendered;

  // JPEG has no alpha channel, so flatten the transparent recipe image onto
  // a solid white background to avoid black fringing on transparent pixels.
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

// Base recipe canvas dimensions (before scaling).
export const TILE_BASE_WIDTH = 236;
export const TILE_BASE_HEIGHT = 112;

function bytesToBase64Local(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export interface SpriteSheet {
  png: Uint8Array;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  count: number;
  /** ids in tile order (row-major); a null means that slot rendered blank. */
  order: Array<string | null>;
  missing: string[];
}

/**
 * Render many recipes into a single PNG sprite sheet, tiled row-major. Each tile
 * is TILE_BASE_WIDTH x TILE_BASE_HEIGHT * scale. Callers slice tiles by index:
 *   col = i % columns, row = floor(i / columns)
 *   x = col * tileWidth, y = row * tileHeight
 * Recipes are rendered once each to PNG, then composited via one outer SVG so
 * the sheet is produced in a single resvg pass.
 */
export async function renderRecipeSpriteSheet(
  entries: Array<{ id: string; recipe: any | null }>,
  env: Env,
  columns: number = 8,
  scale: number = DEFAULT_SCALE
): Promise<SpriteSheet> {
  await ensureWasm();

  const tileWidth = TILE_BASE_WIDTH * scale;
  const tileHeight = TILE_BASE_HEIGHT * scale;
  const cols = Math.max(1, Math.floor(columns));
  const count = entries.length;
  const rows = Math.max(1, Math.ceil(count / cols));

  const order: Array<string | null> = [];
  const missing: string[] = [];
  const tiles: string[] = [];

  await Promise.all(
    entries.map(async (entry, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * tileWidth;
      const y = row * tileHeight;
      if (!entry.recipe) {
        order[i] = null;
        missing.push(entry.id);
        return;
      }
      const png = await renderRecipePng(entry.recipe, env, 0, scale);
      const dataUrl = `data:image/png;base64,${bytesToBase64Local(png)}`;
      order[i] = entry.id;
      tiles[i] = `<image x="${x}" y="${y}" width="${tileWidth}" height="${tileHeight}" image-rendering="optimizeSpeed" href="${dataUrl}" />`;
    })
  );

  const sheetWidth = cols * tileWidth;
  const sheetHeight = rows * tileHeight;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetWidth}" height="${sheetHeight}" viewBox="0 0 ${sheetWidth} ${sheetHeight}">` +
    tiles.filter(Boolean).join('') +
    `</svg>`;

  const resvg = new Resvg(svg, { fitTo: { mode: 'original' } });
  const png = resvg.render().asPng();

  return { png, tileWidth, tileHeight, columns: cols, rows, count, order, missing };
}

export async function renderRecipeGif(recipeData: any, env: Env, maxFrames: number = 5, scale: number = DEFAULT_SCALE): Promise<Uint8Array> {
  await ensureWasm();
  const frames = [];

  for (let i = 0; i < maxFrames; i++) {
    const svg = await generateRecipeSvg(recipeData, env, i);
    const resvg = new Resvg(svg, { fitTo: { mode: 'zoom', value: scale } });
    const rendered = resvg.render();
    frames.push({
      width: rendered.width,
      height: rendered.height,
      pixels: rendered.pixels,
      delayMs: 1000 // 1 second per frame
    });
  }
  
  return encodeGif(frames);
}
