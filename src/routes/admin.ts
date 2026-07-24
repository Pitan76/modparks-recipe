/**
 * @fileoverview 管理者用のR2クリーンアップ、デバッグ用ファイルリスト、キャッシュ破棄、インデックス再構築などの管理ルート定義。
 */

import { Hono } from 'hono';
import { Env } from '../utils/minecraft';
import { renderBlockIconPng, renderBlockIconSvg } from '../utils/block-icon';
import { bumpAssetVersion, ensureAssetVersions } from '../utils/cache-version';
import { resultItemOf, isCraftingType } from '../utils/minecraft';

type IndexEntry = { id: string; result: string | null; type: string };

/**
 * レシピJSONを並列に読み、公開インデックス用の { id, result, type } エントリを組み立てます。
 * クラフト系のみを対象とし、読めなかった/JSONでないものはスキップします。
 * @param env 環境変数
 * @param keys 列挙済みの { fullId, key } の配列
 */
async function buildRecipeEntries(env: Env, keys: { fullId: string; key: string }[]): Promise<IndexEntry[]> {
  const out: IndexEntry[] = [];
  const CONCURRENCY = 30;
  let i = 0;

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, keys.length) }, async () => {
      while (i < keys.length) {
        const { fullId, key } = keys[i++];
        const obj = await env.BUCKET.get(key);
        if (!obj) continue;
        let data: any;
        try { data = JSON.parse(await obj.text()); } catch { continue; }
        if (!isCraftingType(data?.type)) continue;
        out.push({ id: fullId, result: resultItemOf(data), type: String(data.type).replace(/^minecraft:/, '') });
      }
    })
  );
  return out;
}

export const adminRoutes = new Hono<{ Bindings: Env }>();

/**
 * R2内の古いゴミファイルをクリーンアップするための管理者用エンドポイント（再アップロード前などに使用）。
 */
adminRoutes.get('/admin/clean/:namespace/:folder', async (c) => {
  const secret = c.req.query('secret');
  if (!c.env.ADMIN_SECRET || secret !== c.env.ADMIN_SECRET) {
    return c.text('Unauthorized', 401);
  }

  const { namespace, folder } = c.req.param();
  const prefix = `assets/${namespace}/textures/${folder}/`;

  let count = 0;
  let cursor: string | undefined = undefined;
  do {
    const listed = await c.env.BUCKET.list({ prefix, cursor });
    const keys = listed.objects.map(o => o.key);
    if (keys.length > 0) {
      await c.env.BUCKET.delete(keys);
      count += keys.length;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return c.text(`Deleted ${count} old objects from ${prefix}`);
});

/**
 * 実際にアップロードされたものをデバッグするための、読み取り専用のR2リスト。
 * 例: GET /admin/ls?secret=...&prefix=assets/itemalchemy/&limit=200
 */
adminRoutes.get('/admin/ls', async (c) => {
  const secret = c.req.query('secret');
  if (!c.env.ADMIN_SECRET || secret !== c.env.ADMIN_SECRET) {
    return c.text('Unauthorized', 401);
  }

  const prefix = c.req.query('prefix') || '';
  const limit = Math.min(Number(c.req.query('limit')) || 200, 1000);
  const listed = await c.env.BUCKET.list({ prefix, limit, cursor: c.req.query('cursor') });

  return c.json({
    prefix,
    truncated: listed.truncated,
    cursor: listed.truncated ? listed.cursor : null,
    count: listed.objects.length,
    objects: listed.objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded })),
  });
});

/**
 * render3d/ キャッシュを経由せずに、Workerの3Dパスを通して単一のブロックアイコンをレンダリングします。
 * 保存されたオブジェクトを変更せずに、ブロックのアイコンを確認（またはオフラインパイプラインの出力と比較）するためのものです。
 * 例: GET /admin/render3d/:namespace/:path?secret=...
 */
adminRoutes.get('/admin/render3d/:namespace/:path{.+}', async (c) => {
  const secret = c.req.query('secret');
  if (!c.env.ADMIN_SECRET || secret !== c.env.ADMIN_SECRET) {
    return c.text('Unauthorized', 401);
  }

  const { namespace, path } = c.req.param();

  // ?format=svg は、ジオメトリをインスペクトするためのラスタライズ前のSVGを返します。
  if (c.req.query('format') === 'svg') {
    const svg = await renderBlockIconSvg(c.env, namespace, path);
    if (!svg) return c.text(`No renderable model for ${namespace}:${path}`, 404);
    return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } });
  }

  const png = await renderBlockIconPng(c.env, namespace, path);
  if (!png) return c.text(`No renderable model for ${namespace}:${path}`, 404);
  return new Response(png, { headers: { 'Content-Type': 'image/png' } });
});

/**
 * ネームスペースにキャッシュされているすべてのデータを破棄します：R2内の生成された3Dブロックアイコンと、エッジキャッシュにあるすべてのレンダリング済み画像。
 * レンダラーの変更後や、アイコンが古かったり間違っていたりする場合に使用します。
 * どちらも次回リクエスト時に自動的に再構築されます。
 * 例: GET /admin/purge/:namespace?secret=...
 */
adminRoutes.get('/admin/purge/:namespace', async (c) => {
  const secret = c.req.query('secret');
  if (!c.env.ADMIN_SECRET || secret !== c.env.ADMIN_SECRET) {
    return c.text('Unauthorized', 401);
  }

  const { namespace } = c.req.param();

  // 生成されたアイコンのみを対象とします。書き込みAPI経由でアップロードされた事前レンダリング済みのPNGもここにあるため、意図的に1つのネームスペースにスコープを限定しています。
  const prefix = `assets/${namespace}/textures/render3d/`;
  let icons = 0;
  let cursor: string | undefined = undefined;
  do {
    const listed = await c.env.BUCKET.list({ prefix, cursor });
    const keys = listed.objects.map((o) => o.key);
    if (keys.length > 0) {
      await c.env.BUCKET.delete(keys);
      icons += keys.length;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  // バージョンを上げることで、このネームスペースに対するキャッシュされたすべての画像URLを（どのようなクエリバリアントで保存されていても）アクセス不能（無効化）にします。
  await bumpAssetVersion(c.env, namespace);

  return c.json({ ok: true, namespace, iconsDeleted: icons, imageCacheInvalidated: true });
});

/**
 * バージョン未設定のネームスペースに初期バージョンを与えます。
 * バージョンが無いとクライアントが画像URLに `?v=` を付けられず、画像1枚ごとにサーバ側の
 * バージョン参照（R2 往復 約220ms）が残り続けます。導入時に一度だけ実行してください。
 * インデックスは読むだけで書き換えません。
 * 例: GET /admin/seed-versions?secret=...
 */
adminRoutes.get('/admin/seed-versions', async (c) => {
  const secret = c.req.query('secret');
  if (!c.env.ADMIN_SECRET || secret !== c.env.ADMIN_SECRET) {
    return c.text('Unauthorized', 401);
  }

  const obj = await c.env.BUCKET.get('index/recipes.json');
  if (!obj) return c.json({ ok: false, error: 'index/recipes.json not found' }, 404);

  const idx = await obj.json<{ recipes?: { id: string }[]; ids?: string[] }>();
  const ids = idx.recipes ? idx.recipes.map((r) => r.id) : (idx.ids ?? []);
  const namespaces = new Set(ids.map((i) => i.split(':')[0]).filter(Boolean));

  const seeded = await ensureAssetVersions(c.env, namespaces);
  return c.json({ ok: true, namespaces: [...namespaces], seeded });
});

/**
 * R2にすでに存在するレシピJSONからレシピインデックスを（再）構築するための管理者用エンドポイント。
 * オンデマンド（1回のバケットスキャン）で実行されるため、公開用の /api/list.json は低コストな静的読み取りのまま維持されます。
 * CIを待たずにインデックスを補完するために使用します。
 */
adminRoutes.get('/admin/reindex', async (c) => {
  const secret = c.req.query('secret');
  if (!c.env.ADMIN_SECRET || secret !== c.env.ADMIN_SECRET) {
    return c.text('Unauthorized', 401);
  }

  // R2 のレシピキーを列挙する。本文の取得は分離し、下でプールして並列に読む。
  const keys: { fullId: string; key: string }[] = [];
  let cursor: string | undefined = undefined;
  do {
    const listed = await c.env.BUCKET.list({ prefix: 'data/', cursor, limit: 1000 });
    for (const o of listed.objects) {
      const m = o.key.match(/^data\/([^/]+)\/recipes?\/(.+)\.json$/);
      if (m) keys.push({ fullId: `${m[1]}:${m[2]}`, key: o.key });
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  // 公開用インデックスは { id, result, type } の recipes 形式でなければならない。
  // 旧 ids 形式で書くと ProjectRecipes と updateIndexMany が recipes を読めず一覧が空になる。
  const recipes = await buildRecipeEntries(c.env, keys);
  recipes.sort((a, b) => a.id.localeCompare(b.id));
  await c.env.BUCKET.put(
    'index/recipes.json',
    JSON.stringify({ count: recipes.length, generatedAt: new Date().toISOString(), recipes }),
    { httpMetadata: { contentType: 'application/json' } }
  );

  return c.json({ ok: true, count: recipes.length, scanned: keys.length });
});
