/**
 * @fileoverview アイテムIDから表示名を引くための静的索引。
 *
 * 表示名は言語ファイルからしか引けないため、素朴に作ると一覧を開くたびに
 * `/api/names` を何十回も叩くことになります。索引はレシピ索引の再構築と同時に作り、
 * クライアントには1回のGETで丸ごと渡します。
 *
 * 言語ファイルの読み出しはネームスペース単位なので、コストはネームスペース数に比例します。
 * レシピ件数には比例しません。
 */

import type { Env } from './minecraft';
import { DEFAULT_LOCALES, resolveNames } from './lang-store';

/**
 * 表示名索引のR2オブジェクトキーを組み立てます。
 * @param locale ロケール名（例: "ja_jp"）
 */
export function nameIndexKey(locale: string): string {
  return `index/names/${locale}.json`;
}

/**
 * 既定ロケール分の表示名索引を作り直します。
 * @param env 環境変数
 * @param itemIds 索引に載せるアイテムID一覧（重複可）
 */
export async function rebuildNameIndexes(env: Env, itemIds: string[]): Promise<void> {
  const ids = Array.from(new Set(itemIds.filter((id) => id.includes(':'))));
  await Promise.all(DEFAULT_LOCALES.map((locale) => rebuildNameIndex(env, ids, locale)));
}

/**
 * 1ロケール分の表示名索引を作り直します。
 * @param env 環境変数
 * @param ids 重複を除いたアイテムID一覧
 * @param locale ロケール名
 */
async function rebuildNameIndex(env: Env, ids: string[], locale: string): Promise<void> {
  const names = await resolveNames(env, ids, locale);
  await env.BUCKET.put(nameIndexKey(locale), JSON.stringify({ lang: locale, names }), {
    httpMetadata: { contentType: 'application/json' },
  });
}
