/**
 * @fileoverview 共有ネームスペースの定義。
 *
 * `c` / `forge` / `neoforge` は複数の mod が同じタグを分担して定義する共通タグの置き場で、
 * `minecraft` はバニラです。いずれも特定の投稿者のものではないため、先着による所有権の確保
 * （`authorizeWrite`）の対象から外します。ここを通してしまうと、最初に該当タグを含む jar を
 * 投げた人が共通タグ全体を占有し、以降の投稿が拒否されます。
 */

/** 誰の所有物にもならないネームスペース。 */
export const SHARED_NAMESPACES: readonly string[] = ['c', 'forge', 'neoforge', 'minecraft'];

/**
 * 共有ネームスペースかどうかを返します。
 * @param ns ネームスペース
 */
export function isSharedNamespace(ns: string): boolean {
  return SHARED_NAMESPACES.includes(ns);
}
