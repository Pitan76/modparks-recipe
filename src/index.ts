import { Hono, type Context } from 'hono';
import { Env } from './utils/minecraft';
import { searchPage } from './utils/search/page';
import { pickLocale } from './utils/i18n/locale';
import { SEARCH_LOCALES } from './utils/i18n/search';
import { writeRoutes } from './routes/write';
import { ingestRoutes } from './routes/ingest';
import { imageRoutes } from './routes/images';
import { adminRoutes } from './routes/admin';
import { adminLimitRoutes } from './routes/admin-limits';
import { langRoutes } from './routes/lang';
import { listRoutes } from './routes/list';
import { migrateRoutes } from './routes/migrate';
import { authRoutes } from './routes/auth';
import { uploadRoutes } from './routes/upload';
import { previewRoutes } from './routes/preview';
import { assetRoutes } from './routes/asset';
import { gcRoutes } from './routes/gc';

const app = new Hono<{ Bindings: Env }>();

/** レシピ検索ページ。表示言語は `?lang=` か `Accept-Language` で決まります。 */
app.get('/', (c) => {
  const url = new URL(c.req.url);
  const locale = pickLocale(url, c.req.header('Accept-Language') ?? null, SEARCH_LOCALES);
  return c.html(searchPage(locale, url.origin));
});

// 書き込みAPI（レシピ/テクスチャ/モデル/タグ/言語ファイルのPUT、バンドルのPOST）— 認証が必要。
app.route('/', writeRoutes);
// 取り込みセッションAPI（begin/commit/abort）— 認証が必要。
app.route('/', ingestRoutes);
// ログインと namespace の所有権API。画像APIの `/api/:namespace/:filename` に
// `claim` や `owner.json` を拾われないよう、先に登録します。
app.route('/', authRoutes);
// 外部 jar のアップロード。`/api/upload` は namespace 付きのパスより先に登録します。
app.route('/', uploadRoutes);
app.route('/', previewRoutes);
app.route('/', assetRoutes);
// レシピ索引API（全体版とネームスペース版）。
// 画像APIの `/api/:namespace/:filename` が `/api/:namespace/list.json` を拾わないよう、先に登録します。
app.route('/', listRoutes);
// アイテム名API（言語ファイルの取得、アイテムIDの表示名解決）。同上の理由で画像APIより先に登録します。
app.route('/', langRoutes);
// 画像API（一括処理、スプライトシート、個別レシピ画像）。
app.route('/', imageRoutes);
// 管理用ユーティリティ（R2のクリーンアップ、インデックスの再構築）。
app.route('/', adminRoutes);
app.route('/', adminLimitRoutes);
// 既存のフラットなアセットを build へ移行する管理用API。
app.route('/', migrateRoutes);
app.route('/', gcRoutes);

import { serveStatic } from 'hono/cloudflare-workers';
// @ts-ignore
import manifest from '__STATIC_CONTENT_MANIFEST';

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.text(`Internal Server Error: ${err.message}\n${err.stack}`, 500);
});

const manifestObj = typeof manifest === 'string' ? JSON.parse(manifest) : manifest;
app.use('/*', serveStatic({ manifest: manifestObj, onFound: setStaticCache }));

/**
 * 静的ファイルのキャッシュ方針を決めます。
 *
 * 名前にハッシュを持つチャンクは中身が変われば別のURLになるので、永続させて構いません。
 * 一方で名前が固定のエントリJSは、古い版を抱えたまま消えたチャンクを指しに行かせないよう、
 * 毎回再検証させます（大半は 304 で返ります）。
 * @param path 見つかった静的ファイルのパス
 * @param c リクエストコンテキスト
 */
function setStaticCache(path: string, c: Context): void {
  if (!path.startsWith('app/')) return;
  const immutable = path.startsWith('app/chunk-');
  c.header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
}

export default app;
