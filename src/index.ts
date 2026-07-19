import { Hono } from 'hono';
import { Env, getRecipe, resultItemOf, isCraftingType } from './utils/minecraft';
import { renderRecipePng, renderRecipeGif, renderRecipeJpg, normalizeScale } from './utils/image-generator';
import { RECIPE_PAGE_HTML } from './utils/page';

const app = new Hono<{ Bindings: Env }>();

// ---- Write API helpers -------------------------------------------------------

/** Bearer token (Authorization header) or ?secret= must match UPLOAD_SECRET (or ADMIN_SECRET). */
function authorized(c: any): boolean {
  const header = c.req.header('Authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '') || c.req.query('secret') || '';
  const expected = c.env.UPLOAD_SECRET || c.env.ADMIN_SECRET;
  return !!expected && token === expected;
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function contentTypeForKey(key: string): string {
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.json')) return 'application/json';
  if (key.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
}

/** Store a recipe JSON in R2, drop its stale D1 cache row, and update the index. */
async function storeRecipe(env: Env, namespace: string, id: string, body: string, data: any): Promise<void> {
  await env.BUCKET.put(`data/${namespace}/recipe/${id}.json`, body, {
    httpMetadata: { contentType: 'application/json' },
  });
  await env.DB.prepare('DELETE FROM recipes WHERE id = ?').bind(`${namespace}:${id}`).run().catch(() => {});
  await updateIndex(env, `${namespace}:${id}`, data);
}

/** Upsert one recipe into index/recipes.json (kept crafting-only, like the CI build). */
async function updateIndex(env: Env, fullId: string, data: any): Promise<void> {
  const obj = await env.BUCKET.get('index/recipes.json');
  const idx: any = obj ? await obj.json() : {};
  let recipes: any[] = Array.isArray(idx.recipes)
    ? idx.recipes
    : Array.isArray(idx.ids)
      ? idx.ids.map((i: string) => ({ id: i, result: i }))
      : [];
  recipes = recipes.filter((r) => r.id !== fullId);
  if (isCraftingType(data?.type)) {
    recipes.push({ id: fullId, result: resultItemOf(data), type: String(data.type).replace(/^minecraft:/, '') });
  }
  recipes.sort((a, b) => a.id.localeCompare(b.id));
  await env.BUCKET.put(
    'index/recipes.json',
    JSON.stringify({ count: recipes.length, generatedAt: new Date().toISOString(), recipes }),
    { httpMetadata: { contentType: 'application/json' } }
  );
}

// Recipe lookup page
app.get('/', (c) => {
  return c.html(RECIPE_PAGE_HTML);
});

// Browsable recipe index (generated once by the CI pipeline; just streamed
// back from R2 with a long cache, so it adds no per-request scanning load).
app.get('/api/list.json', async (c) => {
  const obj = await c.env.BUCKET.get('index/recipes.json');
  if (!obj) {
    return c.json({ count: 0, ids: [] });
  }
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
});

// ---- Write API (authenticated) ----------------------------------------------
// Lets mods push their own recipes/textures instead of relying on the vanilla
// jar pipeline. Auth: Authorization: Bearer <secret> or ?secret=.

// Upload a single recipe JSON. Body = the recipe JSON.
app.put('/api/:namespace/recipe/:id', async (c) => {
  if (!authorized(c)) return c.text('Unauthorized', 401);
  const { namespace, id } = c.req.param();
  const body = await c.req.text();
  let data: any;
  try { data = JSON.parse(body); } catch { return c.text('Invalid JSON', 400); }
  await storeRecipe(c.env, namespace, id, body, data);
  return c.json({ ok: true, id: `${namespace}:${id}` });
});

// Upload a texture (or any asset) under assets/<ns>/textures/<path>.
// e.g. PUT /api/mymod/texture/item/gadget.png  (body = PNG bytes)
app.put('/api/:namespace/texture/:path{.+}', async (c) => {
  if (!authorized(c)) return c.text('Unauthorized', 401);
  const { namespace, path } = c.req.param();
  const key = `assets/${namespace}/textures/${path}`;
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  await c.env.BUCKET.put(key, bytes, { httpMetadata: { contentType: contentTypeForKey(key) } });
  return c.json({ ok: true, key });
});

// Upload a tag JSON under data/<ns>/tags/<path>.json (path e.g. "item/planks").
app.put('/api/:namespace/tag/:path{.+}', async (c) => {
  if (!authorized(c)) return c.text('Unauthorized', 401);
  const { namespace, path } = c.req.param();
  const body = await c.req.text();
  try { JSON.parse(body); } catch { return c.text('Invalid JSON', 400); }
  const id = path.replace(/\.json$/, '');
  await c.env.BUCKET.put(`data/${namespace}/tags/${id}.json`, body, {
    httpMetadata: { contentType: 'application/json' },
  });
  await c.env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(`${namespace}:${id}`).run().catch(() => {});
  return c.json({ ok: true, id: `${namespace}:${id}` });
});

// Recipe-level bundle: one call with the recipe plus its textures (and optional
// pre-rendered 3D PNGs). Body JSON:
// { "recipe": {...}, "textures": { "item/foo.png": "<base64>", ... } }
// Texture keys are paths under assets/<ns>/textures/ (e.g. "item/foo.png",
// "block/bar.png", or "render3d/baz.png" for a pre-rendered 3D icon).
app.post('/api/:namespace/recipe/:id/bundle', async (c) => {
  if (!authorized(c)) return c.text('Unauthorized', 401);
  const { namespace, id } = c.req.param();
  let payload: any;
  try { payload = await c.req.json(); } catch { return c.text('Invalid JSON', 400); }

  let recipeStored = false;
  if (payload.recipe) {
    await storeRecipe(c.env, namespace, id, JSON.stringify(payload.recipe), payload.recipe);
    recipeStored = true;
  }

  let textureCount = 0;
  for (const [texPath, b64] of Object.entries(payload.textures || {})) {
    const key = `assets/${namespace}/textures/${texPath}`;
    await c.env.BUCKET.put(key, decodeBase64(b64 as string), {
      httpMetadata: { contentType: contentTypeForKey(key) },
    });
    textureCount++;
  }

  return c.json({ ok: true, id: `${namespace}:${id}`, recipeStored, textureCount });
});

// Single recipe image endpoint: /api/:namespace/:id.(png|gif|jpg)
app.get('/api/:namespace/:filename', async (c) => {
  const { namespace, filename } = c.req.param();

  const match = filename.match(/^(.+)\.(png|gif|jpg|jpeg)$/);
  if (!match) {
    return c.text('Not found', 404);
  }
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

  return new Response(body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
    },
  });
});

// Admin endpoint to clean up old garbage files in R2 (e.g. before re-uploading)
app.get('/admin/clean/:namespace/:folder', async (c) => {
  const secret = c.req.query('secret');
  if (!c.env.ADMIN_SECRET || secret !== c.env.ADMIN_SECRET) {
    return c.text('Unauthorized', 401);
  }

  const { namespace, folder } = c.req.param();
  const prefix = `assets/${namespace}/textures/${folder}/`;
  
  let count = 0;
  let cursor: string | undefined = undefined;
  do {
    const listed = await c.env.BUCKET.list({ prefix, cursor });
    const keys = listed.objects.map(o => o.key);
    if (keys.length > 0) {
      await c.env.BUCKET.delete(keys);
      count += keys.length;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  
  return c.text(`Deleted ${count} old objects from ${prefix}`);
});

// Admin endpoint to (re)build the recipe index from the recipe JSON already in
// R2. Runs on demand (one bucket scan), so the public /api/list.json stays a
// cheap static read. Use this to backfill the index without waiting for CI.
app.get('/admin/reindex', async (c) => {
  const secret = c.req.query('secret');
  if (!c.env.ADMIN_SECRET || secret !== c.env.ADMIN_SECRET) {
    return c.text('Unauthorized', 401);
  }

  const ids: string[] = [];
  let cursor: string | undefined = undefined;
  do {
    const listed = await c.env.BUCKET.list({ prefix: 'data/', cursor, limit: 1000 });
    for (const o of listed.objects) {
      const m = o.key.match(/^data\/([^/]+)\/recipes?\/(.+)\.json$/);
      if (m) ids.push(`${m[1]}:${m[2]}`);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  ids.sort();
  const index = { count: ids.length, generatedAt: new Date().toISOString(), ids };
  await c.env.BUCKET.put('index/recipes.json', JSON.stringify(index), {
    httpMetadata: { contentType: 'application/json' },
  });

  return c.json({ ok: true, count: ids.length });
});

export default app;
