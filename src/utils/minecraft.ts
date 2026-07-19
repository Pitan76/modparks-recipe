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

export async function getItemImageBase64(id: string, env: Env): Promise<string | null> {
  const { namespace, path } = parseNamespacedId(id);
  
  // 1. Check for pre-rendered PNG (3D blocks and specialized items)
  let obj = await env.BUCKET.get(`assets/${namespace}/textures/render3d/${path}.png`);
  if (obj) {
      const buffer = await obj.arrayBuffer();
      const base64 = bufferToBase64(buffer);
      return `data:image/png;base64,${base64}`;
  }
  
  // 2. Fallback to raw flat PNGs
  obj = await env.BUCKET.get(`assets/${namespace}/textures/item/${path}.png`);
  if (!obj) obj = await env.BUCKET.get(`assets/${namespace}/textures/block/${path}.png`);
  
  if (!obj) {
    // No texture available. Return a transparent 16x16 PNG. Block entities that
    // need special handling (chests, ...) are rendered by render-blocks.ts.
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAcSURBVDhPY3hAIP+PgYGBkIGxAaNgFIwCFAYGBgA9Vww1u0dD/wAAAABJRU5ErkJggg==";
  }
  
  const buffer = await obj.arrayBuffer();
  const base64 = bufferToBase64(buffer);
  return `data:image/png;base64,${base64}`;
}
