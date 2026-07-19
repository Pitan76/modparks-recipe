import { Hono } from 'hono';
import { Env } from '../utils/minecraft';

export const adminRoutes = new Hono<{ Bindings: Env }>();

// Admin endpoint to clean up old garbage files in R2 (e.g. before re-uploading)
adminRoutes.get('/admin/clean/:namespace/:folder', async (c) => {
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
adminRoutes.get('/admin/reindex', async (c) => {
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
