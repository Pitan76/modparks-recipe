/**
 * @fileoverview 書き込みAPIの入口判定。「誰が」「どの namespace に」書けるかをここで一本化します。
 *
 * 共有シークレット（ModParks の取り込みパイプラインと管理スクリプト）と、
 * トークン（ポータル経由の投稿者）の両方を受けます。呼び出し側は結果の `identityId` と `trust` を
 * そのまま build の素性に流せます。
 */

import { isSharedNamespace } from '../../core/namespaces';
import type { Env } from '../minecraft';
import { authorized } from '../http';
import { canWrite, claimNamespace, getOwnership, type Trust } from './ownership';
import { scopeAllows, verifyToken } from './tokens';

/** 書き込みが認められた主体。共有シークレット経由では `identityId` を持ちません。 */
export type WriteGrant = { identityId: string | null; trust: Trust };

/** 拒否理由。 */
export type WriteDenial = { reason: 'unauthorized' | 'forbidden' | 'limit' };

/**
 * 対象 namespace への書き込みを許可するかを判定します。
 *
 * 未所有の namespace はトークン主体が先着で確保します。確保できなかった（上限超過）場合は
 * 書き込ませません。所有していない namespace への書き込みは常に拒否です。
 * @param c Honoのコンテキストオブジェクト
 * @param ns 対象ネームスペース
 * @returns 許可された主体、または拒否理由
 */
export async function authorizeWrite(c: any, ns: string): Promise<WriteGrant | WriteDenial> {
  // 共有シークレットは ModParks 側の取り込みと管理スクリプトの経路。所有権判定を通しません。
  if (authorized(c)) return { identityId: null, trust: 'verified' };

  const env: Env = c.env;
  const token = bearerOf(c);
  if (!token) return { reason: 'unauthorized' };

  const grant = await verifyToken(env, token);
  if (!grant || !scopeAllows(grant.scope, ns)) return { reason: 'forbidden' };

  // 共有ネームスペースは誰の所有物にもしません。先着で確保させると、共通タグを含む jar を
  // 最初に投げた人が `c` を丸ごと占有し、以降の投稿が拒否されます。
  if (isSharedNamespace(ns)) return { identityId: grant.identityId, trust: 'unverified' };

  const owned = await getOwnership(env, ns);
  if (!owned) {
    const claimed = await claimNamespace(env, ns, grant.identityId, 'unverified');
    if (!claimed.ok) return { reason: claimed.reason === 'limit' ? 'limit' : 'forbidden' };
    return { identityId: grant.identityId, trust: 'unverified' };
  }

  if (!(await canWrite(env, ns, grant.identityId))) return { reason: 'forbidden' };
  return { identityId: grant.identityId, trust: owned.trust };
}

/**
 * 書き込みルートの先頭で呼ぶ判定。許可なら主体を、拒否ならそのまま返せる応答を返します。
 *
 * ミドルウェアにしていないのは、`/api/:namespace/*` に被せると画像GETや batch POST まで
 * 巻き込むためです。書き込みルートだけを明示的に通します。
 * @param c Honoのコンテキストオブジェクト
 * @param ns 対象ネームスペース
 * @returns 許可された主体、または拒否応答
 */
export async function requireWrite(c: any, ns: string): Promise<WriteGrant | Response> {
  const result = await authorizeWrite(c, ns);
  if (isDenied(result)) return c.text(messageOf(result), statusOf(result));
  return result;
}

/**
 * 拒否理由に対応する本文を返します。
 * @param denial 拒否理由
 */
function messageOf(denial: WriteDenial): string {
  if (denial.reason === 'unauthorized') return 'Unauthorized';
  if (denial.reason === 'limit') return 'Namespace limit reached';
  return 'Forbidden';
}

/**
 * 判定結果が拒否かどうかを返します。
 * @param result `authorizeWrite` の結果
 */
export function isDenied(result: WriteGrant | WriteDenial): result is WriteDenial {
  return 'reason' in result;
}

/**
 * 拒否理由に対応するHTTPステータスを返します。
 * @param denial 拒否理由
 */
export function statusOf(denial: WriteDenial): 401 | 403 | 429 {
  if (denial.reason === 'unauthorized') return 401;
  if (denial.reason === 'limit') return 429;
  return 403;
}

/**
 * Authorization ヘッダまたは `?token=` から生トークンを取り出します。
 *
 * `?secret=` は共有シークレット用に既に使われているため、トークンは別名にしています。
 * 同じ名前にすると、どちらとして検証すべきかが決まりません。
 * @param c Honoのコンテキストオブジェクト
 */
function bearerOf(c: any): string | null {
  const header = c.req.header('Authorization') || '';
  return header.replace(/^Bearer\s+/i, '') || c.req.query('token') || null;
}
