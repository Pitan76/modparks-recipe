import { Hono } from 'hono';
import { Env } from './utils/minecraft';
import { searchPage } from './utils/page';
import { pickLocale } from './utils/i18n/locale';
import { SEARCH_LOCALES } from './utils/i18n/search';
import { writeRoutes } from './routes/write';
import { ingestRoutes } from './routes/ingest';
import { imageRoutes } from './routes/images';
import { adminRoutes } from './routes/admin';
import { langRoutes } from './routes/lang';
import { listRoutes } from './routes/list';
import { migrateRoutes } from './routes/migrate';
import { authRoutes } from './routes/auth';
import { uploadRoutes } from './routes/upload';
import { gcRoutes } from './routes/gc';

const app = new Hono<{ Bindings: Env }>();

/** レシピ検索ページ。表示言語は `?lang=` か `Accept-Language` で決まります。 */
app.get('/', (c) => {
  const locale = pickLocale(new URL(c.req.url), c.req.header('Accept-Language') ?? null, SEARCH_LOCALES);
  return c.html(searchPage(locale));
});

// 書き込みAPI（レシピ/テクスチャ/モデル/タグ/言語ファイルのPUT、バンドルのPOST）— 認証が必要。
app.route('/', writeRoutes);
// 取り込みセッションAPI（begin/commit/abort）— 認証が必要。
app.route('/', ingestRoutes);
// ログインと namespace の所有権API。画像APIの `/api/:namespace/:filename` に
// `claim` や `owner.json` を拾われないよう、先に登録します。
app.route('/', authRoutes);
// 外部 jar の投稿ポータル。`/api/upload` は namespace 付きのパスより先に登録します。
app.route('/', uploadRoutes);
// レシピ索引API（全体版とネームスペース版）。
// 画像APIの `/api/:namespace/:filename` が `/api/:namespace/list.json` を拾わないよう、先に登録します。
app.route('/', listRoutes);
// アイテム名API（言語ファイルの取得、アイテムIDの表示名解決）。同上の理由で画像APIより先に登録します。
app.route('/', langRoutes);
// 画像API（一括処理、スプライトシート、個別レシピ画像）。
app.route('/', imageRoutes);
// 管理用ユーティリティ（R2のクリーンアップ、インデックスの再構築）。
app.route('/', adminRoutes);
// 既存のフラットなアセットを build へ移行する管理用API。
app.route('/', migrateRoutes);
// 参照されなくなった build と blob の掃除。
app.route('/', gcRoutes);

export default app;
