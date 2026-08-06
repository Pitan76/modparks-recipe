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

/**
 * 共通タグのネームスペースの読み替え表。
 *
 * 共通タグは Forge の `forge:` から `c:` へ移り、NeoForge も `c:` に揃いました。1.20.x 以前の
 * mod は今も `#forge:ingots/copper` を参照してくるため、実体が無いときの読み替え先を持ちます。
 */
const TAG_ALIASES: Record<string, string> = { forge: 'c', neoforge: 'c' };

/**
 * タグを引き直す先のネームスペースを返します。
 * @param ns 参照されたネームスペース
 * @returns 読み替え先。読み替え不要なら null
 */
export function tagAliasOf(ns: string): string | null {
  return TAG_ALIASES[ns] ?? null;
}
