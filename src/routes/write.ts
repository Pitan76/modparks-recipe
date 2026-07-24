/**
 * @fileoverview Modがレシピやテクスチャ、モデルなどを登録するための書き込み・一括登録APIのルート定義。
 */

import { Hono } from 'hono';
import { Env } from '../utils/minecraft';
import { authorized, decodeBase64, contentTypeForKey } from '../utils/http';
import { storeRecipe, putRecipeBody, updateIndexMany, upsertIndexEntries, indexEntryOf } from '../utils/recipe-store';
import { isCraftingType } from '../utils/minecraft';
import { bumpAssetVersion } from '../utils/cache-version';
import { beginIngest, isIngestOpen, stageEntries, collectStaged, cleanupIngest, type StagedEntry } from '../utils/ingest';

// ---- 書き込みAPI (認証付き) ----------------------------------------------
// ModがバニラのJARパイプラインに依存せず、独自のレシピやテクスチャをプッシュできるようにします。
// 認証: Authorization: Bearer <secret> または ?secret=。

export const writeRoutes = new Hono<{ Bindings: Env }>();

/**
 * 指定された同時実行数制限内でタスクを実行します。
 * 大量取り込み（Bulk Ingest）では、1回のリクエストで数百個のオブジェクトを配置します。
 * それらを順番に処理すると、通信の往復待ち時間でリクエスト制限時間が全て消費され、Workerがタイムアウトしてしまいます。
 * @param items 処理するアイテムの配列
 * @param limit 同時実行数の上限
 * @param worker 各アイテムを処理する非同期関数
 */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await worker(items[i++]);
    })
  );
}

// 単一のレシピJSONをアップロードします。リクエストボディ = レシピのJSONデータ。
writeRoutes.put('/api/:namespace/recipe/:id', async (c) => {
  if (!authorized(c)) return c.text('Unauthorized', 401);
  const { namespace, id } = c.req.param();
  const body = await c.req.text();
  let data: any;
  try { data = JSON.parse(body); } catch { return c.text('Invalid JSON', 400); }
  await storeRecipe(c.env, namespace, id, body, data);
  await bumpAssetVersion(c.env, namespace);
  return c.json({ ok: true, id: `${namespace}:${id}` });
});

// assets/<ns>/textures/<path> 配下にテクスチャ（または任意のアセット）をアップロードします。
// 例: PUT /api/mymod/texture/item/gadget.png (リクエストボディ = PNGのバイナリデータ)
writeRoutes.put('/api/:namespace/texture/:path{.+}', async (c) => {
  if (!authorized(c)) return c.text('Unauthorized', 401);
  const { namespace, path } = c.req.param();
  const key = `assets/${namespace}/textures/${path}`;
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  await c.env.BUCKET.put(key, bytes, { httpMetadata: { contentType: contentTypeForKey(key) } });
  await bumpAssetVersion(c.env, namespace);
  return c.json({ ok: true, key });
});

// assets/<ns>/models/<path>.json 配下にモデルJSONをアップロードします（例: "item/gadget" や "block/machine"）。
// レンダラーはモデルの textures/parent チェーンをたどることで、テクスチャのファイル名がIDと異なるアイテムを解決できます。
writeRoutes.put('/api/:namespace/model/:path{.+}', async (c) => {
  if (!authorized(c)) return c.text('Unauthorized', 401);
  const { namespace, path } = c.req.param();
  const body = await c.req.text();
  try { JSON.parse(body); } catch { return c.text('Invalid JSON', 400); }
  const id = path.replace(/\.json$/, '');
  await c.env.BUCKET.put(`assets/${namespace}/models/${id}.json`, body, {
    httpMetadata: { contentType: 'application/json' },
  });
  await bumpAssetVersion(c.env, namespace);
  return c.json({ ok: true, key: `assets/${namespace}/models/${id}.json` });
});

// data/<ns>/tags/<path>.json 配下にタグJSONをアップロードします（例: "item/planks"）。
writeRoutes.put('/api/:namespace/tag/:path{.+}', async (c) => {
  if (!authorized(c)) return c.text('Unauthorized', 401);
  const { namespace, path } = c.req.param();
  const body = await c.req.text();
  try { JSON.parse(body); } catch { return c.text('Invalid JSON', 400); }
  const id = path.replace(/\.json$/, '');
  await c.env.BUCKET.put(`data/${namespace}/tags/${id}.json`, body, {
    httpMetadata: { contentType: 'application/json' },
  });
  await c.env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(`${namespace}:${id}`).run().catch(() => {});
  await bumpAssetVersion(c.env, namespace);
  return c.json({ ok: true, id: `${namespace}:${id}` });
});

// レシプレベルのバンドル：レシピと、そのテクスチャ（およびオプションで事前レンダリング済みの3D PNG）を1回で送信します。
// リクエストボディのJSON例:
// { "recipe": {...}, "textures": { "item/foo.png": "<base64>", ... } }
// テクスチャのキーは assets/<ns>/textures/ 配下のパスです（例: "item/foo.png", "block/bar.png"、あるいは事前レンダリングされた3Dアイコンの場合は "render3d/baz.png"）。
writeRoutes.post('/api/:namespace/recipe/:id/bundle', async (c) => {
  if (!authorized(c)) return c.text('Unauthorized', 401);
  const { namespace, id } = c.req.param();
  let payload: any;
  try { payload = await c.req.json(); } catch { return c.text('Invalid JSON', 400); }

  let recipeStored = false;
  if (payload.recipe) {
    await storeRecipe(c.env, namespace, id, JSON.stringify(payload.recipe), payload.recipe);
    recipeStored = true;
  }

  let textureCount = 0;
  for (const [texPath, b64] of Object.entries(payload.textures || {})) {
    const key = `assets/${namespace}/textures/${texPath}`;
    await c.env.BUCKET.put(key, decodeBase64(b64 as string), {
      httpMetadata: { contentType: contentTypeForKey(key) },
    });
    textureCount++;
  }

  // テクスチャのファイル名がIDと異なるアイテムを解決できるようにするための、オプションのモデルJSON。
  // キーは assets/<ns>/models/ 配下のパスです（例: "item/gadget.json"）。値はモデルJSON（文字列またはオブジェクト）です。
  let modelCount = 0;
  for (const [modelPath, val] of Object.entries(payload.models || {})) {
    const rel = modelPath.replace(/\.json$/, '');
    const json = typeof val === 'string' ? val : JSON.stringify(val);
    await c.env.BUCKET.put(`assets/${namespace}/models/${rel}.json`, json, {
      httpMetadata: { contentType: 'application/json' },
    });
    modelCount++;
  }

  await bumpAssetVersion(c.env, namespace);
  return c.json({ ok: true, id: `${namespace}:${id}`, recipeStored, textureCount, modelCount });
});

// 大量取り込み（Bulk Ingest）：特定のネームスペースについて、多くのレシピ/タグ/テクスチャ/モデルを1回のリクエストで送信します。
// これにより、ファイルごとに約1回のサブリクエストを送信することなく、抽出スクリプトは数回のリクエストでMod全体をプッシュできます。
// そうしないと、呼び出し側のサブリクエスト制限を超えてしまいます（レシピが最初にアップロードされるため、すべてのアセットが途中でドロップされる原因になります）。
// リクエストボディのJSON例（すべてオプション）:
//   { "recipes": { "<id>": <json|string>, ... },   // id にはスラッシュが含まれる場合があります
//     "tags":    { "<path>": <json|string>, ... },  // 例: "item/planks"
//     "textures":{ "<path>": "<base64>", ... },     // 例: "item/foo.png"
//     "models":  { "<path>": <json|string>, ... } } // 例: "item/foo"
writeRoutes.post('/api/:namespace/bulk', async (c) => {
  if (!authorized(c)) return c.text('Unauthorized', 401);
  const { namespace } = c.req.param();
  let p: any;
  try { p = await c.req.json(); } catch { return c.text('Invalid JSON', 400); }

  // セッション付きの bulk はインデックスを触らず、追加分をステージングして commit でまとめる。
  const session = c.req.query('session');
  if (session && !(await isIngestOpen(c.env, namespace, session))) {
    return c.text('Unknown or expired ingest session', 409);
  }

  const indexEntries: { fullId: string; data: any }[] = [];
  const staged: StagedEntry[] = [];
  let recipes = 0, tags = 0, textures = 0, models = 0;

  for (const [id, val] of Object.entries(p.recipes || {})) {
    const body = typeof val === 'string' ? val : JSON.stringify(val);
    let data: any;
    try { data = JSON.parse(body); } catch { continue; }
    await putRecipeBody(c.env, namespace, id, body);
    const fullId = `${namespace}:${id}`;
    if (session) {
      if (isCraftingType(data?.type)) staged.push(indexEntryOf(fullId, data));
    } else {
      indexEntries.push({ fullId, data });
    }
    recipes++;
  }

  if (session) await stageEntries(c.env, namespace, session, staged);
  else await updateIndexMany(c.env, indexEntries);

  for (const [path, val] of Object.entries(p.tags || {})) {
    const body = typeof val === 'string' ? val : JSON.stringify(val);
    try { JSON.parse(body); } catch { continue; }
    const id = path.replace(/\.json$/, '');
    await c.env.BUCKET.put(`data/${namespace}/tags/${id}.json`, body, {
      httpMetadata: { contentType: 'application/json' },
    });
    await c.env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(`${namespace}:${id}`).run().catch(() => {});
    tags++;
  }

  await runPool(Object.entries(p.textures || {}), 20, async ([path, b64]) => {
    const key = `assets/${namespace}/textures/${path}`;
    await c.env.BUCKET.put(key, decodeBase64(b64 as string), {
      httpMetadata: { contentType: contentTypeForKey(key) },
    });
    textures++;
  });

  await runPool(Object.entries(p.models || {}), 20, async ([path, val]) => {
    const rel = (path as string).replace(/\.json$/, '');
    const json = typeof val === 'string' ? val : JSON.stringify(val);
    await c.env.BUCKET.put(`assets/${namespace}/models/${rel}.json`, json, {
      httpMetadata: { contentType: 'application/json' },
    });
    models++;
  });

  // セッション中は bump しない。commit 時に1回だけ上げる（投入中はキャッシュを定着させない）。
  if (!session) await bumpAssetVersion(c.env, namespace);
  return c.json({ ok: true, namespace, recipes, tags, textures, models, session: session ?? null });
});

// 取り込みセッションを開始します。以降の bulk は ?session= を付けて送り、最後に commit します。
writeRoutes.post('/api/:namespace/ingest/begin', async (c) => {
  if (!authorized(c)) return c.text('Unauthorized', 401);
  const { namespace } = c.req.param();
  const session = await beginIngest(c.env, namespace);
  return c.json({ ok: true, namespace, session });
});

// 取り込みセッションを確定します。ステージング分をインデックスへ1回でマージし、バージョンを1回だけ上げます。
writeRoutes.post('/api/:namespace/ingest/commit', async (c) => {
  if (!authorized(c)) return c.text('Unauthorized', 401);
  const { namespace } = c.req.param();
  const session = c.req.query('session');
  if (!session) return c.text('Missing session', 400);
  if (!(await isIngestOpen(c.env, namespace, session))) {
    return c.text('Unknown or expired ingest session', 409);
  }

  const entries = await collectStaged(c.env, namespace, session);
  await upsertIndexEntries(c.env, entries.map((e) => e.id), entries);
  await bumpAssetVersion(c.env, namespace);
  await cleanupIngest(c.env, namespace, session);

  return c.json({ ok: true, namespace, committed: entries.length });
});

// 取り込みセッションを破棄します（ステージング分を捨て、インデックスもバージョンも変更しません）。
writeRoutes.post('/api/:namespace/ingest/abort', async (c) => {
  if (!authorized(c)) return c.text('Unauthorized', 401);
  const { namespace } = c.req.param();
  const session = c.req.query('session');
  if (!session) return c.text('Missing session', 400);
  await cleanupIngest(c.env, namespace, session);
  return c.json({ ok: true, namespace, aborted: true });
});
