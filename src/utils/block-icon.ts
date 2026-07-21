import type { Env } from './minecraft';
import { loadModel, renderModelToSvg } from './model-parser';
import { ensureWasm, svgToPng } from './wasm';
import { bytesToBase64 } from './http';
import { FLAT_ITEM_PARENTS } from '../core/block-geometry';

// Renders a block's model to a 3D isometric icon at request time, so blocks
// pushed through the write API (which never runs the offline render-blocks
// pipeline) look the same as the pre-rendered vanilla ones.
//
// Geometry is only ever taken from real model JSON — the model itself or a
// parent it inherits from, vanilla parents included. If the chain can't be
// resolved to actual `elements`, this returns null and the caller falls back to
// the flat texture. Never synthesize a stand-in cube from the texture list: the
// result does not match the real block and is worse than the 2D fallback.

/** Matches SIZE in scripts/render-blocks/render.ts, so both paths agree. */
const ICON_SIZE = 128;

/** Render the block behind `ns:path` to a 3D icon PNG, or null if not possible. */
export async function renderBlockIconPng(env: Env, ns: string, path: string): Promise<Uint8Array | null> {
  const getModel = (id: string) => modelJson(env, id);
  const getTexture = (ref: string) => textureDataUrl(env, ns, ref);

  // The item model (`ns:item/<path>`) is what the game actually shows in a slot.
  // For a block item it just points at the block model via `parent`, but some
  // blocks are deliberately drawn flat there instead: a torch's item model is
  // `item/generated` over the block/torch texture, so the game shows the 2D
  // sprite, not the 3D torch. Honour that and stop — falling through to the
  // block model would render a 3D shape the game never displays.
  const itemModel = await loadModel(`${ns}:item/${path}`, getModel);
  if (isFlatItemModel(itemModel)) return null;

  for (const modelId of [`${ns}:item/${path}`, `${ns}:block/${path}`]) {
    const model = await loadModel(modelId, getModel);
    if (!hasGeometry(model)) continue;

    await ensureWasm();
    const svg = await renderModelToSvg(modelId, getModel, getTexture);
    if (!svg) continue;
    // Pixel art: no antialiasing anywhere. shapeRendering 0 (optimizeSpeed)
    // stops the face clip paths from feathering their edges, imageRendering 1
    // (optimizeSpeed) samples the textures nearest-neighbour.
    return svgToPng(svg, {
      fitTo: { mode: 'width', value: ICON_SIZE },
      shapeRendering: 0,
      imageRendering: 1,
    });
  }
  return null;
}

/** True when the item is meant to be drawn as a flat sprite rather than in 3D. */
function isFlatItemModel(model: any): boolean {
  return !!model && FLAT_ITEM_PARENTS.has(model.parent);
}

/** True only when the resolved model chain yielded real, renderable geometry. */
function hasGeometry(model: any): boolean {
  return !!model && Array.isArray(model.elements) && model.elements.length > 0;
}

async function modelJson(env: Env, id: string): Promise<any | null> {
  const { ns, path } = split(id);
  const obj = await env.BUCKET.get(`assets/${ns}/models/${path}.json`);
  if (!obj) return null;
  try {
    return JSON.parse(await obj.text());
  } catch {
    return null;
  }
}

async function textureDataUrl(env: Env, defaultNs: string, ref: string): Promise<string | null> {
  const { ns, path } = split(ref, defaultNs);
  let obj = await env.BUCKET.get(`assets/${ns}/textures/${path}.png`);
  if (!obj && ns !== 'minecraft') obj = await env.BUCKET.get(`assets/minecraft/textures/${path}.png`);
  if (!obj) return null;
  return `data:image/png;base64,${bytesToBase64(new Uint8Array(await obj.arrayBuffer()))}`;
}

function split(id: string, fallbackNs = 'minecraft'): { ns: string; path: string } {
  const idx = id.indexOf(':');
  if (idx < 0) return { ns: fallbackNs, path: id };
  return { ns: id.slice(0, idx), path: id.slice(idx + 1) };
}
