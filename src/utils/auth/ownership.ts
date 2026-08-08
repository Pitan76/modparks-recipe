/**
 * @fileoverview namespace の所有権と trust。
 *
 * 所有権はプロバイダ非依存の identity に紐付けます。ModParks 連携を後から外しても、
 * 既に確立した所有権が失われないようにするためです。
 *
 * unverified は先着で取れますが、verified（ModParks のプロジェクト所有者確認を通ったもの）が
 * 後から主張した場合は奪取できます。逆は成立しません。
 */

import type { Env } from '../minecraft';

/** 所有権の信頼度。 */
export type Trust = 'verified' | 'unverified';

/** namespace の所有権レコード。 */
export type Ownership = { ns: string; trust: Trust; ownerId: string; claimedAt: string };


/**
 * namespace の所有権を取得します。
 * @param env 環境変数
 * @param ns ネームスペース
 * @returns 未所有なら null
 */
export async function getOwnership(env: Env, ns: string): Promise<Ownership | null> {
  const row = await env.DB.prepare('SELECT ns, trust, owner_id, claimed_at FROM namespaces WHERE ns = ?')
    .bind(ns)
    .first<{ ns: string; trust: string; owner_id: string; claimed_at: string }>();
  if (!row) return null;

  return {
    ns: row.ns,
    trust: row.trust === 'verified' ? 'verified' : 'unverified',
    ownerId: row.owner_id,
    claimedAt: row.claimed_at,
  };
}

/** 所有権の主張結果。拒否された場合は理由が入ります。 */
export type ClaimResult =
  | { ok: true; ownership: Ownership; takenOver: boolean }
  | { ok: false; reason: 'owned' | 'limit' };

/**
 * namespace の所有権を主張します。
 *
 * 未所有なら先着で確保します。既に unverified が持っている namespace は、verified の主張で
 * 奪取できます（正規の作者が後から来たケース）。verified が持つものは奪えません。
 * @param env 環境変数
 * @param ns ネームスペース
 * @param identityId 主張する主体
 * @param trust 主張する信頼度
 * @returns 主張結果
 */
export async function claimNamespace(
  env: Env,
  ns: string,
  identityId: string,
  trust: Trust
): Promise<ClaimResult> {
  const current = await getOwnership(env, ns);
  if (current && !canTakeOver(current, identityId, trust)) return { ok: false, reason: 'owned' };
  if (!current && trust === 'unverified' && (await countOwned(env, identityId)) >= MAX_UNVERIFIED_NAMESPACES) {
    return { ok: false, reason: 'limit' };
  }

  await env.DB.prepare(
    `INSERT INTO namespaces (ns, trust, owner_id, claimed_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(ns) DO UPDATE SET trust = excluded.trust, owner_id = excluded.owner_id, claimed_at = excluded.claimed_at`
  )
    .bind(ns, trust, identityId, new Date().toISOString())
    .run();

  const ownership = await getOwnership(env, ns);
  return { ok: true, ownership: ownership!, takenOver: !!current && current.ownerId !== identityId };
}

/**
 * 既存の所有権を上書きしてよいかを判定します。
 * @param current 現在の所有権
 * @param identityId 主張する主体
 * @param trust 主張する信頼度
 */
function canTakeOver(current: Ownership, identityId: string, trust: Trust): boolean {
  if (current.ownerId === identityId) return true;
  return current.trust === 'unverified' && trust === 'verified';
}

/**
 * その主体が既に持っている namespace の数を数えます。
 * @param env 環境変数
 * @param identityId 主体のID
 */
async function countOwned(env: Env, identityId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM namespaces WHERE owner_id = ?')
    .bind(identityId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * その主体が namespace へ書き込めるかを判定します。
 *
 * 未所有の namespace は「これから先着で取る」対象なので、書き込み自体は許可し、
 * 呼び出し側が `claimNamespace` で確保してから進めます。
 * @param env 環境変数
 * @param ns ネームスペース
 * @param identityId 主体のID
 */
export async function canWrite(env: Env, ns: string, identityId: string): Promise<boolean> {
  const current = await getOwnership(env, ns);
  return !current || current.ownerId === identityId;
}
