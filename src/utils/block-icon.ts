import type { Env } from './minecraft';
import { loadModel, renderModelToSvg } from './model-parser';
import { ensureWasm, svgToPng } from './wasm';
import { bytesToBase64 } from './http';

// Renders a block's model to a 3D isometric icon at request time, so blocks
// uploaded via the write API (which never runs the offline render-blocks
// pipeline) still show as 3D instead of a flat 2D face. Returns null when no
// usable model/textures exist, letting the caller fall back to the flat texture.

const DEFAULT_GUI_DISPLAY = {
  gui: { rotation: [30, 225, 0], translation: [0, 0, 0], scale: [0.625, 0.625, 0.625] },
};

/** Full 1x1x1 cube whose faces reference per-direction texture keys. */
const FULL_CUBE_ELEMENT = {
  from: [0, 0, 0],
  to: [16, 16, 16],
  faces: {
    north: { texture: '#north' },
    south: { texture: '#south' },
    east: { texture: '#east' },
    west: { texture: '#west' },
    up: { texture: '#up' },
    down: { texture: '#down' },
  },
};

/** Render `ns:block/path` to a 3D icon PNG, or null if it can't be built. */
export async function renderBlockIconPng(env: Env, ns: string, path: string): Promise<Uint8Array | null> {
  const topId = `${ns}:block/${path}`;
  const loaded = await loadModel(topId, (id) => modelJson(env, id));
  if (!loaded) return null;

  const model = withGeometry(loaded);
  if (!model) return null;

  await ensureWasm();
  const svg = await renderModelToSvg(
    topId,
    async (id) => (id === topId ? model : await modelJson(env, id)),
    (ref) => textureDataUrl(env, ns, ref)
  );
  if (!svg) return null;
  return svgToPng(svg, { fitTo: { mode: 'width', value: 64 } });
}

/**
 * Ensure a model has renderable elements. Vanilla parents (e.g. block/cube_all)
 * are usually absent from R2, so a block that only defines textures gets a
 * synthetic full cube. Parent is stripped so the renderer won't re-resolve it.
 */
function withGeometry(model: any): any | null {
  if (Array.isArray(model.elements) && model.elements.length > 0) {
    return { ...model, parent: undefined };
  }
  const textures = cubeTextureMap(model.textures || {});
  if (!Object.values(textures).some(Boolean)) return null;
  return {
    parent: undefined,
    textures,
    elements: [FULL_CUBE_ELEMENT],
    display: model.display || DEFAULT_GUI_DISPLAY,
  };
}

/** Map a block model's texture slots onto the six cube faces. */
function cubeTextureMap(t: Record<string, string>): Record<string, string> {
  const side = t.side ?? t.all ?? t.texture ?? t.particle;
  return {
    up: t.top ?? t.up ?? t.all ?? t.end ?? side,
    down: t.bottom ?? t.down ?? t.all ?? t.end ?? side,
    north: t.north ?? side,
    south: t.south ?? side,
    east: t.east ?? side,
    west: t.west ?? side,
  } as Record<string, string>;
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
