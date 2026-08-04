/**
 * @fileoverview ログイン手段（アイデンティティプロバイダ）の抽象と登録。
 *
 * 追加は実装1本と環境変数の設定だけ、取り外しは環境変数を消すだけで済みます。
 * 所有権は identity 側に紐付いているため、プロバイダを外しても既存の所有権は残り、
 * そのプロバイダ経由での「再ログイン」だけができなくなります。
 */

import type { Env } from '../minecraft';

/**
 * プロバイダが返す、プロバイダ側のユーザ。
 *
 * `accessToken` を持ち回るのは、所有 ns の照会が「本人のトークンで本人の情報を引く」形だからです。
 * クライアント資格情報で他人の情報を引ける口を要求せずに済みます。
 */
export type ProviderUser = { subject: string; displayName: string; accessToken: string };

/** ログイン手段の実装が満たすべき形。 */
export interface IdentityProvider {
  readonly id: string;
  /**
   * 認可画面のURLを組み立てます。
   * @param state CSRF対策のための状態値
   * @param redirectUri コールバックURL
   */
  authorizeUrl(state: string, redirectUri: string): string;
  /**
   * コールバックを検証し、プロバイダ側のユーザを返します。
   * @param query コールバックのクエリ
   * @param redirectUri 認可時に使ったコールバックURL
   */
  verify(query: URLSearchParams, redirectUri: string): Promise<ProviderUser | null>;
  /**
   * verified を主張できる namespace を返します。
   *
   * 実装しないプロバイダ経由のユーザは unverified しか作れません。
   * @param subject プロバイダ側のユーザID
   * @param accessToken そのユーザのアクセストークン
   */
  ownedNamespaces?(subject: string, accessToken: string): Promise<string[]>;
}

/**
 * 有効なプロバイダを環境変数から組み立てます。
 * @param env 環境変数
 * @returns プロバイダID -> 実装
 */
export function providersOf(env: Env): Map<string, IdentityProvider> {
  const map = new Map<string, IdentityProvider>();
  if (env.MODPARKS_URL && env.MODPARKS_CLIENT_ID && env.MODPARKS_CLIENT_SECRET) {
    map.set('modparks', modparksProvider(env));
  }
  return map;
}

/**
 * ModParks アカウントを使うプロバイダ。
 *
 * ModParks は OIDC プロバイダを備えているため、その認可コードフローに素直に乗ります。
 * エンドポイントはディスカバリ文書（`/.well-known/openid-configuration`）に載っているものです。
 * @param env 環境変数
 */
function modparksProvider(env: Env): IdentityProvider {
  const base = env.MODPARKS_URL!.replace(/\/$/, '');

  return {
    id: 'modparks',

    authorizeUrl(state: string, redirectUri: string): string {
      const url = new URL(`${base}/api/oauth/authorize`);
      url.searchParams.set('client_id', env.MODPARKS_CLIENT_ID!);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      // profile:read は本人特定に、projects:read は verified 判定（所有 ns の照会）に要る。
      url.searchParams.set('scope', 'openid profile:read projects:read');
      url.searchParams.set('state', state);
      return url.toString();
    },

    async verify(query: URLSearchParams, redirectUri: string): Promise<ProviderUser | null> {
      const code = query.get('code');
      if (!code) return null;

      const token = await exchangeCode(base, env, code, redirectUri);
      if (!token) return null;

      const user = await fetchUser(base, token);
      return user && { ...user, accessToken: token };
    },

    async ownedNamespaces(_subject: string, accessToken: string): Promise<string[]> {
      const res = await fetch(`${base}/api/v2/me/recipe-namespaces`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return [];

      const body = (await res.json()) as { namespaces?: unknown };
      return Array.isArray(body.namespaces) ? body.namespaces.map(String) : [];
    },
  };
}

/**
 * 認可コードをアクセストークンへ交換します。
 * @param base ModParks のベースURL
 * @param env 環境変数
 * @param code 認可コード
 * @param redirectUri 認可時に使ったコールバックURL
 * @returns アクセストークン。失敗なら null
 */
async function exchangeCode(base: string, env: Env, code: string, redirectUri: string): Promise<string | null> {
  const res = await fetch(`${base}/api/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: env.MODPARKS_CLIENT_ID!,
      client_secret: env.MODPARKS_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) return null;

  const body = (await res.json()) as { access_token?: string };
  return body.access_token ?? null;
}

/**
 * アクセストークンでユーザ情報を取得します。
 * @param base ModParks のベースURL
 * @param token アクセストークン
 * @returns プロバイダ側のユーザ。失敗なら null
 */
async function fetchUser(base: string, token: string): Promise<Omit<ProviderUser, 'accessToken'> | null> {
  const res = await fetch(`${base}/api/oauth/userinfo`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;

  const claims = (await res.json()) as { sub?: string; name?: string; preferred_username?: string };
  if (!claims.sub) return null;
  return { subject: claims.sub, displayName: claims.name ?? claims.preferred_username ?? claims.sub };
}
