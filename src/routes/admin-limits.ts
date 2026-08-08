/**
 * @fileoverview 上限まわりの管理ルート（日次の投稿枠と、namespace の所有）。
 *
 * どちらも投稿を止める側の仕組みで、詰まったときに中身を見て戻せないと調査が進みません。
 * 取り込み系の管理ルート（admin.ts）とは目的が違うため分けています。
 */

import { Hono } from 'hono';
import { Env } from '../utils/minecraft';
import { requireAdmin } from '../utils/auth/admin';
import { isValidNamespace } from '../utils/asset-path';
import { limitsFor, UNLIMITED } from '../utils/auth/limits';

export const adminLimitRoutes = new Hono<{ Bindings: Env }>();

/**
 * identity を表示名で探します。
 *
 * identity のIDは画面のどこにも出ないため、管理操作の対象を指すには名前から引ける必要があります。
 * 例: GET /admin/identities?secret=...&q=ぴたん
 */
adminLimitRoutes.get('/admin/identities', async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;

  const q = c.req.query('q');
  const sql = `SELECT i.id, i.display_name, COUNT(n.ns) AS owned
     FROM identities i LEFT JOIN namespaces n ON n.owner_id = i.id
     ${q ? 'WHERE i.display_name LIKE ?' : ''}
     GROUP BY i.id ORDER BY i.display_name LIMIT 50`;

  const stmt = c.env.DB.prepare(sql);
  const rows = await (q ? stmt.bind(`%${q}%`) : stmt).all<{ id: string; display_name: string; owned: number }>();
  return c.json({ identities: rows.results ?? [] });
});

/**
 * identity ごとの上限の状況を返します。
 *
 * 「残り3回と出ているのに上限エラーが出る」ような食い違いは、日次枠と namespace 所有という
 * 別々の上限を1つの表示にまとめていることが原因です。両方を並べて出します。
 * 例: GET /admin/limits?secret=...&identity=...
 */
adminLimitRoutes.get('/admin/limits', async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;

  const identityId = c.req.query('identity');
  if (!identityId) return c.text('Missing identity', 400);

  const day = new Date().toISOString().slice(0, 10);
  const quota = await c.env.DB.prepare('SELECT used FROM upload_quota WHERE identity_id = ? AND day = ?')
    .bind(identityId, day)
    .first<{ used: number }>();
  const owned = await c.env.DB.prepare('SELECT ns, trust, claimed_at FROM namespaces WHERE owner_id = ? ORDER BY ns')
    .bind(identityId)
    .all<{ ns: string; trust: string; claimed_at: string }>();

  return c.json({
    identityId, day, used: quota?.used ?? 0,
    limits: await limitsFor(c.env, identityId),
    namespaces: owned.results ?? [],
  });
});

/**
 * identity ごとの上限を上書きします。
 *
 * `-1` は無制限、省略した項目は変更しません。既定値へ戻すには `default` を渡します。
 * 例: GET /admin/limits/set?secret=...&identity=...&ns=50&daily=-1
 *     GET /admin/limits/set?secret=...&identity=...&ns=default
 */
adminLimitRoutes.get('/admin/limits/set', async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;

  const identityId = c.req.query('identity');
  if (!identityId) return c.text('Missing identity', 400);

  const nsLimit = parseLimit(c.req.query('ns'));
  const dailyLimit = parseLimit(c.req.query('daily'));
  if (nsLimit === 'invalid' || dailyLimit === 'invalid') return c.text('Invalid limit', 400);

  // 既存行を読んでから書き戻します。「変更なし」と「既定値へ戻す（NULL）」を SQL の
  // COALESCE で表そうとすると、どちらも NULL になって区別できません。
  const row = await c.env.DB.prepare('SELECT ns_limit, daily_limit FROM identity_limits WHERE identity_id = ?')
    .bind(identityId)
    .first<{ ns_limit: number | null; daily_limit: number | null }>();

  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO identity_limits (identity_id, ns_limit, daily_limit, updated_at) VALUES (?, ?, ?, ?)`
  )
    .bind(
      identityId,
      merged(nsLimit, row?.ns_limit ?? null),
      merged(dailyLimit, row?.daily_limit ?? null),
      new Date().toISOString()
    )
    .run();

  return c.json({ ok: true, identityId, limits: await limitsFor(c.env, identityId) });
});

/** 上限の指定。未指定は変更なし、`default` は既定値へ戻す。 */
type LimitInput = number | 'keep' | 'reset' | 'invalid';

/**
 * 上限の指定を読み取ります。
 * @param raw クエリの値
 */
function parseLimit(raw: string | undefined): LimitInput {
  if (raw === undefined) return 'keep';
  if (raw === 'default') return 'reset';

  const n = parseInt(raw, 10);
  // 0 は「1回も許さない」という意味になり、事故で投稿を止めます。無制限は -1 です。
  if (!Number.isFinite(n) || n < UNLIMITED || n === 0) return 'invalid';
  return n;
}

/**
 * 指定と既存値から、保存する値を決めます。
 * @param input 読み取った指定
 * @param current 既存の値
 * @returns 保存する値。NULL は既定値を使うという意味
 */
function merged(input: LimitInput, current: number | null): number | null {
  if (typeof input === 'number') return input;
  return input === 'reset' ? null : current;
}

/**
 * その日の投稿枠を戻します。identity を省略すると全員分を消します。
 * 例: GET /admin/limits/reset-quota?secret=...&identity=...
 */
adminLimitRoutes.get('/admin/limits/reset-quota', async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;

  const identityId = c.req.query('identity');
  const day = new Date().toISOString().slice(0, 10);
  const sql = identityId
    ? 'DELETE FROM upload_quota WHERE identity_id = ? AND day = ?'
    : 'DELETE FROM upload_quota WHERE day = ?';
  const binds = identityId ? [identityId, day] : [day];

  const res = await c.env.DB.prepare(sql).bind(...binds).run();
  return c.json({ ok: true, day, identityId: identityId ?? null, deleted: res.meta?.changes ?? 0 });
});

/**
 * namespace の所有を解除します。
 *
 * 解除した namespace は未所有に戻り、次に投稿した人が先着で確保します。所有上限に当たった
 * identity のテスト用の確保を剥がすのが主な用途です。
 * 例: GET /admin/limits/release?secret=...&ns=techreborn
 *     GET /admin/limits/release?secret=...&identity=...&trust=unverified
 */
adminLimitRoutes.get('/admin/limits/release', async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;

  const ns = c.req.query('ns');
  const identityId = c.req.query('identity');
  if (!ns && !identityId) return c.text('Missing ns or identity', 400);
  if (ns && !isValidNamespace(ns)) return c.text('Invalid namespace', 400);

  const where: string[] = [];
  const binds: unknown[] = [];
  if (ns) { where.push('ns = ?'); binds.push(ns); }
  if (identityId) { where.push('owner_id = ?'); binds.push(identityId); }
  // verified は正規の作者が確認を通して得たものなので、明示しない限り剥がしません。
  if (c.req.query('trust') === 'unverified') where.push("trust = 'unverified'");

  const res = await c.env.DB.prepare(`DELETE FROM namespaces WHERE ${where.join(' AND ')}`).bind(...binds).run();
  return c.json({ ok: true, released: res.meta?.changes ?? 0 });
});
