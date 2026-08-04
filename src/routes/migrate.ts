/**
 * @fileoverview 既存のフラットなアセットを build へ移行するための管理ルート。
 *
 * 1リクエストで完了させるとCPU時間に引っかかるため、begin / step / finish に分けています。
 * step はカーソルを返すので、呼び出し側は `cursor` が null になるまで繰り返します。
 */

import { Hono } from 'hono';
import { Env } from '../utils/minecraft';
import { isValidNamespace } from '../utils/asset-path';
import { beginIngest, cleanupIngest, readIngestMeta } from '../utils/ingest';
import { toChannel } from '../utils/build/mc-version';
import { migrateStep, stageLegacyIndex } from '../utils/build/migrate';
import { finalizeBuild } from '../utils/build/commit';

export const migrateRoutes = new Hono<{ Bindings: Env }>();

/**
 * 管理者シークレットを検証します。
 * @param c Honoのコンテキスト
 */
function isAdmin(c: any): boolean {
  return !!c.env.ADMIN_SECRET && c.req.query('secret') === c.env.ADMIN_SECRET;
}

// 移行セッションを開始します。?mc= には移行先のMCバージョンを指定します（自動判定はできないため必須）。
migrateRoutes.post('/admin/migrate/:namespace/begin', async (c) => {
  if (!isAdmin(c)) return c.text('Unauthorized', 401);
  const { namespace } = c.req.param();
  if (!isValidNamespace(namespace)) return c.text('Invalid namespace', 400);

  const channel = toChannel(c.req.query('mc') ?? '');
  if (!channel) return c.text('Missing or invalid mc', 400);

  // 既存資産は「その時点の全量」なので full。移行後の初回取り込みで差分が正しく出ます。
  const session = await beginIngest(c.env, namespace, {
    mcChannels: [channel],
    modVersion: 'legacy',
    loader: null,
    trust: 'verified',
    source: 'migration',
    full: true,
  });
  return c.json({ ok: true, namespace, session, channel });
});

// 走査を1バッチ進めます。戻り値の cursor を次の呼び出しにそのまま渡してください。
migrateRoutes.post('/admin/migrate/:namespace/step', async (c) => {
  if (!isAdmin(c)) return c.text('Unauthorized', 401);
  const { namespace } = c.req.param();

  const session = c.req.query('session');
  if (!session) return c.text('Missing session', 400);
  if (!(await readIngestMeta(c.env, namespace, session))) {
    return c.text('Unknown or expired ingest session', 409);
  }

  const limit = Number(c.req.query('limit') ?? '200');
  const result = await migrateStep(c.env, namespace, session, c.req.query('cursor') ?? null, limit);
  return c.json({ ok: true, namespace, ...result });
});

// 走査完了後に呼び、legacy build として確定します。
migrateRoutes.post('/admin/migrate/:namespace/finish', async (c) => {
  if (!isAdmin(c)) return c.text('Unauthorized', 401);
  const { namespace } = c.req.param();

  const session = c.req.query('session');
  if (!session) return c.text('Missing session', 400);

  const meta = await readIngestMeta(c.env, namespace, session);
  if (!meta?.build) return c.text('Unknown or expired ingest session', 409);

  const recipes = await stageLegacyIndex(c.env, namespace, session);
  const build = await finalizeBuild(c.env, namespace, session, meta.build);
  await cleanupIngest(c.env, namespace, session);

  return c.json({ ok: true, namespace, stagedRecipes: recipes, build });
});
