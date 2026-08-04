/**
 * @fileoverview Modがレシピやテクスチャ、モデルなどを登録するための書き込み・一括登録APIのルート定義。
 */

import { Hono } from 'hono';
import { Env } from '../utils/minecraft';
import { decodeBase64, contentTypeForKey, plainEntries } from '../utils/http';
import { requireWrite } from '../utils/auth/guard';
import { storeRecipe, putRecipeBody, updateIndexMany, indexEntryOf } from '../utils/recipe-store';
import { isCraftingType } from '../utils/minecraft';
import { bumpAssetVersion } from '../utils/cache-version';
import { putLang, isValidLocale, isValidLangBody } from '../utils/lang-store';
import { readIngestMeta, stageEntries, type StagedEntry } from '../utils/ingest';
import { PatchCollector, stagePatch } from '../utils/build/staging';
import { runPool } from '../utils/pool';
import { isValidNamespace, isSafePath, isSafeAssetTarget } from '../utils/asset-path';

// ---- 書き込みAPI (認証付き) ----------------------------------------------
// ModがバニラのJARパイプラインに依存せず、独自のレシピやテクスチャをプッシュできるようにします。
// 認証: Authorization: Bearer <secret> または ?secret=。

export const writeRoutes = new Hono<{ Bindings: Env }>();


// 単一のレシピJSONをアップロードします。リクエストボディ = レシピのJSONデータ。
writeRoutes.put('/api/:namespace/recipe/:id', async (c) => {
  const { namespace, id } = c.req.param();
  if (!isSafeAssetTarget(namespace, id)) return c.text('Invalid namespace or id', 400);

  const grant = await requireWrite(c, namespace);
  if (grant instanceof Response) return grant;

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
  const { namespace, path } = c.req.param();
  if (!isSafeAssetTarget(namespace, path)) return c.text('Invalid namespace or path', 400);

  const grant = await requireWrite(c, namespace);
  if (grant instanceof Response) return grant;

  const key = `assets/${namespace}/textures/${path}`;
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  await c.env.BUCKET.put(key, bytes, { httpMetadata: { contentType: contentTypeForKey(key) } });
  await bumpAssetVersion(c.env, namespace);
  return c.json({ ok: true, key });
});

// assets/<ns>/models/<path>.json 配下にモデルJSONをアップロードします（例: "item/gadget" や "block/machine"）。
// レンダラーはモデルの textures/parent チェーンをたどることで、テクスチャのファイル名がIDと異なるアイテムを解決できます。
writeRoutes.put('/api/:namespace/model/:path{.+}', async (c) => {
  const { namespace, path } = c.req.param();
  if (!isSafeAssetTarget(namespace, path)) return c.text('Invalid namespace or path', 400);

  const grant = await requireWrite(c, namespace);
  if (grant instanceof Response) return grant;

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
  const { namespace, path } = c.req.param();
  if (!isSafeAssetTarget(namespace, path)) return c.text('Invalid namespace or path', 400);

  const grant = await requireWrite(c, namespace);
  if (grant instanceof Response) return grant;

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

// assets/<ns>/lang/<locale>.json に言語ファイルをアップロードします（リクエストボディ = 素の Minecraft lang JSON）。
// 対応ロケールはAPI側で固定していないため、新しい言語は取り込み側で指定するだけで増やせます。
writeRoutes.put('/api/:namespace/lang/:locale', async (c) => {
  const { namespace } = c.req.param();
  if (!isValidNamespace(namespace)) return c.text('Invalid namespace', 400);

  const grant = await requireWrite(c, namespace);
  if (grant instanceof Response) return grant;

  const locale = c.req.param('locale').replace(/\.json$/, '');
  if (!isValidLocale(locale)) return c.text('Invalid locale', 400);

  const body = await c.req.text();
  if (!isValidLangBody(body)) return c.text('Invalid JSON', 400);

  await putLang(c.env, namespace, locale, body);
  await bumpAssetVersion(c.env, namespace);
  return c.json({ ok: true, key: `assets/${namespace}/lang/${locale}.json` });
});

// レシプレベルのバンドル：レシピと、そのテクスチャ（およびオプションで事前レンダリング済みの3D PNG）を1回で送信します。
// リクエストボディのJSON例:
// { "recipe": {...}, "textures": { "item/foo.png": "<base64>", ... } }
// テクスチャのキーは assets/<ns>/textures/ 配下のパスです（例: "item/foo.png", "block/bar.png"、あるいは事前レンダリングされた3Dアイコンの場合は "render3d/baz.png"）。
writeRoutes.post('/api/:namespace/recipe/:id/bundle', async (c) => {
  const { namespace, id } = c.req.param();
  if (!isSafeAssetTarget(namespace, id)) return c.text('Invalid namespace or id', 400);

  const grant = await requireWrite(c, namespace);
  if (grant instanceof Response) return grant;

  let payload: any;
  try { payload = await c.req.json(); } catch { return c.text('Invalid JSON', 400); }

  let recipeStored = false;
  if (payload.recipe) {
    await storeRecipe(c.env, namespace, id, JSON.stringify(payload.recipe), payload.recipe);
    recipeStored = true;
  }

  // 送信側の型ミスで妙なキーを作らないよう、素直なオブジェクトのみを回し、
  // 安全でないパスは書かずに数えるだけにします（1件のミスで残りを落とさないため）。
  let textureCount = 0;
  let skipped = 0;
  for (const [texPath, b64] of plainEntries(payload.textures)) {
    if (!isSafePath(texPath) || typeof b64 !== 'string') {
      skipped++;
      continue;
    }
    const key = `assets/${namespace}/textures/${texPath}`;
    await c.env.BUCKET.put(key, decodeBase64(b64), {
      httpMetadata: { contentType: contentTypeForKey(key) },
    });
    textureCount++;
  }

  // テクスチャのファイル名がIDと異なるアイテムを解決できるようにするための、オプションのモデルJSON。
  // キーは assets/<ns>/models/ 配下のパスです（例: "item/gadget.json"）。値はモデルJSON（文字列またはオブジェクト）です。
  let modelCount = 0;
  for (const [modelPath, val] of plainEntries(payload.models)) {
    if (!isSafePath(modelPath)) {
      skipped++;
      continue;
    }
    const rel = modelPath.replace(/\.json$/, '');
    const json = typeof val === 'string' ? val : JSON.stringify(val);
    await c.env.BUCKET.put(`assets/${namespace}/models/${rel}.json`, json, {
      httpMetadata: { contentType: 'application/json' },
    });
    modelCount++;
  }

  await bumpAssetVersion(c.env, namespace);
  return c.json({ ok: true, id: `${namespace}:${id}`, recipeStored, textureCount, modelCount, skipped });
});

// 大量取り込み（Bulk Ingest）：特定のネームスペースについて、多くのレシピ/タグ/テクスチャ/モデルを1回のリクエストで送信します。
// これにより、ファイルごとに約1回のサブリクエストを送信することなく、抽出スクリプトは数回のリクエストでMod全体をプッシュできます。
// そうしないと、呼び出し側のサブリクエスト制限を超えてしまいます（レシピが最初にアップロードされるため、すべてのアセットが途中でドロップされる原因になります）。
// リクエストボディのJSON例（すべてオプション）:
//   { "recipes": { "<id>": <json|string>, ... },   // id にはスラッシュが含まれる場合があります
//     "tags":    { "<path>": <json|string>, ... },  // 例: "item/planks"
//     "textures":{ "<path>": "<base64>", ... },     // 例: "item/foo.png"
//     "models":  { "<path>": <json|string>, ... },  // 例: "item/foo"
//     "langs":   { "<locale>": <json|string>, ... } } // 例: "ja_jp"
writeRoutes.post('/api/:namespace/bulk', async (c) => {
  const { namespace } = c.req.param();
  if (!isValidNamespace(namespace)) return c.text('Invalid namespace', 400);

  const grant = await requireWrite(c, namespace);
  if (grant instanceof Response) return grant;

  let p: any;
  try { p = await c.req.json(); } catch { return c.text('Invalid JSON', 400); }

  // セッション付きの bulk はインデックスを触らず、追加分をステージングして commit でまとめる。
  const session = c.req.query('session');
  const meta = session ? await readIngestMeta(c.env, namespace, session) : null;
  if (session && !meta) return c.text('Unknown or expired ingest session', 409);

  // build を作るセッションでは、同じ内容を blob にも積む。commit で build マニフェストに畳まれる。
  const collector = meta?.build ? new PatchCollector(c.env) : null;

  const indexEntries: { fullId: string; data: any }[] = [];
  const staged: StagedEntry[] = [];
  // 安全でないパスや型違いは書かずに数えるだけにします。1件のミスで残り全部を落とすと、
  // 投入側は数百件を再送する羽目になります。
  let recipes = 0, tags = 0, textures = 0, models = 0, langs = 0, skipped = 0;

  for (const [id, val] of plainEntries(p.recipes)) {
    if (!isSafePath(id)) {
      skipped++;
      continue;
    }
    const body = typeof val === 'string' ? val : JSON.stringify(val);
    let data: any;
    try { data = JSON.parse(body); } catch { skipped++; continue; }
    await putRecipeBody(c.env, namespace, id, body);
    const fullId = `${namespace}:${id}`;
    if (collector) {
      await collector.addText(`recipe/${id}.json`, body);
      collector.addRecipe(fullId, isCraftingType(data?.type) ? indexEntryOf(fullId, data) : null);
    }
    if (session) {
      staged.push({ id: fullId, entry: isCraftingType(data?.type) ? indexEntryOf(fullId, data) : null });
    } else {
      indexEntries.push({ fullId, data });
    }
    recipes++;
  }

  if (session) await stageEntries(c.env, namespace, session, staged);
  else await updateIndexMany(c.env, indexEntries);

  for (const [path, val] of plainEntries(p.tags)) {
    if (!isSafePath(path)) {
      skipped++;
      continue;
    }
    const body = typeof val === 'string' ? val : JSON.stringify(val);
    try { JSON.parse(body); } catch { skipped++; continue; }
    const id = path.replace(/\.json$/, '');
    await c.env.BUCKET.put(`data/${namespace}/tags/${id}.json`, body, {
      httpMetadata: { contentType: 'application/json' },
    });
    await c.env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(`${namespace}:${id}`).run().catch(() => {});
    if (collector) await collector.addText(`tags/${id}.json`, body);
    tags++;
  }

  await runPool(plainEntries(p.textures), 20, async ([path, b64]) => {
    if (!isSafePath(path) || typeof b64 !== 'string') {
      skipped++;
      return;
    }
    const key = `assets/${namespace}/textures/${path}`;
    const bytes = decodeBase64(b64);
    await c.env.BUCKET.put(key, bytes, {
      httpMetadata: { contentType: contentTypeForKey(key) },
    });
    if (collector) await collector.addBinary(`textures/${path}`, bytes, contentTypeForKey(key));
    textures++;
  });

  await runPool(plainEntries(p.models), 20, async ([path, val]) => {
    if (!isSafePath(path)) {
      skipped++;
      return;
    }
    const rel = path.replace(/\.json$/, '');
    const json = typeof val === 'string' ? val : JSON.stringify(val);
    await c.env.BUCKET.put(`assets/${namespace}/models/${rel}.json`, json, {
      httpMetadata: { contentType: 'application/json' },
    });
    if (collector) await collector.addText(`models/${rel}.json`, json);
    models++;
  });

  for (const [locale, val] of plainEntries(p.langs)) {
    const body = typeof val === 'string' ? val : JSON.stringify(val);
    if (!isValidLocale(locale) || !isValidLangBody(body)) {
      skipped++;
      continue;
    }
    await putLang(c.env, namespace, locale, body);
    if (collector) await collector.addText(`lang/${locale}.json`, body);
    langs++;
  }

  if (collector && !collector.isEmpty) await stagePatch(c.env, namespace, session!, collector.toPatch());

  // セッション中は bump しない。commit 時に1回だけ上げる（投入中はキャッシュを定着させない）。
  if (!session) await bumpAssetVersion(c.env, namespace);
  return c.json({ ok: true, namespace, recipes, tags, textures, models, langs, skipped, session: session ?? null });
});
