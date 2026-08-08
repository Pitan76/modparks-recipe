/**
 * @fileoverview 投稿の上限。既定値と、identity ごとの上書きをここで一本化します。
 *
 * 上限は日次の投稿回数と namespace の所有数の2つがあり、どちらも「既定値があり、
 * 個別に緩められる」という同じ形をしています。判定を書き写すと、片方だけ上書きが
 * 効かないという食い違いが起きます。
 */

import type { Env } from '../minecraft';

/** 無制限を表す値。0 は「1回も許さない」という別の意味になるため使えません。 */
export const UNLIMITED = -1;

/**
 * 1 identity が1日に投稿できる jar の本数（既定）。
 *
 * 律速は R2 の Class A（書き込み系）で、無料枠は月100万です。1人が1日に投げられる本数を
 * 絞っておかないと、1アカウントで枠を使い切れてしまいます。
 */
export const DEFAULT_DAILY_LIMIT = 3;

/**
 * 1 identity が保持できる namespace の上限（既定）。
 *
 * unverified の乱取りを防ぐためのものです。依存 mod を含む jar は1本で複数の namespace を
 * 持ち込むため、mod の本数よりかなり早く埋まります。
 */
export const DEFAULT_NAMESPACE_LIMIT = 20;

/** identity に適用される上限。 */
export type Limits = { nsLimit: number; dailyLimit: number };

/**
 * identity に適用される上限を返します。上書きが無ければ既定値です。
 * @param env 環境変数
 * @param identityId 主体のID
 */
export async function limitsFor(env: Env, identityId: string): Promise<Limits> {
  const row = await env.DB.prepare('SELECT ns_limit, daily_limit FROM identity_limits WHERE identity_id = ?')
    .bind(identityId)
    .first<{ ns_limit: number | null; daily_limit: number | null }>();

  return {
    nsLimit: row?.ns_limit ?? DEFAULT_NAMESPACE_LIMIT,
    dailyLimit: row?.daily_limit ?? DEFAULT_DAILY_LIMIT,
  };
}

/**
 * 使用数が上限に収まっているかを返します。
 * @param used 使用数
 * @param limit 上限。`UNLIMITED` なら常に true
 */
export const withinLimit = (used: number, limit: number): boolean => limit === UNLIMITED || used <= limit;
