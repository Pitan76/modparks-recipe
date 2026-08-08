/**
 * @fileoverview 管理ルートの入口判定。
 *
 * 管理操作は共有シークレット1本で守ります。判定を書き写すと、1か所だけ緩いルートが
 * 生まれても気付けないため、ここを通します。
 */

import type { Env } from '../minecraft';

/**
 * 管理者かどうかを判定します。
 *
 * `ADMIN_SECRET` が未設定の環境では常に拒否します。未設定を「誰でも通す」と解釈すると、
 * 設定を忘れた環境が全開になります。
 * @param c Honoのコンテキストオブジェクト
 * @returns 管理者でなければ、そのまま返せる拒否応答
 */
export function requireAdmin(c: any): Response | null {
  const env: Env = c.env;
  const secret = c.req.query('secret');
  if (!env.ADMIN_SECRET || secret !== env.ADMIN_SECRET) return c.text('Unauthorized', 401);
  return null;
}
