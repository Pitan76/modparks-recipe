import { Hono } from 'hono';
import { Env } from '../utils/minecraft';
import { renderBlockIconPng, renderBlockIconSvg } from '../utils/block-icon';
import { bumpAssetVersion } from '../utils/cache-version';

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

// Read-only R2 listing, for debugging what was actually uploaded.
// GET /admin/ls?secret=...&prefix=assets/itemalchemy/&limit=200
adminRoutes.get('/admin/ls', async (c) => {
  const secret = c.req.query('secret');
  if (!c.env.ADMIN_SECRET || secret !== c.env.ADMIN_SECRET) {
    return c.text('Unauthorized', 401);
  }

  const prefix = c.req.query('prefix') || '';
  const limit = Math.min(Number(c.req.query('limit')) || 200, 1000);
  const listed = await c.env.BUCKET.list({ prefix, limit, cursor: c.req.query('cursor') });

  return c.json({
    prefix,
    truncated: listed.truncated,
    cursor: listed.truncated ? listed.cursor : null,
    count: listed.objects.length,
    objects: listed.objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded })),
  });
});

// Render a single block icon through the Worker's 3D path, bypassing the
// render3d/ cache. For checking a block's icon (or comparing against the
// offline pipeline's output) without touching stored objects.
// GET /admin/render3d/:namespace/:path?secret=...
adminRoutes.get('/admin/render3d/:namespace/:path{.+}', async (c) => {
  const secret = c.req.query('secret');
  if (!c.env.ADMIN_SECRET || secret !== c.env.ADMIN_SECRET) {
    return c.text('Unauthorized', 401);
  }

  const { namespace, path } = c.req.param();

  // ?format=svg returns the pre-rasterization SVG, for inspecting the geometry.
  if (c.req.query('format') === 'svg') {
    const svg = await renderBlockIconSvg(c.env, namespace, path);
    if (!svg) return c.text(`No renderable model for ${namespace}:${path}`, 404);
    return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } });
  }

  const png = await renderBlockIconPng(c.env, namespace, path);
  if (!png) return c.text(`No renderable model for ${namespace}:${path}`, 404);
  return new Response(png, { headers: { 'Content-Type': 'image/png' } });
});

// Drop everything cached for a namespace: the generated 3D block icons in R2 and
// every rendered image sitting in the edge cache. Use after a renderer change,
// or when icons look stale/wrong. Both rebuild automatically on next request.
// GET /admin/purge/:namespace?secret=...
adminRoutes.get('/admin/purge/:namespace', async (c) => {
  const secret = c.req.query('secret');
  if (!c.env.ADMIN_SECRET || secret !== c.env.ADMIN_SECRET) {
    return c.text('Unauthorized', 401);
  }

  const { namespace } = c.req.param();

  // Generated icons only — a pre-rendered PNG uploaded through the write API
  // lives here too, so this is deliberately scoped to one namespace.
  const prefix = `assets/${namespace}/textures/render3d/`;
  let icons = 0;
  let cursor: string | undefined = undefined;
  do {
    const listed = await c.env.BUCKET.list({ prefix, cursor });
    const keys = listed.objects.map((o) => o.key);
    if (keys.length > 0) {
      await c.env.BUCKET.delete(keys);
      icons += keys.length;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  // Bumping the version makes every cached image URL for this namespace
  // unreachable, whatever query variants they were stored under.
  await bumpAssetVersion(c.env, namespace);

  return c.json({ ok: true, namespace, iconsDeleted: icons, imageCacheInvalidated: true });
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
