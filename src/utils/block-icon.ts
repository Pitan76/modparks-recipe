import type { Env } from './minecraft';
import { loadModel, renderModelToSvg } from './model-parser';
import { ensureWasm, svgToPng } from './wasm';
import { bytesToBase64 } from './http';
import { chestModel, CHEST_VARIANTS } from '../core/chest';
import { getAssetVersion } from './cache-version';

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
  const svg = await renderBlockIconSvg(env, ns, path);
  if (!svg) return null;
  await ensureWasm();
  // Pixel art: no antialiasing anywhere. shapeRendering 0 (optimizeSpeed) stops
  // the face clip paths from feathering their edges, imageRendering 1
  // (optimizeSpeed) samples the textures nearest-neighbour.
  return svgToPng(svg, {
    fitTo: { mode: 'width', value: ICON_SIZE },
    shapeRendering: 0,
    imageRendering: 1,
  });
}

/** The icon as SVG, before rasterization. Exposed for debugging the geometry. */
export async function renderBlockIconSvg(env: Env, ns: string, path: string): Promise<string | null> {
  const getModel = (id: string) => modelJson(env, id);
  const getTexture = (ref: string) => textureDataUrl(env, ns, ref);

  // Prefer 3D for anything with a block model, even when the item model says
  // draw it flat. Vanilla shows a torch as a 2D sprite in the inventory, but a
  // recipe image reads better with every block drawn the same way, so the flat
  // `item/generated` model is skipped in favour of `block/<path>` below.
  // Genuine items (a stick, a sword) have no block model and still fall back to
  // their flat texture.
  // Block entities (chests, ...) resolve to `builtin/entity` with no elements;
  // their geometry has to be synthesized from the entity atlas instead.
  const synthetic = ns === 'minecraft' && CHEST_VARIANTS[path]
    ? chestModel(CHEST_VARIANTS[path])
    : null;

  const candidates = synthetic
    ? [{ id: `${ns}:block/${path}`, model: synthetic }]
    : [`${ns}:item/${path}`, `${ns}:block/${path}`].map((id) => ({ id, model: null as any }));

  for (const candidate of candidates) {
    const model = candidate.model ?? (await loadModel(candidate.id, getModel));
    if (!hasGeometry(model)) continue;

    // A synthesized model is passed straight through rather than re-read by id.
    const resolve = candidate.model
      ? async (id: string) => (id === candidate.id ? candidate.model : await getModel(id))
      : getModel;
    const svg = await renderModelToSvg(candidate.id, resolve, getTexture);
    if (svg) return svg;
  }
  return null;
}

/** True only when the resolved model chain yielded real, renderable geometry. */
function hasGeometry(model: any): boolean {
  return !!model && Array.isArray(model.elements) && model.elements.length > 0;
}

// Rendering one icon re-reads the same objects several times over: the parent
// chain is walked once for `item/<path>`, again for `block/<path>`, and a third
// time inside renderModelToSvg, and a nine-slot recipe repeats all of it per
// slot. Shared vanilla parents like `block/cube_all` are the worst of it. Every
// one of those reads is sequential, so they add up: measured over
// `wrangler dev --remote`, a single warm `minecraft:stone` icon went from
// ~4.6s to ~250ms once these two reads were memoized.
//
// Promises are stored rather than resolved values, so the concurrent lookups
// that parallel slots fire for the same parent collapse into one read too.
const memo = new Map<string, Promise<any>>();

/**
 * Cap on retained entries. An isolate that has churned through this many is
 * mostly holding superseded versions, so drop everything rather than track LRU:
 * the cost of a miss is one R2 get.
 */
const MEMO_MAX = 2000;

/**
 * Read an asset once per isolate per asset version. Keying on the version is
 * what makes this safe against the write API: an upload bumps it and every
 * entry for the old version becomes unreachable, exactly as for rendered images.
 */
async function memoized<T>(env: Env, ns: string, key: string, load: () => Promise<T>): Promise<T> {
  const version = await getAssetVersion(env, ns);
  const memoKey = `${version}:${ns}:${key}`;

  const hit = memo.get(memoKey);
  if (hit) return hit as Promise<T>;

  if (memo.size >= MEMO_MAX) memo.clear();
  // A failed read must not be remembered, or one transient R2 error would stick
  // to this isolate for as long as the version holds.
  const pending = load().catch((err) => {
    memo.delete(memoKey);
    throw err;
  });
  memo.set(memoKey, pending);
  return pending as Promise<T>;
}

function modelJson(env: Env, id: string): Promise<any | null> {
  const { ns, path } = split(id);
  return memoized(env, ns, `models/${path}`, async () => {
    const obj = await env.BUCKET.get(`assets/${ns}/models/${path}.json`);
    if (!obj) return null;
    try {
      return JSON.parse(await obj.text());
    } catch {
      return null;
    }
  });
}

function textureDataUrl(env: Env, defaultNs: string, ref: string): Promise<string | null> {
  const { ns, path } = split(ref, defaultNs);
  // Keyed on the requesting namespace's version even when the read falls back to
  // vanilla, so a `minecraft` upload alone won't invalidate a mod's entry. That
  // only matters for re-uploaded vanilla textures, which the offline pipeline
  // writes once per version anyway.
  return memoized(env, ns, `textures/${path}`, async () => {
    let obj = await env.BUCKET.get(`assets/${ns}/textures/${path}.png`);
    if (!obj && ns !== 'minecraft') obj = await env.BUCKET.get(`assets/minecraft/textures/${path}.png`);
    if (!obj) return null;
    return `data:image/png;base64,${bytesToBase64(new Uint8Array(await obj.arrayBuffer()))}`;
  });
}

function split(id: string, fallbackNs = 'minecraft'): { ns: string; path: string } {
  const idx = id.indexOf(':');
  if (idx < 0) return { ns: fallbackNs, path: id };
  return { ns: id.slice(0, idx), path: id.slice(idx + 1) };
}
