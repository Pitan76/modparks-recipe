/**
 * @fileoverview 取り込みセッション（begin / commit / abort）のルート定義。
 *
 * 分割送信される bulk を1つの論理トランザクションとして扱うためのAPIです。
 * 実際のステージングと確定処理は utils/ingest.ts と utils/recipe-store.ts が持ちます。
 */

import { Hono } from 'hono';
import { Env } from '../utils/minecraft';
import { authorized } from '../utils/http';
import { upsertIndexEntries, type IndexEntry } from '../utils/recipe-store';
import { bumpAssetVersion } from '../utils/cache-version';
import { beginIngest, isIngestOpen, collectStaged, cleanupIngest } from '../utils/ingest';
import { isValidNamespace } from '../utils/asset-path';

export const ingestRoutes = new Hono<{ Bindings: Env }>();

// 取り込みセッションを開始します。以降の bulk は ?session= を付けて送り、最後に commit します。
ingestRoutes.post('/api/:namespace/ingest/begin', async (c) => {
  if (!authorized(c)) return c.text('Unauthorized', 401);
  const { namespace } = c.req.param();
  if (!isValidNamespace(namespace)) return c.text('Invalid namespace', 400);

  const session = await beginIngest(c.env, namespace);
  return c.json({ ok: true, namespace, session });
});

// 取り込みセッションを確定します。ステージング分をインデックスへ1回でマージし、バージョンを1回だけ上げます。
ingestRoutes.post('/api/:namespace/ingest/commit', async (c) => {
  if (!authorized(c)) return c.text('Unauthorized', 401);
  const { namespace } = c.req.param();
  if (!isValidNamespace(namespace)) return c.text('Invalid namespace', 400);

  const session = c.req.query('session');
  if (!session) return c.text('Missing session', 400);
  if (!(await isIngestOpen(c.env, namespace, session))) {
    return c.text('Unknown or expired ingest session', 409);
  }

  const staged = await collectStaged(c.env, namespace, session);
  // `!!e` なのは、デプロイを跨いだセッションに旧形式の断片が残りうるため。
  // 形が違えば索引に載せず、IDだけ除去対象として扱う（次の取り込みで載り直す）。
  const indexed = staged.map((s) => s.entry).filter((e): e is IndexEntry => !!e);
  await upsertIndexEntries(c.env, staged.map((s) => s.id), indexed);
  await bumpAssetVersion(c.env, namespace);
  await cleanupIngest(c.env, namespace, session);

  return c.json({ ok: true, namespace, committed: staged.length, indexed: indexed.length });
});

// 取り込みセッションを破棄します（ステージング分を捨て、インデックスもバージョンも変更しません）。
ingestRoutes.post('/api/:namespace/ingest/abort', async (c) => {
  if (!authorized(c)) return c.text('Unauthorized', 401);
  const { namespace } = c.req.param();
  if (!isValidNamespace(namespace)) return c.text('Invalid namespace', 400);

  const session = c.req.query('session');
  if (!session) return c.text('Missing session', 400);
  await cleanupIngest(c.env, namespace, session);
  return c.json({ ok: true, namespace, aborted: true });
});
