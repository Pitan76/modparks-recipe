/**
 * @fileoverview identity（mp-recipe が発行する主体ID）と、外部プロバイダのユーザとの結び付け。
 *
 * 所有権もトークンも identity に紐付き、プロバイダは「その identity に到達する手段」でしかありません。
 * この分離があるおかげで、ログイン手段を後から足すことも、外すこともできます。
 */

import type { Env } from '../minecraft';

/** mp-recipe 上の主体。 */
export type Identity = { id: string; displayName: string };

/**
 * プロバイダ側のユーザに対応する identity を返します。無ければ作ります。
 * @param env 環境変数
 * @param provider プロバイダID（`modparks` など）
 * @param subject プロバイダ側のユーザID
 * @param displayName 表示名（新規作成時に使用）
 * @param accessToken プロバイダ側のアクセストークン（所有 ns の照会に使う）
 * @returns 対応する identity
 */
export async function resolveIdentity(
  env: Env,
  provider: string,
  subject: string,
  displayName: string,
  accessToken: string
): Promise<Identity> {
  const linked = await findLinked(env, provider, subject);
  if (linked) {
    await linkIdentity(env, linked.id, provider, subject, accessToken);
    return linked;
  }

  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO identities (id, display_name) VALUES (?, ?)').bind(id, displayName).run();
  await linkIdentity(env, id, provider, subject, accessToken);
  return { id, displayName };
}

/**
 * 既存の identity に別のログイン手段を追加で結び付けます。
 * @param env 環境変数
 * @param identityId 既存の identity
 * @param provider プロバイダID
 * @param subject プロバイダ側のユーザID
 * @param accessToken プロバイダ側のアクセストークン
 */
export async function linkIdentity(
  env: Env,
  identityId: string,
  provider: string,
  subject: string,
  accessToken: string | null
): Promise<void> {
  await env.DB.prepare(
    'INSERT OR REPLACE INTO identity_links (provider, subject, identity_id, access_token) VALUES (?, ?, ?, ?)'
  )
    .bind(provider, subject, identityId, accessToken)
    .run();
}

/**
 * identity を取得します。
 * @param env 環境変数
 * @param id identity のID
 * @returns 見つからなければ null
 */
export async function getIdentity(env: Env, id: string): Promise<Identity | null> {
  const row = await env.DB.prepare('SELECT id, display_name FROM identities WHERE id = ?')
    .bind(id)
    .first<{ id: string; display_name: string }>();
  return row ? { id: row.id, displayName: row.display_name } : null;
}

/**
 * identity に結び付いているログイン手段を列挙します。
 *
 * verified を主張できるかの判定に使います。判定にはプロバイダ側のユーザIDが要るためです。
 * @param env 環境変数
 * @param identityId identity のID
 * @returns プロバイダIDとプロバイダ側ユーザIDの組
 */
export async function linksOf(
  env: Env,
  identityId: string
): Promise<{ provider: string; subject: string; accessToken: string | null }[]> {
  const { results } = await env.DB.prepare(
    'SELECT provider, subject, access_token FROM identity_links WHERE identity_id = ?'
  )
    .bind(identityId)
    .all<{ provider: string; subject: string; access_token: string | null }>();
  return (results ?? []).map((r) => ({ provider: r.provider, subject: r.subject, accessToken: r.access_token }));
}

/**
 * プロバイダ側のユーザに結び付いた identity を探します。
 * @param env 環境変数
 * @param provider プロバイダID
 * @param subject プロバイダ側のユーザID
 */
async function findLinked(env: Env, provider: string, subject: string): Promise<Identity | null> {
  const row = await env.DB.prepare(
    `SELECT i.id AS id, i.display_name AS display_name
     FROM identity_links l JOIN identities i ON i.id = l.identity_id
     WHERE l.provider = ? AND l.subject = ?`
  )
    .bind(provider, subject)
    .first<{ id: string; display_name: string }>();
  return row ? { id: row.id, displayName: row.display_name } : null;
}
