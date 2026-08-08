/**
 * @fileoverview レシピ画像配信ルート定義。バッチレンダリング、スプライトシート生成、および個別レシピ画像のキャッシュ配信を行います。
 */

import { AssetSource } from '../utils/build/asset-source';
import { toChannel } from '../utils/build/mc-version';
import { Hono } from 'hono';
import { Env, getRecipe } from '../utils/minecraft';
import { renderRecipePng, renderRecipeGif, renderRecipeJpg, normalizeScale, renderRecipeSpriteSheet, MAX_GIF_FRAMES } from '../utils/image-generator';
import { imageCacheKey, deliveryVersion, imageVersion } from '../utils/image-cdn';
import { parseTagNamespaces } from '../core/tag-namespaces';
import { normalizeCrop, renderOptionsKey, type RenderOptions } from '../core/render-options';
import { renderBatch } from '../utils/batch-render';

export const imageRoutes = new Hono<{ Bindings: Env }>();

/**
 * 一括画像エンドポイント：Web UIがレシピごとに個別のHTTPリクエストを送信するのを防ぐため、1回のリクエストで複数のレシピ画像を取得します。
 * リクエストボディのJSON例:
 *   { "ids": ["stone_pickaxe", "furnace", ...],
 *     "ext": "png" | "jpg" | "gif",   // オプション、デフォルトは "png"
 *     "scale": 2, "tagOffset": 0 }    // オプション
 * レスポンス例: { images: { "<id>": "data:image/png;base64,..." | null }, missing: [...] }
 * IDsは単純な名前（URLの:namespaceを使用）または完全修飾名 "ns:id" のどちらでも指定可能です。
 */
imageRoutes.post('/api/:namespace/batch', async (c) => {
  const { namespace } = c.req.param();
  let payload: any;
  try { payload = await c.req.json(); } catch { return c.text('Invalid JSON', 400); }

  const ids: string[] = Array.isArray(payload.ids) ? payload.ids : [];
  if (ids.length === 0) return c.json({ images: {}, missing: [] });
  if (ids.length > 200) return c.text('Too many ids (max 200)', 400);

  const ext = String(payload.ext || 'png').toLowerCase();
  const scale = normalizeScale(payload.scale);
  const tagOffset = parseInt(String(payload.tagOffset ?? 0), 10) || 0;
  const options: RenderOptions = {
    tagNamespaces: parseTagNamespaces(payload.tagNs == null ? null : String(payload.tagNs)),
    crop: normalizeCrop(payload.crop),
  };

  const result = await renderBatch(c.env, namespace, ids, ext, scale, tagOffset, new AssetSource(c.env, requestedChannel(c)), options);
  return c.json(result, 200, { 'Cache-Control': 'public, max-age=86400' });
});

/**
 * バッチエンドポイントのキャッシュ可能なGET版。
 * レスポンス全体をCDNやブラウザのキャッシュに保存できるように、クエリパラメータ内でIDをカンマ区切りで指定します。
 * 例: GET /api/:namespace/batch?ids=stone_pickaxe,furnace&ext=png&scale=2
 */
imageRoutes.get('/api/:namespace/batch', async (c) => {
  const { namespace } = c.req.param();
  const ids = (c.req.query('ids') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return c.json({ images: {}, missing: [] });
  if (ids.length > 200) return c.text('Too many ids (max 200)', 400);

  const ext = String(c.req.query('ext') || 'png').toLowerCase();
  const scale = normalizeScale(c.req.query('scale'));
  const tagOffset = parseInt(c.req.query('tagOffset') || '0', 10) || 0;
  const options: RenderOptions = { tagNamespaces: parseTagNamespaces(c.req.query('tagNs')), crop: normalizeCrop(c.req.query('crop')) };

  const result = await renderBatch(c.env, namespace, ids, ext, scale, tagOffset, new AssetSource(c.env, requestedChannel(c)), options);
  return c.json(result, 200, { 'Cache-Control': 'public, max-age=86400' });
});

/**
 * キャッシュ可能なGET版（スプライトシート）：
 * 要求されたすべてのレシピを行優先（row-major）で並べた1つのPNGスプライトシートを返し、ブラウザが単一のキャッシュ可能な画像のみを取得するようにします。
 * 例: GET /api/:namespace/sprite?ids=stone_pickaxe,furnace&cols=8&scale=2
 * 各タイルのサイズは TILE_BASE_WIDTH x TILE_BASE_HEIGHT * (scale * 0.5) です。タイル i の切り出し位置は以下の通りです：
 *   col = i % cols, row = Math.floor(i / cols); x = col * tileW, y = row * tileH.
 * レイアウトのメタデータはレスポンスヘッダーで返されるため、クライアントは要求した順序でIDをタイルの位置にマッピングできます：
 *   X-Sprite-Columns, X-Sprite-Rows, X-Sprite-Count,
 *   X-Sprite-Tile-Width, X-Sprite-Tile-Height, X-Sprite-Missing (カンマ区切りリスト)
 */
imageRoutes.get('/api/:namespace/sprite', async (c) => {
  const { namespace } = c.req.param();
  const ids = (c.req.query('ids') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return c.text('No ids', 400);
  if (ids.length > 200) return c.text('Too many ids (max 200)', 400);

  const scale = normalizeScale(c.req.query('scale'));
  const cols = Math.max(1, Math.min(32, parseInt(c.req.query('cols') || '8', 10) || 8));
  const src = new AssetSource(c.env, requestedChannel(c));

  const entries = await Promise.all(
    ids.map(async (rawId) => {
      const fullId = rawId.includes(':') ? rawId : `${namespace}:${rawId}`;
      return { id: rawId, recipe: await getRecipe(fullId, c.env, src) };
    })
  );

  const sheet = await renderRecipeSpriteSheet(entries, c.env, cols, scale, src);

  return new Response(sheet.png, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
      'X-Sprite-Columns': String(sheet.columns),
      'X-Sprite-Rows': String(sheet.rows),
      'X-Sprite-Count': String(sheet.count),
      'X-Sprite-Tile-Width': String(sheet.tileWidth),
      'X-Sprite-Tile-Height': String(sheet.tileHeight),
      'X-Sprite-Missing': sheet.missing.join(','),
    },
  });
});

/**
 * リクエストの `?mc=` から、解決に使うMCチャネルを取り出します。
 *
 * 未指定なら各ネームスペースの最新チャネルへ落ちます。指定が壊れている場合も同じ扱いにします
 * （解釈できないバージョンで404を返すより、最新を見せた方が実害が小さい）。
 * @param c Honoのコンテキストオブジェクト
 */
function requestedChannel(c: any): string | null {
  return toChannel(c.req.query('mc') ?? '');
}

/** 存在しないレシピを再探索し続けないための 404 の保持期間（秒）。 */
const MISS_MAX_AGE = 300;

/**
 * アセットバージョンとして受け付ける形（`Date.now().toString(36)` が生む文字種）。
 *
 * `?v=` は R2 の永続キャッシュキーに入るため、素通しすると任意のキーで無認証に
 * オブジェクトを作らせられます。形が違えばピン留め無しとして扱い、サーバ側で引き直します。
 */
const VERSION_PATTERN = /^[0-9a-z]{1,16}$/;

/**
 * クライアントがピン留めしたアセットバージョンを取り出します。
 * @param c Honoのコンテキストオブジェクト
 * @returns 妥当なバージョン、無い/不正なら undefined
 */
function pinnedVersion(c: any): string | undefined {
  const v = c.req.query('v');
  if (!v || !VERSION_PATTERN.test(v)) return undefined;
  return v;
}

/**
 * 個別レシピ画像エンドポイント: /api/:namespace/:id.(png|gif|jpg)
 *
 * `?v=` にアセットバージョンが載っている場合（`/api/list.json` の versions を参照）、
 * URL 自体がバージョンを内包するため内容は不変になります。この場合バージョン参照のための
 * R2 往復（実測 約220ms）を省略し、`immutable` を付けてブラウザの再検証も止めます。
 * `?v=` が無い場合は従来どおりサーバ側でバージョンを引くフォールバック経路を通ります。
 *
 * `:filename{.+}` としてスラッシュも拾います。bulk 取り込みのレシピIDには `shaped/foo` の
 * ようにスラッシュが入りうるため、1セグメントだと索引に載っているのに画像だけ404になります。
 * 拡張子で絞るのは下の正規表現の役目です。
 */
imageRoutes.get('/api/:namespace/:filename{.+}', async (c) => {
  const { namespace, filename } = c.req.param();

  const match = filename.match(/^(.+)\.(png|gif|jpg|jpeg)$/);
  if (!match) {
    return c.text('Not found', 404);
  }

  const pinned = pinnedVersion(c);
  const src = new AssetSource(c.env, requestedChannel(c));
  // build を持つ ns では build ID が世代になる。内容ハッシュなので、同じ絵に別の世代が
  // 割り当たることも、違う内容が同じ世代を共有することも起きない。
  const version = pinned ?? (await imageVersion(c.env, src, namespace));

  // レシピのレンダリングには数回のR2往復通信とラスタライズのコストがかかります。また、出力はレシピやそのテクスチャが再アップロードされたときにのみ変更されます。
  // そのため、画像を再構築する代わりに、2回目以降のリクエストはエッジキャッシュから直接返します。
  const cache = caches.default;
  // `rv` はレンダラー版と共有ネームスペースを畳んだ値です。L1 のキーには入っているのにここで
  // 落とすと、`minecraft` 側の更新で新しい絵が出来ても、エッジは古い応答を返し続けます。
  const rv = await deliveryVersion(c.env);
  const cacheKey = buildCacheKey(c.req.url, pinned, version, rv);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const [, id, ext] = match;
  const tagOffset = parseInt(c.req.query('tagOffset') || '0', 10);
  const scale = normalizeScale(c.req.query('scale'));
  // `tagNs` はタグを絵に落とすときに使うアイテムのネームスペース（既定はバニラのみ、指定は追加、
  // `*` で全部）、`crop` は上下左右から削る余白のネイティブpx。どちらも絵そのものを変えるため、
  // L1 のキーに載せないと別指定の絵が混ざって返ります。
  const options: RenderOptions = {
    tagNamespaces: parseTagNamespaces(c.req.query('tagNs')),
    crop: normalizeCrop(c.req.query('crop')),
  };
  const cacheControl = pinned
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=86400';

  // L1: レンダリング済み画像。エッジキャッシュは PoP ローカルで容量圧迫時に消えるため、
  // PoP を跨ぐミスは従来フルレンダリング（R2 多往復 + ラスタライズ）をやり直していた。
  // R2 に永続化しておけば、そうしたミスは R2 GET 1回で済む。キーに ns バージョンと
  // レンダラー版を含むので、更新時は別キーになり古い画像は参照されなくなる。
  const contentType = contentTypeForExt(ext);
  const imgKey = imageCacheKey(rv, namespace, version, id, scale, tagOffset, ext, renderOptionsKey(options));
  const l1 = await c.env.BUCKET.get(imgKey);
  if (l1) {
    const res = new Response(l1.body, { headers: { 'Content-Type': contentType, 'Cache-Control': cacheControl } });
    c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  }

  const recipeData = await getRecipe(`${namespace}:${id}`, c.env, src);
  if (!recipeData) {
    // 404 もキャッシュする。壊れたリンクや古いIDは、そうしないと毎回 D1 と R2 を叩き続ける。
    const miss = new Response('Recipe not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': `public, max-age=${MISS_MAX_AGE}` },
    });
    c.executionCtx.waitUntil(cache.put(cacheKey, miss.clone()));
    return miss;
  }

  let body: Uint8Array;
  if (ext === 'gif') {
    body = await renderRecipeGif(recipeData, c.env, MAX_GIF_FRAMES, scale, src, options);
  } else if (ext === 'jpg' || ext === 'jpeg') {
    body = await renderRecipeJpg(recipeData, c.env, tagOffset, scale, src, options);
  } else {
    body = await renderRecipePng(recipeData, c.env, tagOffset, scale, src, options);
  }

  const response = new Response(body, {
    headers: { 'Content-Type': contentType, 'Cache-Control': cacheControl },
  });
  c.executionCtx.waitUntil(Promise.all([
    cache.put(cacheKey, response.clone()),
    c.env.BUCKET.put(imgKey, body, { httpMetadata: { contentType } }),
  ]));
  return response;
});

/** 拡張子から Content-Type を返します。 */
function contentTypeForExt(ext: string): string {
  if (ext === 'gif') return 'image/gif';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return 'image/png';
}

/**
 * キャッシュキーを組み立てます。
 *
 * L1 のキーと同じ2つの世代（ネームスペースのバージョンと `rv`）を必ず載せます。片方でも欠けると、
 * その欠けた側が動いたときにエッジだけが古い絵を返し続けます。`?v=` が付いていればバージョンは
 * URL が内包しているので足しません。
 * @param url リクエストURL
 * @param pinned クライアントが指定したバージョン（無ければ undefined）
 * @param version 実効バージョン
 * @param rv 実効のレンダラー版
 */
function buildCacheKey(url: string, pinned: string | undefined, version: string, rv: string): Request {
  const keyUrl = new URL(url);
  if (pinned === undefined) keyUrl.searchParams.set('__v', version);
  keyUrl.searchParams.set('__rv', rv);
  return new Request(keyUrl.toString(), { method: 'GET' });
}
