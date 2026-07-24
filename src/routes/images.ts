/**
 * @fileoverview レシピ画像配信ルート定義。バッチレンダリング、スプライトシート生成、および個別レシピ画像のキャッシュ配信を行います。
 */

import { Hono } from 'hono';
import { Env, getRecipe } from '../utils/minecraft';
import { renderRecipePng, renderRecipeGif, renderRecipeJpg, normalizeScale, renderRecipeSpriteSheet } from '../utils/image-generator';
import { bytesToBase64 } from '../utils/http';
import { getAssetVersion } from '../utils/cache-version';
import { noteVersion } from '../utils/icon-memo';
import { rendererVersion } from '../utils/render-version';

export const imageRoutes = new Hono<{ Bindings: Env }>();

/**
 * 下記の POST/GET バッチエンドポイント用で共有される一括レンダラー。
 * 各IDを並行処理で base64 データURLにレンダリングします。存在しないIDは null になります。
 * @param env 環境変数
 * @param namespace ネームスペース（Mod ID など）
 * @param ids レシピIDのリスト
 * @param ext 拡張子（png, gif, jpg）
 * @param scale スケール倍率
 * @param tagOffset タグオフセット
 * @returns レンダリングされた画像データのマップと不足しているIDのリスト
 */
async function renderBatch(
  env: Env,
  namespace: string,
  ids: string[],
  ext: string,
  scale: number,
  tagOffset: number
): Promise<{ images: Record<string, string | null>; missing: string[] }> {
  let mime: string;
  let render: (recipe: any) => Promise<Uint8Array>;
  if (ext === 'gif') {
    mime = 'image/gif';
    render = (r) => renderRecipeGif(r, env, 5, scale);
  } else if (ext === 'jpg' || ext === 'jpeg') {
    mime = 'image/jpeg';
    render = (r) => renderRecipeJpg(r, env, tagOffset, scale);
  } else {
    mime = 'image/png';
    render = (r) => renderRecipePng(r, env, tagOffset, scale);
  }

  const images: Record<string, string | null> = {};
  const missing: string[] = [];
  await Promise.all(
    ids.map(async (rawId) => {
      const fullId = String(rawId).includes(':') ? String(rawId) : `${namespace}:${rawId}`;
      const recipe = await getRecipe(fullId, env);
      if (!recipe) {
        images[rawId] = null;
        missing.push(rawId);
        return;
      }
      const bytes = await render(recipe);
      images[rawId] = `data:${mime};base64,${bytesToBase64(bytes)}`;
    })
  );
  return { images, missing };
}

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

  const result = await renderBatch(c.env, namespace, ids, ext, scale, tagOffset);
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

  const result = await renderBatch(c.env, namespace, ids, ext, scale, tagOffset);
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

  const entries = await Promise.all(
    ids.map(async (rawId) => {
      const fullId = rawId.includes(':') ? rawId : `${namespace}:${rawId}`;
      return { id: rawId, recipe: await getRecipe(fullId, c.env) };
    })
  );

  const sheet = await renderRecipeSpriteSheet(entries, c.env, cols, scale);

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

/** 存在しないレシピを再探索し続けないための 404 の保持期間（秒）。 */
const MISS_MAX_AGE = 300;

/**
 * 個別レシピ画像エンドポイント: /api/:namespace/:id.(png|gif|jpg)
 *
 * `?v=` にアセットバージョンが載っている場合（`/api/list.json` の versions を参照）、
 * URL 自体がバージョンを内包するため内容は不変になります。この場合バージョン参照のための
 * R2 往復（実測 約220ms）を省略し、`immutable` を付けてブラウザの再検証も止めます。
 * `?v=` が無い場合は従来どおりサーバ側でバージョンを引くフォールバック経路を通ります。
 */
imageRoutes.get('/api/:namespace/:filename', async (c) => {
  const { namespace, filename } = c.req.param();

  const match = filename.match(/^(.+)\.(png|gif|jpg|jpeg)$/);
  if (!match) {
    return c.text('Not found', 404);
  }

  const pinned = c.req.query('v');
  const version = pinned ?? (await getAssetVersion(c.env, namespace));
  noteVersion(namespace, version);

  // レシピのレンダリングには数回のR2往復通信とラスタライズのコストがかかります。また、出力はレシピやそのテクスチャが再アップロードされたときにのみ変更されます。
  // そのため、画像を再構築する代わりに、2回目以降のリクエストはエッジキャッシュから直接返します。
  const cache = caches.default;
  const cacheKey = buildCacheKey(c.req.url, pinned, version);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const [, id, ext] = match;
  const tagOffset = parseInt(c.req.query('tagOffset') || '0', 10);
  const scale = normalizeScale(c.req.query('scale'));
  const cacheControl = pinned
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=86400';

  // L1: レンダリング済み画像。エッジキャッシュは PoP ローカルで容量圧迫時に消えるため、
  // PoP を跨ぐミスは従来フルレンダリング（R2 多往復 + ラスタライズ）をやり直していた。
  // R2 に永続化しておけば、そうしたミスは R2 GET 1回で済む。キーに ns バージョンと
  // レンダラー版を含むので、更新時は別キーになり古い画像は参照されなくなる。
  const contentType = contentTypeForExt(ext);
  const imgKey = `cache/img/${rendererVersion(c.env)}/${namespace}/${version}/${id}@${scale}+${tagOffset}.${ext}`;
  const l1 = await c.env.BUCKET.get(imgKey);
  if (l1) {
    const res = new Response(l1.body, { headers: { 'Content-Type': contentType, 'Cache-Control': cacheControl } });
    c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  }

  const recipeData = await getRecipe(`${namespace}:${id}`, c.env);
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
    body = await renderRecipeGif(recipeData, c.env, 5, scale); // 5フレーム
  } else if (ext === 'jpg' || ext === 'jpeg') {
    body = await renderRecipeJpg(recipeData, c.env, tagOffset, scale);
  } else {
    body = await renderRecipePng(recipeData, c.env, tagOffset, scale);
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
 * キャッシュキーを組み立てます。`?v=` が付いている場合は URL 自体が既にバージョンを内包するため
 * そのまま使い、無い場合のみサーバ側で引いたバージョンを `__v` として足します。
 * @param url リクエストURL
 * @param pinned クライアントが指定したバージョン（無ければ undefined）
 * @param version 実効バージョン
 */
function buildCacheKey(url: string, pinned: string | undefined, version: string): Request {
  if (pinned !== undefined) return new Request(url, { method: 'GET' });

  const keyUrl = new URL(url);
  keyUrl.searchParams.set('__v', version);
  return new Request(keyUrl.toString(), { method: 'GET' });
}
