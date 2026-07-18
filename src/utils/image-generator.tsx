import satori from 'satori';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { getItemImageBase64, getRecipe, getTag, Env } from './minecraft';
import { encodeGif } from './gif-encoder';

// @ts-ignore
import resvgWasmModule from '@resvg/resvg-wasm/index_bg.wasm';

// Cache font and wasm
let fontBuffer: ArrayBuffer | null = null;
let wasmInitialized = false;

async function getFont() {
  if (!fontBuffer) {
    const res = await fetch('https://github.com/vercel/satori/raw/main/playground/public/Roboto-Regular.ttf');
    fontBuffer = await res.arrayBuffer();
  }
  return fontBuffer;
}

async function initResvg() {
  if (!wasmInitialized) {
    try {
      await initWasm(resvgWasmModule);
      wasmInitialized = true;
    } catch(e) {
      console.error("WASM init error:", e);
    }
  }
}

async function resolveIngredient(ingredient: any, env: Env, tagOffset: number): Promise<string | null> {
  if (!ingredient) return null;
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
      return await getItemImageBase64(targetItem, env);
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
  
  // Basic crafting table UI layout
  const element = (
    <div style={{ display: 'flex', backgroundColor: '#C6C6C6', padding: '10px', border: '2px solid #555', borderRadius: '5px', width: '250px', height: '120px', alignItems: 'center' }}>
      {/* 3x3 Grid */}
      <div style={{ display: 'flex', flexWrap: 'wrap', width: '96px', height: '96px', backgroundColor: '#8B8B8B' }}>
        {grid.map((img, i) => (
          <div key={i} style={{ width: '30px', height: '30px', backgroundColor: '#8B8B8B', border: '1px solid #373737', margin: '1px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            {img && <img src={img} width={24} height={24} style={{ imageRendering: 'pixelated' }} />}
          </div>
        ))}
      </div>
      
      {/* Arrow */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', fontSize: '24px', fontWeight: 'bold', color: '#373737', paddingLeft: '10px' }}>
        →
      </div>
      
      {/* Output */}
      <div style={{ width: '40px', height: '40px', backgroundColor: '#8B8B8B', border: '2px solid #373737', marginLeft: '10px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        {resultImage && <img src={resultImage} width={32} height={32} style={{ imageRendering: 'pixelated' }} />}
      </div>
    </div>
  );

  return satori(element, {
    width: 250,
    height: 120,
    fonts: [{ name: 'Roboto', data: font, weight: 400, style: 'normal' }],
  });
}

export async function renderRecipePng(recipeData: any, env: Env, tagOffset: number = 0): Promise<Uint8Array> {
  await initResvg();
  const svg = await generateRecipeSvg(recipeData, env, tagOffset);
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 250 } });
  return resvg.render().asPng();
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
