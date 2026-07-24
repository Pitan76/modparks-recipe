import { Hono } from 'hono';
import { Env } from './utils/minecraft';
import { RECIPE_PAGE_HTML } from './utils/page';
import { writeRoutes } from './routes/write';
import { imageRoutes } from './routes/images';
import { adminRoutes } from './routes/admin';
import { getAllVersions } from './utils/cache-version';

const app = new Hono<{ Bindings: Env }>();

/** レシピ検索ページ。 */
app.get('/', (c) => {
  return c.html(RECIPE_PAGE_HTML);
});

/**
 * 閲覧可能なレシピインデックスを取得します。
 * CIパイプラインによって一度だけ生成され、R2から長いキャッシュを伴って読み出されるため、
 * リクエストごとのスキャン負荷は発生しません。
 *
 * ネームスペースごとのアセットバージョンを `versions` として同梱します。クライアントはこれを
 * 画像URLの `?v=` に載せることで、画像1枚ごとのバージョン参照（R2 往復 約220ms）を消せます。
 * インデックスとバージョンは並列に読むため、この同梱による遅延の増加はありません。
 */
app.get('/api/list.json', async (c) => {
  const [obj, versions] = await Promise.all([
    c.env.BUCKET.get('index/recipes.json'),
    getAllVersions(c.env),
  ]);
  if (!obj) {
    return c.json({ count: 0, versions, recipes: [] });
  }

  const index = await obj.json<Record<string, unknown>>();
  return c.json({ ...index, versions }, 200, {
    // versions が変わると画像URLも変わるため、ここが古いと新しい画像に切り替わらない。
    // 短めにしてクライアント側の revalidate(60秒) と歩調を合わせる。
    'Cache-Control': 'public, max-age=60',
  });
});

// 書き込みAPI（レシピ/テクスチャ/モデル/タグのPUT、バンドルのPOST）— 認証が必要。
app.route('/', writeRoutes);
// 画像API（一括処理、スプライトシート、個別レシピ画像）。
app.route('/', imageRoutes);
// 管理用ユーティリティ（R2のクリーンアップ、インデックスの再構築）。
app.route('/', adminRoutes);

export default app;
