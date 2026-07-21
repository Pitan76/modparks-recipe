import { Hono } from 'hono';
import { Env } from './utils/minecraft';
import { RECIPE_PAGE_HTML } from './utils/page';
import { writeRoutes } from './routes/write';
import { imageRoutes } from './routes/images';
import { adminRoutes } from './routes/admin';

const app = new Hono<{ Bindings: Env }>();

/** レシピ検索ページ。 */
app.get('/', (c) => {
  return c.html(RECIPE_PAGE_HTML);
});

/**
 * 閲覧可能なレシピインデックスを取得します。
 * CIパイプラインによって一度だけ生成され、R2から長いキャッシュを伴ってストリーミングされるため、
 * リクエストごとのスキャン負荷は発生しません。
 */
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

// 書き込みAPI（レシピ/テクスチャ/モデル/タグのPUT、バンドルのPOST）— 認証が必要。
app.route('/', writeRoutes);
// 画像API（一括処理、スプライトシート、個別レシピ画像）。
app.route('/', imageRoutes);
// 管理用ユーティリティ（R2のクリーンアップ、インデックスの再構築）。
app.route('/', adminRoutes);

export default app;
