import { Hono } from 'hono';
import { Env, getRecipe } from './utils/minecraft';
import { renderRecipePng, renderRecipeGif, renderRecipeJpg } from './utils/image-generator';
import { RECIPE_PAGE_HTML } from './utils/page';

const app = new Hono<{ Bindings: Env }>();

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

// Single recipe image endpoint: /api/:namespace/:id.(png|gif|jpg)
app.get('/api/:namespace/:filename', async (c) => {
  const { namespace, filename } = c.req.param();

  const match = filename.match(/^(.+)\.(png|gif|jpg|jpeg)$/);
  if (!match) {
    return c.text('Not found', 404);
  }
  const [, id, ext] = match;
  const tagOffset = parseInt(c.req.query('tagOffset') || '0', 10);

  const recipeData = await getRecipe(`${namespace}:${id}`, c.env);
  if (!recipeData) {
    return c.text('Recipe not found', 404);
  }

  let body: Uint8Array;
  let contentType: string;
  if (ext === 'gif') {
    body = await renderRecipeGif(recipeData, c.env, 5); // 5 frames
    contentType = 'image/gif';
  } else if (ext === 'jpg' || ext === 'jpeg') {
    body = await renderRecipeJpg(recipeData, c.env, tagOffset);
    contentType = 'image/jpeg';
  } else {
    body = await renderRecipePng(recipeData, c.env, tagOffset);
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
