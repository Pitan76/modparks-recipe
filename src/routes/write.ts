import { Hono } from 'hono';
import { Env } from '../utils/minecraft';
import { authorized, decodeBase64, contentTypeForKey } from '../utils/http';
import { storeRecipe, putRecipeBody, updateIndexMany } from '../utils/recipe-store';

// ---- Write API (authenticated) ----------------------------------------------
// Lets mods push their own recipes/textures instead of relying on the vanilla
// jar pipeline. Auth: Authorization: Bearer <secret> or ?secret=.

export const writeRoutes = new Hono<{ Bindings: Env }>();

/**
 * Run tasks with bounded concurrency. Bulk ingests put hundreds of objects in
 * one request; doing that sequentially spends the whole request budget waiting
 * on round trips and times the Worker out.
 */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await worker(items[i++]);
    })
  );
}

// Upload a single recipe JSON. Body = the recipe JSON.
writeRoutes.put('/api/:namespace/recipe/:id', async (c) => {
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
writeRoutes.put('/api/:namespace/texture/:path{.+}', async (c) => {
  if (!authorized(c)) return c.text('Unauthorized', 401);
  const { namespace, path } = c.req.param();
  const key = `assets/${namespace}/textures/${path}`;
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  await c.env.BUCKET.put(key, bytes, { httpMetadata: { contentType: contentTypeForKey(key) } });
  return c.json({ ok: true, key });
});

// Upload a model JSON under assets/<ns>/models/<path>.json (path e.g. "item/gadget"
// or "block/machine"). Lets the renderer resolve items whose texture filename
// differs from their id by following the model's textures/parent chain.
writeRoutes.put('/api/:namespace/model/:path{.+}', async (c) => {
  if (!authorized(c)) return c.text('Unauthorized', 401);
  const { namespace, path } = c.req.param();
  const body = await c.req.text();
  try { JSON.parse(body); } catch { return c.text('Invalid JSON', 400); }
  const id = path.replace(/\.json$/, '');
  await c.env.BUCKET.put(`assets/${namespace}/models/${id}.json`, body, {
    httpMetadata: { contentType: 'application/json' },
  });
  return c.json({ ok: true, key: `assets/${namespace}/models/${id}.json` });
});

// Upload a tag JSON under data/<ns>/tags/<path>.json (path e.g. "item/planks").
writeRoutes.put('/api/:namespace/tag/:path{.+}', async (c) => {
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
writeRoutes.post('/api/:namespace/recipe/:id/bundle', async (c) => {
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

  // Optional model JSONs so items whose texture filename != id can be resolved.
  // Keys are paths under assets/<ns>/models/ (e.g. "item/gadget.json"); values
  // are the model JSON as a string or object.
  let modelCount = 0;
  for (const [modelPath, val] of Object.entries(payload.models || {})) {
    const rel = modelPath.replace(/\.json$/, '');
    const json = typeof val === 'string' ? val : JSON.stringify(val);
    await c.env.BUCKET.put(`assets/${namespace}/models/${rel}.json`, json, {
      httpMetadata: { contentType: 'application/json' },
    });
    modelCount++;
  }

  return c.json({ ok: true, id: `${namespace}:${id}`, recipeStored, textureCount, modelCount });
});

// Bulk ingest: one request carrying many recipes/tags/textures/models for a
// namespace. Lets the extractor push a whole mod in a handful of calls instead
// of ~1 subrequest per file, which otherwise blows the caller's subrequest
// limit (recipes upload first, so all assets end up in the dropped tail).
// Body JSON (all optional):
//   { "recipes": { "<id>": <json|string>, ... },   // id may contain slashes
//     "tags":    { "<path>": <json|string>, ... },  // e.g. "item/planks"
//     "textures":{ "<path>": "<base64>", ... },     // e.g. "item/foo.png"
//     "models":  { "<path>": <json|string>, ... } } // e.g. "item/foo"
writeRoutes.post('/api/:namespace/bulk', async (c) => {
  if (!authorized(c)) return c.text('Unauthorized', 401);
  const { namespace } = c.req.param();
  let p: any;
  try { p = await c.req.json(); } catch { return c.text('Invalid JSON', 400); }

  const indexEntries: { fullId: string; data: any }[] = [];
  let recipes = 0, tags = 0, textures = 0, models = 0;

  for (const [id, val] of Object.entries(p.recipes || {})) {
    const body = typeof val === 'string' ? val : JSON.stringify(val);
    let data: any;
    try { data = JSON.parse(body); } catch { continue; }
    await putRecipeBody(c.env, namespace, id, body);
    indexEntries.push({ fullId: `${namespace}:${id}`, data });
    recipes++;
  }
  await updateIndexMany(c.env, indexEntries);

  for (const [path, val] of Object.entries(p.tags || {})) {
    const body = typeof val === 'string' ? val : JSON.stringify(val);
    try { JSON.parse(body); } catch { continue; }
    const id = path.replace(/\.json$/, '');
    await c.env.BUCKET.put(`data/${namespace}/tags/${id}.json`, body, {
      httpMetadata: { contentType: 'application/json' },
    });
    await c.env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(`${namespace}:${id}`).run().catch(() => {});
    tags++;
  }

  for (const [path, b64] of Object.entries(p.textures || {})) {
    const key = `assets/${namespace}/textures/${path}`;
    await c.env.BUCKET.put(key, decodeBase64(b64 as string), {
      httpMetadata: { contentType: contentTypeForKey(key) },
    });
    textures++;
  }

  await runPool(Object.entries(p.models || {}), 20, async ([path, val]) => {
    const rel = (path as string).replace(/\.json$/, '');
    const json = typeof val === 'string' ? val : JSON.stringify(val);
    await c.env.BUCKET.put(`assets/${namespace}/models/${rel}.json`, json, {
      httpMetadata: { contentType: 'application/json' },
    });
    models++;
  });

  return c.json({ ok: true, namespace, recipes, tags, textures, models });
});
