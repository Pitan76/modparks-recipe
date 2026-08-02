import { Hono } from 'hono';
import { Env } from './utils/minecraft';
import { RECIPE_PAGE_HTML } from './utils/page';
import { writeRoutes } from './routes/write';
import { ingestRoutes } from './routes/ingest';
import { imageRoutes } from './routes/images';
import { adminRoutes } from './routes/admin';
import { langRoutes } from './routes/lang';
import { listRoutes } from './routes/list';

const app = new Hono<{ Bindings: Env }>();

/** レシピ検索ページ。 */
app.get('/', (c) => {
  return c.html(RECIPE_PAGE_HTML);
});

// 書き込みAPI（レシピ/テクスチャ/モデル/タグ/言語ファイルのPUT、バンドルのPOST）— 認証が必要。
app.route('/', writeRoutes);
// 取り込みセッションAPI（begin/commit/abort）— 認証が必要。
app.route('/', ingestRoutes);
// レシピ索引API（全体版とネームスペース版）。
// 画像APIの `/api/:namespace/:filename` が `/api/:namespace/list.json` を拾わないよう、先に登録します。
app.route('/', listRoutes);
// アイテム名API（言語ファイルの取得、アイテムIDの表示名解決）。同上の理由で画像APIより先に登録します。
app.route('/', langRoutes);
// 画像API（一括処理、スプライトシート、個別レシピ画像）。
app.route('/', imageRoutes);
// 管理用ユーティリティ（R2のクリーンアップ、インデックスの再構築）。
app.route('/', adminRoutes);

export default app;
