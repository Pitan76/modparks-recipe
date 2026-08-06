/**
 * @fileoverview 生アセットの読み取り専用配信。
 *
 * ブラウザ側でレシピを組み立てる経路のためのものです。Mod の jar は自分の分しか持たないため、
 * `minecraft:` のテクスチャやモデル、`c:` のタグは手元に無く、ここから引く必要があります。
 *
 * 書き込みはできません。読み出しは既存の解決規則（build 経由 / 従来のフラット配置）にそのまま乗せます。
 */

import { Hono } from 'hono';
import { Env } from '../utils/minecraft';
import { AssetSource } from '../utils/build/asset-source';
import { isValidNamespace, isSafePath } from '../utils/asset-path';
import { contentTypeForKey } from '../utils/http';
import { toChannel } from '../utils/build/mc-version';

export const assetRoutes = new Hono<{ Bindings: Env }>();

/** 読み出しを許す論理パスの接頭辞。レシピ描画に要るものだけを開けます。 */
const ALLOWED_ROOTS = ['textures/', 'models/', 'tags/', 'lang/'];

// 論理パスで生アセットを返します。
// 例: GET /api/minecraft/asset/textures/item/apple.png
assetRoutes.get('/api/:namespace/asset/:path{.+}', async (c) => {
  const { namespace, path } = c.req.param();
  if (!isValidNamespace(namespace) || !isSafePath(path)) return c.text('Invalid namespace or path', 400);
  if (!ALLOWED_ROOTS.some((root) => path.startsWith(root))) return c.text('Not found', 404);

  const src = new AssetSource(c.env, toChannel(c.req.query('mc') ?? ''));
  const obj = await src.get(namespace, path);
  // 404 もキャッシュします。素材の探索は空振りが多く、その都度オリジンまで来ると無駄が大きいためです。
  if (!obj) return c.text('Not found', 404, { 'Cache-Control': 'public, max-age=3600' });

  return new Response(obj.body, {
    headers: {
      'Content-Type': contentTypeForKey(path),
      // 内容が変わればバージョン付きのURLで来るため、長めに持たせます。
      'Cache-Control': 'public, max-age=86400',
    },
  });
});
