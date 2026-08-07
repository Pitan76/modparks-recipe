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
import { runPool } from '../utils/pool';
import { toChannel } from '../utils/build/mc-version';
import { ASSET_KINDS } from '../core/paths';

export const assetRoutes = new Hono<{ Bindings: Env }>();

/** 読み出しを許す論理パスの接頭辞。レシピ描画に要るものだけを開けます。 */
const ALLOWED_ROOTS = ASSET_KINDS.filter((spec) => spec.publiclyReadable).map((spec) => `${spec.root}/`);

// 論理パスで生アセットを返します。
// 例: GET /api/minecraft/asset/textures/item/apple.png
assetRoutes.get('/api/:namespace/asset/:path{.+}', async (c) => {
  const { namespace, path } = c.req.param();
  if (!isValidNamespace(namespace) || !isSafePath(path)) return c.text('Invalid namespace or path', 400);
  if (!allowed(path)) return c.text('Not found', 404);

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

/** 1回で解決できる論理パスの数の上限。 */
const MAX_RESOLVE = 500;

/**
 * 論理パスの在り処（R2のオブジェクトキー）をまとめて返します。
 *
 * ブラウザ側の描画で使います。中身は R2 の公開ドメインから直接取ってもらうので、Worker を通るのは
 * この1回だけです。必要になったものだけを問い合わせる前提で、一覧をまるごと配ることはしません。
 *
 * リクエストボディ: { "paths": ["minecraft:textures/item/apple.png", ...] }
 * レスポンス: { "base": "...", "keys": { "<paths の要素>": "<R2キー>" | null } }
 */
assetRoutes.post('/api/resolve', async (c) => {
  let payload: any;
  try { payload = await c.req.json(); } catch { return c.text('Invalid JSON', 400); }

  const paths: string[] = Array.isArray(payload?.paths) ? payload.paths.map(String) : [];
  if (paths.length === 0) return c.json({ base: publicBase(c.env), keys: {} });
  if (paths.length > MAX_RESOLVE) return c.text(`Too many paths (max ${MAX_RESOLVE})`, 400);

  const src = new AssetSource(c.env, toChannel(c.req.query('mc') ?? ''));
  const keys: Record<string, string | null> = {};

  await runPool(paths, 20, async (entry) => {
    const [ns, logicalPath] = splitEntry(entry);
    // 形が違うものは「無い」と同じ扱いにします。1件のために全体を落とす必要はありません。
    if (!ns || !isValidNamespace(ns) || !isSafePath(logicalPath) || !allowed(logicalPath)) {
      keys[entry] = null;
      return;
    }
    keys[entry] = await src.keyOf(ns, logicalPath).catch(() => null);
  });

  return c.json({ base: publicBase(c.env), keys }, 200, { 'Cache-Control': 'public, max-age=3600' });
});

/**
 * `ns:論理パス` を分解します。
 * @param entry 問い合わせの1件
 */
function splitEntry(entry: string): [string | null, string] {
  const colon = entry.indexOf(':');
  if (colon <= 0) return [null, ''];
  return [entry.slice(0, colon), entry.slice(colon + 1)];
}

/**
 * 読み出しを許す論理パスかどうかを返します。
 * @param logicalPath 論理パス
 */
function allowed(logicalPath: string): boolean {
  return ALLOWED_ROOTS.some((root) => logicalPath.startsWith(root));
}

/**
 * R2 の公開ドメインを返します。
 * @param env 環境変数
 */
function publicBase(env: Env): string {
  return (env.PUBLIC_IMAGE_BASE ?? '').replace(/\/$/, '');
}
