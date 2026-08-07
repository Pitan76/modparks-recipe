/**
 * @fileoverview 管理者用のR2クリーンアップ、デバッグ用ファイルリスト、キャッシュ破棄、インデックス再構築などの管理ルート定義。
 */

import { Hono } from 'hono';
import { Env } from '../utils/minecraft';
import { renderBlockIconPng, renderBlockIconSvg } from '../utils/block-icon';
import { bumpAssetVersion, ensureAssetVersions, getAllVersions } from '../utils/cache-version';
import { IMAGE_CACHE_PREFIX } from '../core/image-key';
import { sweepStaleIngests } from '../utils/ingest';
import { reindexStep, normalizeBatch } from '../utils/reindex';
import { listUploads } from '../utils/audit';
import { deliveryVersion } from '../utils/image-cdn';

export const adminRoutes = new Hono<{ Bindings: Env }>();

/**
 * 投入履歴の照会。問題のあるデータが入ったときに、誰がいつ入れたかを辿るためのものです。
 * 例: GET /admin/uploads?secret=...&ns=itemalchemy&limit=50
 */
adminRoutes.get('/admin/uploads', async (c) => {
  const secret = c.req.query('secret');
  if (!c.env.ADMIN_SECRET || secret !== c.env.ADMIN_SECRET) return c.text('Unauthorized', 401);

  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 500);
  const uploads = await listUploads(c.env, {
    ns: c.req.query('ns') || undefined,
    identityId: c.req.query('identity') || undefined,
    limit,
  });
  return c.json({ count: uploads.length, uploads });
});

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
 * キャッシュを明示的に無効化します。ネームスペースのバージョンを上げることで、そのネームスペースの
 * レンダリング済み画像・アイコン（L1/L2）と、クライアントが載せる `?v=` を一斉に切り替えます。
 * L1 は世代キー方式のため、古いオブジェクトは参照されなくなり lifecycle ルールで自然に消えます。
 *
 * リクエストボディ（JSON, いずれか）:
 *   { "namespace": "minecraft" }  → 単一ネームスペース
 *   { "all": true }               → 既知の全ネームスペース（緊急時・レンダラー変更の手動反映など）
 *
 * 例: POST /admin/invalidate?secret=...  (ボディに JSON)
 * 個別レシピ単位の無効化はレシピごとのフィンガープリントが無いため未対応です（ネームスペース単位のみ）。
 */
adminRoutes.post('/admin/invalidate', async (c) => {
  const secret = c.req.query('secret');
  if (!c.env.ADMIN_SECRET || secret !== c.env.ADMIN_SECRET) {
    return c.text('Unauthorized', 401);
  }

  let payload: any;
  try { payload = await c.req.json(); } catch { return c.text('Invalid JSON', 400); }

  let targets: string[];
  if (payload.all === true) {
    targets = Object.keys(await getAllVersions(c.env));
  } else if (typeof payload.namespace === 'string' && payload.namespace) {
    targets = [payload.namespace];
  } else {
    return c.text('Specify { namespace } or { all: true }', 400);
  }

  for (const ns of targets) await bumpAssetVersion(c.env, ns);
  return c.json({ ok: true, invalidated: targets });
});

/**
 * commit/abort されずに放置された、失効済みの取り込みセッションを一掃します。
 * 例: GET /admin/sweep-ingests?secret=...
 */
adminRoutes.get('/admin/sweep-ingests', async (c) => {
  const secret = c.req.query('secret');
  if (!c.env.ADMIN_SECRET || secret !== c.env.ADMIN_SECRET) {
    return c.text('Unauthorized', 401);
  }
  const swept = await sweepStaleIngests(c.env);
  return c.json({ ok: true, swept });
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
 * オンデマンドで実行されるため、公開用の /api/list.json は低コストな静的読み取りのまま維持されます。
 * CIを待たずにインデックスを補完するために使用します。
 *
 * レシピ1件につきR2 GETが1回走るため、1回の呼び出しでは既定500件までしか進みません。
 * `done: false` が返ったら、返ってきた `cursor` を付けて完了するまで呼び直してください。
 * 公開インデックスが差し替わるのは最後の呼び出しの時だけです。
 *
 * 例: GET /admin/reindex?secret=...&cursor=...&batch=500
 */
adminRoutes.get('/admin/reindex', async (c) => {
  const secret = c.req.query('secret');
  if (!c.env.ADMIN_SECRET || secret !== c.env.ADMIN_SECRET) {
    return c.text('Unauthorized', 401);
  }

  // 公開用インデックスは { id, result, type } の recipes 形式でなければならない。
  // 旧 ids 形式で書くと ProjectRecipes と updateIndexMany が recipes を読めず一覧が空になる。
  const step = await reindexStep(c.env, c.req.query('cursor'), normalizeBatch(c.req.query('batch')));
  return c.json({ ok: true, ...step });
});

/**
 * 使われなくなった世代のレンダリング済み画像（L1）を削除します。
 *
 * L1 のキーは `cache/img/<rv>/...` で、`rv` はレンダラー版と共有ネームスペースのバージョンから
 * 決まります。更新のたびに新しい世代へ移るため、古い世代は参照されないまま残り続けます。
 * 消えても Worker が作り直すだけなので、現行世代以外はいつ消しても構いません。
 *
 * 既定は数えるだけです。実際に消すには `?delete=1` を付けてください。
 * 例: GET /admin/gc-images?secret=...&delete=1
 */
adminRoutes.get('/admin/gc-images', async (c) => {
  const secret = c.req.query('secret');
  if (!c.env.ADMIN_SECRET || secret !== c.env.ADMIN_SECRET) {
    return c.text('Unauthorized', 401);
  }

  const current = await deliveryVersion(c.env);
  const apply = c.req.query('delete') === '1';
  const stale = new Map<string, number>();
  let kept = 0;
  let deleted = 0;

  let cursor: string | undefined = undefined;
  do {
    const listed = await c.env.BUCKET.list({ prefix: IMAGE_CACHE_PREFIX, cursor });
    const doomed: string[] = [];
    for (const obj of listed.objects) {
      const generation = generationOf(obj.key);
      if (!generation || generation === current) {
        kept++;
        continue;
      }
      stale.set(generation, (stale.get(generation) ?? 0) + 1);
      doomed.push(obj.key);
    }

    if (apply && doomed.length > 0) {
      await c.env.BUCKET.delete(doomed);
      deleted += doomed.length;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return c.json({
    ok: true,
    current,
    kept,
    stale: Object.fromEntries(stale),
    staleTotal: [...stale.values()].reduce((a, b) => a + b, 0),
    deleted: apply ? deleted : 0,
    applied: apply,
  });
});

/**
 * L1 のキーから世代（`rv`）を取り出します。
 * @param key R2オブジェクトキー
 * @returns 取り出せなければ null
 */
function generationOf(key: string): string | null {
  const rest = key.slice(IMAGE_CACHE_PREFIX.length);
  const slash = rest.indexOf('/');
  return slash > 0 ? rest.slice(0, slash) : null;
}
