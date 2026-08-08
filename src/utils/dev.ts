/**
 * @fileoverview ローカル開発モードの判定。
 *
 * 本番と同じコードのまま手元で動かすと、外部プロバイダの認可（redirect_uri が localhost では
 * 登録できない）と日次の投稿枠が邪魔になります。どちらも「手元で試すため」だけの緩和なので、
 * 判定を1か所に集めて、緩めている場所を数えられるようにします。
 */

import type { Env } from './minecraft';

/**
 * ローカル開発モードか。
 *
 * `.dev.vars` にのみ書く前提の変数です。`wrangler.toml` の `[vars]` には無いため、
 * 本番で立てるには明示的にシークレットを追加する必要があります。
 * @param env 環境変数
 */
export const isDevMode = (env: Env): boolean => env.DEV_MODE === 'true';
