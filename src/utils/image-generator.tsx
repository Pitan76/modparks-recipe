import satori, { init as initSatori } from 'satori/standalone';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { encode as encodeJpeg } from 'jpeg-js';
import { getItemImageBase64, getRecipe, getTag, Env } from './minecraft';
import { encodeGif } from './gif-encoder';

// @ts-ignore
import resvgWasmModule from '@resvg/resvg-wasm/index_bg.wasm';
// @ts-ignore
import yogaWasmModule from 'satori/yoga.wasm';

// Cache font and wasm
let fontBuffer: ArrayBuffer | null = null;
let wasmInitialized = false;

async function getFont() {
  if (!fontBuffer) {
    const res = await fetch('https://cdn.jsdelivr.net/npm/@fontsource/roboto@5.0.13/files/roboto-latin-400-normal.woff');
    fontBuffer = await res.arrayBuffer();
  }
  return fontBuffer;
}

async function initResvg() {
  if (!wasmInitialized) {
    try {
      await initWasm(resvgWasmModule);
      await initSatori(yogaWasmModule);
      wasmInitialized = true;
    } catch(e) {
      console.error("WASM init error:", e);
    }
  }
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
    const resId = typeof recipeData.result === 'string' ? recipeData.result : recipeData.result.id;
    resultImage = await getItemImageBase64(resId, env);
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
      
      {/* Output */}
      <div style={{ position: 'absolute', top: '38px', right: '12px', width: '36px', height: '36px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        {resultImage && <img src={resultImage} width={32} height={32} style={{ imageRendering: 'pixelated' }} />}
      </div>
    </div>
  );

  return satori(element, {
    width: 236,
    height: 112,
    fonts: [{ name: 'Roboto', data: font, weight: 400, style: 'normal' }],
  });
}

export async function renderRecipePng(recipeData: any, env: Env, tagOffset: number = 0): Promise<Uint8Array> {
  await initResvg();
  const svg = await generateRecipeSvg(recipeData, env, tagOffset);
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 250 } });
  return resvg.render().asPng();
}

export async function renderRecipeJpg(recipeData: any, env: Env, tagOffset: number = 0): Promise<Uint8Array> {
  await initResvg();
  const svg = await generateRecipeSvg(recipeData, env, tagOffset);
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 250 } });
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

export async function renderRecipeGif(recipeData: any, env: Env, maxFrames: number = 5): Promise<Uint8Array> {
  await initResvg();
  const frames = [];
  
  for (let i = 0; i < maxFrames; i++) {
    const svg = await generateRecipeSvg(recipeData, env, i);
    const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 250 } });
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
