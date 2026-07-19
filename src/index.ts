import { Hono } from 'hono';
import { Env } from './utils/minecraft';
import { RECIPE_PAGE_HTML } from './utils/page';
import { writeRoutes } from './routes/write';
import { imageRoutes } from './routes/images';
import { adminRoutes } from './routes/admin';

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

// Write API (PUT recipe/texture/model/tag, POST bundle) — authenticated.
app.route('/', writeRoutes);
// Image API (batch, sprite sheet, single recipe image).
app.route('/', imageRoutes);
// Admin utilities (R2 cleanup, index rebuild).
app.route('/', adminRoutes);

export default app;
