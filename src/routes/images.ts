import { Hono } from 'hono';
import { Env, getRecipe } from '../utils/minecraft';
import { renderRecipePng, renderRecipeGif, renderRecipeJpg, normalizeScale, renderRecipeSpriteSheet } from '../utils/image-generator';
import { bytesToBase64 } from '../utils/http';
import { getAssetVersion } from '../utils/cache-version';

export const imageRoutes = new Hono<{ Bindings: Env }>();

// Shared batch renderer for the POST/GET batch endpoints below. Renders each id
// to a base64 data URL, running all ids in parallel. Missing ids -> null.
async function renderBatch(
  env: Env,
  namespace: string,
  ids: string[],
  ext: string,
  scale: number,
  tagOffset: number
): Promise<{ images: Record<string, string | null>; missing: string[] }> {
  let mime: string;
  let render: (recipe: any) => Promise<Uint8Array>;
  if (ext === 'gif') {
    mime = 'image/gif';
    render = (r) => renderRecipeGif(r, env, 5, scale);
  } else if (ext === 'jpg' || ext === 'jpeg') {
    mime = 'image/jpeg';
    render = (r) => renderRecipeJpg(r, env, tagOffset, scale);
  } else {
    mime = 'image/png';
    render = (r) => renderRecipePng(r, env, tagOffset, scale);
  }

  const images: Record<string, string | null> = {};
  const missing: string[] = [];
  await Promise.all(
    ids.map(async (rawId) => {
      const fullId = String(rawId).includes(':') ? String(rawId) : `${namespace}:${rawId}`;
      const recipe = await getRecipe(fullId, env);
      if (!recipe) {
        images[rawId] = null;
        missing.push(rawId);
        return;
      }
      const bytes = await render(recipe);
      images[rawId] = `data:${mime};base64,${bytesToBase64(bytes)}`;
    })
  );
  return { images, missing };
}

// Batch image endpoint: fetch many recipe images in one request so the web UI
// doesn't fire one HTTP request per recipe. Body JSON:
//   { "ids": ["stone_pickaxe", "furnace", ...],
//     "ext": "png" | "jpg" | "gif",   // optional, default "png"
//     "scale": 2, "tagOffset": 0 }    // optional
// Response: { images: { "<id>": "data:image/png;base64,..." | null }, missing: [...] }
// ids may be bare (use the URL :namespace) or fully-qualified "ns:id".
imageRoutes.post('/api/:namespace/batch', async (c) => {
  const { namespace } = c.req.param();
  let payload: any;
  try { payload = await c.req.json(); } catch { return c.text('Invalid JSON', 400); }

  const ids: string[] = Array.isArray(payload.ids) ? payload.ids : [];
  if (ids.length === 0) return c.json({ images: {}, missing: [] });
  if (ids.length > 200) return c.text('Too many ids (max 200)', 400);

  const ext = String(payload.ext || 'png').toLowerCase();
  const scale = normalizeScale(payload.scale);
  const tagOffset = parseInt(String(payload.tagOffset ?? 0), 10) || 0;

  const result = await renderBatch(c.env, namespace, ids, ext, scale, tagOffset);
  return c.json(result, 200, { 'Cache-Control': 'public, max-age=86400' });
});

// Cacheable GET variant of the batch endpoint. ids are comma-separated in the
// query so the whole response can sit in the CDN/browser cache.
//   GET /api/:namespace/batch?ids=stone_pickaxe,furnace&ext=png&scale=2
imageRoutes.get('/api/:namespace/batch', async (c) => {
  const { namespace } = c.req.param();
  const ids = (c.req.query('ids') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return c.json({ images: {}, missing: [] });
  if (ids.length > 200) return c.text('Too many ids (max 200)', 400);

  const ext = String(c.req.query('ext') || 'png').toLowerCase();
  const scale = normalizeScale(c.req.query('scale'));
  const tagOffset = parseInt(c.req.query('tagOffset') || '0', 10) || 0;

  const result = await renderBatch(c.env, namespace, ids, ext, scale, tagOffset);
  return c.json(result, 200, { 'Cache-Control': 'public, max-age=86400' });
});

// Cacheable GET variant: returns ONE PNG sprite sheet with all requested
// recipes tiled row-major, so the browser fetches a single cacheable image.
//   GET /api/:namespace/sprite?ids=stone_pickaxe,furnace&cols=8&scale=2
// Tiles are TILE_BASE_WIDTH x TILE_BASE_HEIGHT * scale. Slice tile i by:
//   col = i % cols, row = floor(i / cols); x = col*tileW, y = row*tileH.
// Layout metadata is returned in response headers so the client can map ids
// (given in the same order) to tile positions:
//   X-Sprite-Columns, X-Sprite-Rows, X-Sprite-Count,
//   X-Sprite-Tile-Width, X-Sprite-Tile-Height, X-Sprite-Missing (comma list)
imageRoutes.get('/api/:namespace/sprite', async (c) => {
  const { namespace } = c.req.param();
  const ids = (c.req.query('ids') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return c.text('No ids', 400);
  if (ids.length > 200) return c.text('Too many ids (max 200)', 400);

  const scale = normalizeScale(c.req.query('scale'));
  const cols = Math.max(1, Math.min(32, parseInt(c.req.query('cols') || '8', 10) || 8));

  const entries = await Promise.all(
    ids.map(async (rawId) => {
      const fullId = rawId.includes(':') ? rawId : `${namespace}:${rawId}`;
      return { id: rawId, recipe: await getRecipe(fullId, c.env) };
    })
  );

  const sheet = await renderRecipeSpriteSheet(entries, c.env, cols, scale);

  return new Response(sheet.png, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
      'X-Sprite-Columns': String(sheet.columns),
      'X-Sprite-Rows': String(sheet.rows),
      'X-Sprite-Count': String(sheet.count),
      'X-Sprite-Tile-Width': String(sheet.tileWidth),
      'X-Sprite-Tile-Height': String(sheet.tileHeight),
      'X-Sprite-Missing': sheet.missing.join(','),
    },
  });
});

// Single recipe image endpoint: /api/:namespace/:id.(png|gif|jpg)
imageRoutes.get('/api/:namespace/:filename', async (c) => {
  const { namespace, filename } = c.req.param();

  const match = filename.match(/^(.+)\.(png|gif|jpg|jpeg)$/);
  if (!match) {
    return c.text('Not found', 404);
  }

  // Rendering a recipe costs several R2 round trips plus rasterization, and the
  // output only changes when the recipe or its textures are re-uploaded. Serve
  // repeats straight from the edge cache instead of rebuilding the image. The
  // namespace's asset version is part of the key, so an upload makes the old
  // entries unreachable rather than leaving stale images up for a day.
  const cache = caches.default;
  const version = await getAssetVersion(c.env, namespace);
  const keyUrl = new URL(c.req.url);
  keyUrl.searchParams.set('__v', version);
  const cacheKey = new Request(keyUrl.toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  const [, id, ext] = match;
  const tagOffset = parseInt(c.req.query('tagOffset') || '0', 10);
  const scale = normalizeScale(c.req.query('scale'));

  const recipeData = await getRecipe(`${namespace}:${id}`, c.env);
  if (!recipeData) {
    return c.text('Recipe not found', 404);
  }

  let body: Uint8Array;
  let contentType: string;
  if (ext === 'gif') {
    body = await renderRecipeGif(recipeData, c.env, 5, scale); // 5 frames
    contentType = 'image/gif';
  } else if (ext === 'jpg' || ext === 'jpeg') {
    body = await renderRecipeJpg(recipeData, c.env, tagOffset, scale);
    contentType = 'image/jpeg';
  } else {
    body = await renderRecipePng(recipeData, c.env, tagOffset, scale);
    contentType = 'image/png';
  }

  const response = new Response(body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
    },
  });
  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
});
