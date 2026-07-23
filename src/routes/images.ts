/**
 * @fileoverview レシピ画像配信ルート定義。バッチレンダリング、スプライトシート生成、および個別レシピ画像のキャッシュ配信を行います。
 */

import { Hono } from 'hono';
import { Env, getRecipe } from '../utils/minecraft';
import { renderRecipePng, renderRecipeGif, renderRecipeJpg, normalizeScale, renderRecipeSpriteSheet } from '../utils/image-generator';
import { bytesToBase64 } from '../utils/http';
import { getAssetVersion } from '../utils/cache-version';

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

/**
 * 個別レシピ画像エンドポイント: /api/:namespace/:id.(png|gif|jpg)
 */
imageRoutes.get('/api/:namespace/:filename', async (c) => {
  const { namespace, filename } = c.req.param();

  const match = filename.match(/^(.+)\.(png|gif|jpg|jpeg)$/);
  if (!match) {
    return c.text('Not found', 404);
  }

  // レシピのレンダリングには数回のR2往復通信とラスタライズのコストがかかります。また、出力はレシピやそのテクスチャが再アップロードされたときにのみ変更されます。
  // そのため、画像を再構築する代わりに、2回目以降のリクエストはエッジキャッシュから直接返します。
  // ネームスペースのアセットバージョンがキャッシュキーの一部に含まれているため、アップロードが行われると古いキャッシュエントリは自動的にアクセス不能（無効化）になり、古い画像が残り続けるのを防ぎます。
  const cache = caches.default;
  const version = await getAssetVersion(c.env, namespace);
  const keyUrl = new URL(c.req.url);
  keyUrl.searchParams.set('__v', version);
  const cacheKey = new Request(keyUrl.toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  const [, id, ext] = match;
  const tagOffset = parseInt(c.req.query('tagOffset') || '0', 10);
  const scale = normalizeScale(c.req.query('scale'));

  const recipeData = await getRecipe(`${namespace}:${id}`, c.env);
  if (!recipeData) {
    return c.text('Recipe not found', 404);
  }

  let body: Uint8Array;
  let contentType: string;
  if (ext === 'gif') {
    body = await renderRecipeGif(recipeData, c.env, 5, scale); // 5フレーム
    contentType = 'image/gif';
  } else if (ext === 'jpg' || ext === 'jpeg') {
    body = await renderRecipeJpg(recipeData, c.env, tagOffset, scale);
    contentType = 'image/jpeg';
  } else {
    body = await renderRecipePng(recipeData, c.env, tagOffset, scale);
    contentType = 'image/png';
  }

  const response = new Response(body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
    },
  });
  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
});
