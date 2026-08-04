/**
 * @fileoverview ログインと namespace の所有権主張のルート。
 *
 * ログイン手段はプロバイダ実装に閉じており、ここはその出入口だけを持ちます。
 * 発行するトークンは mp-recipe 自身のもので、プロバイダを外しても書き込み権限は失われません。
 */

import { Hono } from 'hono';
import { Env } from '../utils/minecraft';
import { isValidNamespace } from '../utils/asset-path';
import { providersOf } from '../utils/auth/providers';
import { getIdentity, linksOf, resolveIdentity } from '../utils/auth/identity';
import { issueToken, verifyToken } from '../utils/auth/tokens';
import { claimNamespace, getOwnership, type Trust } from '../utils/auth/ownership';
import { remainingUploads } from '../utils/auth/quota';

export const authRoutes = new Hono<{ Bindings: Env }>();

/** ポータル用トークンの有効期間。長すぎると漏れたときの被害が伸びるため、投稿作業に足る長さにとどめます。 */
const UPLOAD_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 有効なログイン手段の一覧。ポータルがボタンを出し分けるために使います。 */
authRoutes.get('/auth/providers.json', (c) => {
  const providers = [...providersOf(c.env).values()].map((p) => ({ id: p.id, name: p.name }));
  return c.json({ providers });
});

// 認可画面へ送ります。state は Cookie に控え、コールバックで突き合わせます。
authRoutes.get('/auth/:provider/start', (c) => {
  const provider = providersOf(c.env).get(c.req.param('provider'));
  if (!provider) return c.text('Unknown provider', 404);

  const state = crypto.randomUUID();
  c.header('Set-Cookie', `mpr_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`, { append: true });

  // ブラウザから来た場合の戻り先。オープンリダイレクタにしないため自サイト内のパスだけ受けます。
  const back = c.req.query('redirect');
  if (back?.startsWith('/') && !back.startsWith('//')) {
    c.header('Set-Cookie', `mpr_back=${encodeURIComponent(back)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`, { append: true });
  }
  return c.redirect(provider.authorizeUrl(state, redirectUriOf(c)));
});

// コールバック。identity を解決し、投稿用トークンを発行します。
authRoutes.get('/auth/:provider/callback', async (c) => {
  const id = c.req.param('provider');
  const provider = providersOf(c.env).get(id);
  if (!provider) return c.text('Unknown provider', 404);

  const url = new URL(c.req.url);
  if (!stateMatches(c, url.searchParams.get('state'))) return c.text('Invalid state', 400);

  const user = await provider.verify(url.searchParams, redirectUriOf(c));
  if (!user) return c.text('Authentication failed', 401);

  const identity = await resolveIdentity(c.env, id, user.subject, user.displayName, user.accessToken);
  const token = await issueToken(c.env, identity.id, 'upload', UPLOAD_TOKEN_TTL_MS);

  // ブラウザ経由ならページへ戻す。トークンはフラグメントに載せるため、Referer や
  // サーバのアクセスログには残りません。API から直に叩かれた場合は JSON のまま返します。
  const back = cookieOf(c, 'mpr_back');
  if (back) return c.redirect(`${decodeURIComponent(back)}#token=${token}`);
  return c.json({ ok: true, identity: { id: identity.id, displayName: identity.displayName }, token });
});

/** ログイン中の主体と、その日の残り投稿数。ポータルの表示に使います。 */
authRoutes.get('/auth/me', async (c) => {
  const grant = await verifyToken(c.env, bearerOf(c));
  if (!grant) return c.text('Unauthorized', 401);

  const identity = await getIdentity(c.env, grant.identityId);
  if (!identity) return c.text('Unauthorized', 401);

  return c.json({ displayName: identity.displayName, remaining: await remainingUploads(c.env, grant.identityId) });
});

// namespace の所有権を主張します。ModParks 側で所有が確認できれば verified になります。
authRoutes.post('/api/:namespace/claim', async (c) => {
  const { namespace } = c.req.param();
  if (!isValidNamespace(namespace)) return c.text('Invalid namespace', 400);

  const grant = await verifyToken(c.env, bearerOf(c));
  if (!grant) return c.text('Unauthorized', 401);

  const trust = await trustFor(c.env, grant.identityId, namespace);
  const result = await claimNamespace(c.env, namespace, grant.identityId, trust);
  if (!result.ok) {
    return c.json({ ok: false, reason: result.reason }, result.reason === 'limit' ? 429 : 409);
  }

  // namespace ごとのトークンを別に出す。投稿用トークンをそのまま書き込みに使わせると、
  // 1本漏れただけでその identity が持つ全 namespace に書かれる。
  const token = await issueToken(c.env, grant.identityId, `ns:${namespace}`);
  return c.json({ ok: true, namespace, trust, takenOver: result.takenOver, token });
});

/** namespace の所有状況。バッジ表示のために公開します（所有者の内部IDは出しません）。 */
authRoutes.get('/api/:namespace/owner.json', async (c) => {
  const { namespace } = c.req.param();
  const ownership = await getOwnership(c.env, namespace);
  if (!ownership) return c.json({ namespace, claimed: false, trust: null, owner: null });

  const identity = await getIdentity(c.env, ownership.ownerId);
  return c.json({
    namespace,
    claimed: true,
    trust: ownership.trust,
    owner: identity?.displayName ?? null,
    claimedAt: ownership.claimedAt,
  });
});

/**
 * その主体がこの namespace について主張できる信頼度を決めます。
 *
 * `ownedNamespaces` を実装するプロバイダ（ModParks）に結び付いていて、かつその一覧に
 * 含まれている場合だけ verified です。自己申告は一切見ません。
 * @param env 環境変数
 * @param identityId 主体のID
 * @param ns ネームスペース
 */
async function trustFor(env: Env, identityId: string, ns: string): Promise<Trust> {
  const providers = providersOf(env);
  for (const link of await linksOf(env, identityId)) {
    const provider = providers.get(link.provider);
    if (!provider?.ownedNamespaces || !link.accessToken) continue;
    if ((await provider.ownedNamespaces(link.subject, link.accessToken)).includes(ns)) return 'verified';
  }
  return 'unverified';
}

/**
 * コールバックURLを組み立てます。認可時と検証時で完全に一致している必要があります。
 * @param c Honoのコンテキストオブジェクト
 */
function redirectUriOf(c: any): string {
  const url = new URL(c.req.url);
  return `${url.origin}/auth/${c.req.param('provider')}/callback`;
}

/**
 * Cookie に控えた state と一致するかを確かめます。
 * @param c Honoのコンテキストオブジェクト
 * @param state コールバックが返した state
 */
function stateMatches(c: any, state: string | null): boolean {
  return !!state && cookieOf(c, 'mpr_state') === state;
}

/**
 * Cookie を1つ取り出します。
 * @param c Honoのコンテキストオブジェクト
 * @param name Cookie名
 * @returns 値。無ければ null
 */
function cookieOf(c: any, name: string): string | null {
  const matched = new RegExp(`(?:^|;\s*)${name}=([^;]+)`).exec(c.req.header('Cookie') || '');
  return matched ? matched[1] : null;
}

/**
 * Authorization ヘッダまたは `?token=` から生トークンを取り出します。
 * @param c Honoのコンテキストオブジェクト
 */
function bearerOf(c: any): string {
  const header = c.req.header('Authorization') || '';
  return header.replace(/^Bearer\s+/i, '') || c.req.query('token') || '';
}
