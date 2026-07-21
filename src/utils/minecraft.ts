import { renderBlockIconPng } from './block-icon';
import { bytesToBase64 } from './http';

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ADMIN_SECRET: string;
  // Secret required for the write/upload API. Falls back to ADMIN_SECRET.
  UPLOAD_SECRET?: string;
}

export function resultItemOf(data: any): string | null {
  const r = data?.result;
  if (!r) return null;
  const id = typeof r === 'string' ? r : (r.id || r.item || null);
  if (!id || typeof id !== 'string') return null;
  return id.includes(':') ? id : `minecraft:${id}`;
}

export function isCraftingType(type: unknown): boolean {
  if (typeof type !== 'string') return false;
  const t = type.replace(/^minecraft:/, '');
  return t === 'crafting_shaped' || t === 'crafting_shapeless';
}

export function parseNamespacedId(id: string): { namespace: string; path: string } {
  // e.g. "minecraft:wooden_sword" -> { namespace: "minecraft", path: "wooden_sword" }
  // e.g. "stone" -> { namespace: "minecraft", path: "stone" }
  if (id.includes(':')) {
    const [namespace, ...rest] = id.split(':');
    return { namespace, path: rest.join(':') };
  }
  return { namespace: 'minecraft', path: id };
}

function bufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ----------------------------------------------------
// Recipes
// ----------------------------------------------------

export async function getRecipe(id: string, env: Env): Promise<any | null> {
  const { results } = await env.DB.prepare('SELECT data FROM recipes WHERE id = ?').bind(id).all();
  if (results && results.length > 0) {
    return JSON.parse(results[0].data as string);
  }

  const { namespace, path } = parseNamespacedId(id);
  
  let obj = await env.BUCKET.get(`data/${namespace}/recipe/${path}.json`);
  if (!obj) {
    obj = await env.BUCKET.get(`data/${namespace}/recipes/${path}.json`);
  }
  
  if (!obj) return null;

  const dataStr = await obj.text();
  const data = JSON.parse(dataStr);
  
  let resultItem = "";
  if (data.result && data.result.id) resultItem = data.result.id;
  else if (data.result && typeof data.result === 'string') resultItem = data.result;

  // Fire and forget caching
  env.DB.prepare('INSERT OR REPLACE INTO recipes (id, result_item, data) VALUES (?, ?, ?)')
    .bind(id, resultItem, dataStr)
    .run().catch(console.error);

  return data;
}

// ----------------------------------------------------
// Tags
// ----------------------------------------------------

export async function getTag(id: string, env: Env): Promise<string[]> {
  if (id.startsWith('#')) id = id.substring(1);
  
  const { results } = await env.DB.prepare('SELECT data FROM tags WHERE id = ?').bind(id).all();
  if (results && results.length > 0) {
    return JSON.parse(results[0].data as string).values || [];
  }

  const { namespace, path } = parseNamespacedId(id);
  
  // Tag paths can be under items, item, blocks, or block
  let obj = await env.BUCKET.get(`data/${namespace}/tags/item/${path}.json`);
  if (!obj) obj = await env.BUCKET.get(`data/${namespace}/tags/items/${path}.json`);
  if (!obj) obj = await env.BUCKET.get(`data/${namespace}/tags/block/${path}.json`);
  if (!obj) obj = await env.BUCKET.get(`data/${namespace}/tags/blocks/${path}.json`);

  if (!obj) return [];

  const dataStr = await obj.text();
  const data = JSON.parse(dataStr);

  env.DB.prepare('INSERT OR REPLACE INTO tags (id, data) VALUES (?, ?)')
    .bind(id, dataStr)
    .run().catch(console.error);

  return data.values || [];
}

// ----------------------------------------------------
// Images
// ----------------------------------------------------

/** Fetch a texture PNG from R2 by its resource id (e.g. "ns:item/foo") as a data URL. */
async function textureDataUrl(texId: string, defaultNs: string, env: Env): Promise<string | null> {
  const tns = texId.includes(':') ? texId.split(':')[0] : defaultNs;
  const tpath = texId.includes(':') ? texId.split(':').slice(1).join(':') : texId;
  let obj = await env.BUCKET.get(`assets/${tns}/textures/${tpath}.png`);
  // Unprefixed refs default to minecraft; if the mod ns had no match, try minecraft too.
  if (!obj && tns !== 'minecraft') obj = await env.BUCKET.get(`assets/minecraft/textures/${tpath}.png`);
  if (!obj) return null;
  return `data:image/png;base64,${bufferToBase64(await obj.arrayBuffer())}`;
}

/** Walk a model's parent chain, merging texture maps (child overrides parent). */
async function mergedModelTextures(
  ns: string,
  modelPath: string,
  env: Env,
  seen: Set<string>
): Promise<Record<string, string>> {
  const key = `${ns}:${modelPath}`;
  if (seen.has(key) || seen.size > 12) return {};
  seen.add(key);

  const obj = await env.BUCKET.get(`assets/${ns}/models/${modelPath}.json`);
  if (!obj) return {};
  let model: any;
  try { model = JSON.parse(await obj.text()); } catch { return {}; }

  let base: Record<string, string> = {};
  if (typeof model.parent === 'string' && !model.parent.includes('builtin/')) {
    const p = model.parent;
    const pns = p.includes(':') ? p.split(':')[0] : ns;
    const pPath = p.includes(':') ? p.split(':').slice(1).join(':') : p;
    base = await mergedModelTextures(pns, pPath, env, seen);
  }
  return { ...base, ...(model.textures || {}) };
}

/** Pick a concrete (non-#reference) texture from a merged model texture map. */
function pickModelTexture(textures: Record<string, string>): string | null {
  const prefer = ['layer0', 'all', 'texture', 'side', 'front', 'particle', 'end', 'top'];
  for (const k of prefer) {
    const v = textures[k];
    if (typeof v === 'string' && v && !v.startsWith('#')) return v;
  }
  for (const v of Object.values(textures)) {
    if (typeof v === 'string' && v && !v.startsWith('#')) return v;
  }
  return null;
}

/** Resolve an item's texture via its model JSON (for items whose id != texture filename). */
async function resolveViaModel(namespace: string, path: string, env: Env): Promise<string | null> {
  for (const kind of ['item', 'block']) {
    const textures = await mergedModelTextures(namespace, `${kind}/${path}`, env, new Set());
    const texId = pickModelTexture(textures);
    if (texId) {
      const url = await textureDataUrl(texId, namespace, env);
      if (url) return url;
    }
  }
  return null;
}

const TRANSPARENT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAcSURBVDhPY3hAIP+PgYGBkIGxAaNgFIwCFAYGBgA9Vww1u0dD/wAAAABJRU5ErkJggg==";

export async function getItemImageBase64(id: string, env: Env): Promise<string | null> {
  const { namespace, path } = parseNamespacedId(id);

  // 1. Pre-rendered PNG from the offline render-blocks pipeline.
  let obj = await env.BUCKET.get(`assets/${namespace}/textures/render3d/${path}.png`);
  if (obj) return `data:image/png;base64,${bufferToBase64(await obj.arrayBuffer())}`;

  // 2. Flat PNG whose filename matches the item id.
  obj = await env.BUCKET.get(`assets/${namespace}/textures/item/${path}.png`);
  if (obj) return `data:image/png;base64,${bufferToBase64(await obj.arrayBuffer())}`;

  // 3. Block: render its model to a 3D isometric icon, matching how the offline
  //    pipeline renders vanilla blocks, and cache it under render3d/ so later
  //    requests hit step 1. Returns null unless the model chain resolved to real
  //    geometry, so blocks it can't render still get their flat texture below.
  const icon = await renderBlockIconPng(env, namespace, path).catch(() => null);
  if (icon) {
    await env.BUCKET.put(`assets/${namespace}/textures/render3d/${path}.png`, icon, {
      httpMetadata: { contentType: 'image/png' },
    }).catch(() => {});
    return `data:image/png;base64,${bytesToBase64(icon)}`;
  }

  // 4. Flat block texture (block with no renderable model).
  obj = await env.BUCKET.get(`assets/${namespace}/textures/block/${path}.png`);
  if (obj) return `data:image/png;base64,${bufferToBase64(await obj.arrayBuffer())}`;

  // 5. Filename != id: resolve the item/block model JSON to its texture.
  const viaModel = await resolveViaModel(namespace, path, env);
  if (viaModel) return viaModel;

  // 6. No texture available. Block entities needing special handling (chests, …)
  //    are covered by the offline render-blocks pipeline.
  return TRANSPARENT_PNG;
}
