/**
 * @fileoverview 外部投稿の日次レート制限。
 *
 * 律速は R2 の Class A（書き込み系）で、無料枠は月100万です。1 jar あたりの新規 blob を
 * 平均500件と見積もると月2000 jar 相当までしか吸収できません。1人が1日に投げられる本数を
 * 絞っておかないと、1アカウントで枠を使い切れてしまいます。
 */

import type { Env } from '../minecraft';
import { isDevMode } from '../dev';
import { limitsFor, withinLimit, UNLIMITED } from './limits';


/**
 * 投稿1本分の枠を消費します。
 * @param env 環境変数
 * @param identityId 主体のID
 * @returns 枠内なら true、使い切っていれば false
 */
export async function consumeUploadQuota(env: Env, identityId: string): Promise<boolean> {
  // 手元で試すたびに枠が減ると、1日3本で開発が止まります。
  if (isDevMode(env)) return true;

  const day = new Date().toISOString().slice(0, 10);

  // 先に加算して、加算後の値で判定します。読んでから書くと、同時投稿で上限を超えられます。
  const row = await env.DB.prepare(
    `INSERT INTO upload_quota (identity_id, day, used) VALUES (?, ?, 1)
     ON CONFLICT(identity_id, day) DO UPDATE SET used = used + 1
     RETURNING used`
  )
    .bind(identityId, day)
    .first<{ used: number }>();

  const { dailyLimit } = await limitsFor(env, identityId);
  // 加算に失敗したときは通しません。数えられていない投稿を許すと、上限が意味を失います。
  return withinLimit(row?.used ?? Infinity, dailyLimit);
}

/**
 * その日の残り本数を返します（表示用）。
 * @param env 環境変数
 * @param identityId 主体のID
 */
export async function remainingUploads(env: Env, identityId: string): Promise<number> {
  const { dailyLimit } = await limitsFor(env, identityId);
  if (isDevMode(env)) return UNLIMITED;
  if (dailyLimit === UNLIMITED) return UNLIMITED;

  const day = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare('SELECT used FROM upload_quota WHERE identity_id = ? AND day = ?')
    .bind(identityId, day)
    .first<{ used: number }>();

  return Math.max(0, dailyLimit - (row?.used ?? 0));
}
