/**
 * @fileoverview 書き込みトークンの発行と検証。
 *
 * 従来の共有シークレット1本では「誰が」「どの namespace に」書けるかを区別できず、
 * 外部へ開いた瞬間に namespace の先取りが成立します。トークンは identity と scope を持ち、
 * 検証結果としてその2つが返るため、以降の判断（所有権・trust・レート制限）が全部つながります。
 *
 * 生のトークンは保存せず、ハッシュだけを鍵にします。DBが漏れても、そこから書き込み権限は復元できません。
 */

import type { Env } from '../minecraft';
import { sha256Text } from '../build/hash';

/** 検証済みトークンが表す主体と権限。 */
export type TokenGrant = { identityId: string; scope: string };

/** 発行されるトークンの接頭辞。ログ等で見分けるためだけのもので、意味は持ちません。 */
const PREFIX = 'mpr';

/**
 * トークンを発行します。返り値の生トークンはこの1回しか取得できません。
 * @param env 環境変数
 * @param identityId 主体のID
 * @param scope 権限（`ns:<name>` または `upload`）
 * @param ttlMs 有効期間（ミリ秒）。省略すると無期限
 * @returns 生のトークン文字列
 */
export async function issueToken(env: Env, identityId: string, scope: string, ttlMs?: number): Promise<string> {
  const token = `${PREFIX}_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
  const expiresAt = ttlMs ? new Date(Date.now() + ttlMs).toISOString() : null;

  await env.DB.prepare('INSERT INTO tokens (hash, identity_id, scope, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Text(token), identityId, scope, expiresAt)
    .run();
  return token;
}

/**
 * トークンを検証します。
 * @param env 環境変数
 * @param token 生のトークン文字列
 * @returns 有効なら主体と権限。無効・失効なら null
 */
export async function verifyToken(env: Env, token: string): Promise<TokenGrant | null> {
  if (!token.startsWith(`${PREFIX}_`)) return null;

  const row = await env.DB.prepare('SELECT identity_id, scope, expires_at FROM tokens WHERE hash = ?')
    .bind(await sha256Text(token))
    .first<{ identity_id: string; scope: string; expires_at: string | null }>();
  if (!row) return null;
  if (row.expires_at && Date.parse(row.expires_at) < Date.now()) return null;

  return { identityId: row.identity_id, scope: row.scope };
}

/**
 * トークンを失効させます。
 * @param env 環境変数
 * @param token 生のトークン文字列
 */
export async function revokeToken(env: Env, token: string): Promise<void> {
  await env.DB.prepare('DELETE FROM tokens WHERE hash = ?').bind(await sha256Text(token)).run();
}

/**
 * 権限が対象ネームスペースへの書き込みを含むかを判定します。
 *
 * `upload` はポータル経由の投稿用で、書き込み先はサーバ側が決めるため、
 * ここでは namespace 権限としては扱いません。
 * @param scope トークンの権限
 * @param ns 対象ネームスペース
 */
export function scopeAllows(scope: string, ns: string): boolean {
  return scope === `ns:${ns}`;
}
