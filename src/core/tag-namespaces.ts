/**
 * @fileoverview タグを絵に落とすときに、どのネームスペースの構成アイテムを使うかの決定。
 *
 * `#c:planks` のような共通タグは、木材を大量に足す mod が入るほど構成アイテムが膨らみます。
 * そのまま順に回すと、GIF のコマも PNG の `tagOffset` も、見た人の知らない mod のアイテムばかりを
 * 指すようになります。既定をバニラだけに絞り、必要な mod は呼び出し側が明示的に足す形にします。
 *
 * 依存を持たない純粋な形にしてあるのは、Worker とブラウザの双方から同じ判定を読ませるためです。
 */

/** 既定で採用するネームスペース。指定が無いときはここだけを使います。 */
export const DEFAULT_TAG_NAMESPACES: readonly string[] = ['minecraft'];

/** 「全部使う」を表す指定値。 */
export const ALL_TAG_NAMESPACES = '*';

/**
 * 採用するネームスペースの集合。`null` は絞り込みなし（全ネームスペース）を表します。
 */
export type TagNamespaceFilter = readonly string[] | null;

/**
 * 問い合わせ文字列を絞り込み条件に変換します。
 *
 * 指定は既定への「追加」です。`minecraft` を毎回書かせると、書き忘れたときに
 * バニラのアイテムが候補から消えて絵が変わってしまいます。
 * @param value カンマ区切りのネームスペース、または `*`（全部）。未指定なら既定
 * @returns 絞り込み条件
 */
export function parseTagNamespaces(value: string | null | undefined): TagNamespaceFilter {
  const raw = (value ?? '').trim();
  if (!raw) return DEFAULT_TAG_NAMESPACES;
  if (raw === ALL_TAG_NAMESPACES || raw.toLowerCase() === 'all') return null;

  const extra = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (extra.length === 0) return DEFAULT_TAG_NAMESPACES;
  return Array.from(new Set([...DEFAULT_TAG_NAMESPACES, ...extra]));
}

/**
 * 絞り込み条件をキャッシュキーの一部にします。
 *
 * 既定では空文字を返します。既定の絵のキーが変わると、クライアントが手元で組み立てている
 * 直リンクが一斉に外れるためです。
 * @param filter 絞り込み条件
 * @returns キーに足す文字列（既定なら空）
 */
export function tagNamespaceKey(filter: TagNamespaceFilter): string {
  if (filter === null) return `~${ALL_TAG_NAMESPACES}`;
  if (isDefaultFilter(filter)) return '';
  return `~${[...filter].sort().join('.')}`;
}

/**
 * 既定と同じ絞り込みかどうかを返します。
 * @param filter 絞り込み条件
 */
function isDefaultFilter(filter: readonly string[]): boolean {
  return filter.length === DEFAULT_TAG_NAMESPACES.length
    && filter.every((ns) => DEFAULT_TAG_NAMESPACES.includes(ns));
}

/**
 * タグの構成要素からネームスペースを取り出します。
 *
 * 要素は `"minecraft:oak_planks"` のほか `{ "id": "...", "required": false }` の形も取ります。
 * @param value `values` の要素
 * @returns ネームスペース。判別できなければ null
 */
function namespaceOf(value: unknown): string | null {
  const id = typeof value === 'string' ? value : (value as { id?: unknown } | null)?.id;
  if (typeof id !== 'string') return null;
  const body = id.startsWith('#') ? id.slice(1) : id;
  const colon = body.indexOf(':');
  return colon < 0 ? 'minecraft' : body.slice(0, colon);
}

/**
 * 別のタグへの参照かどうかを返します。
 * @param value `values` の要素
 */
function isTagReference(value: unknown): boolean {
  const id = typeof value === 'string' ? value : (value as { id?: unknown } | null)?.id;
  return typeof id === 'string' && id.startsWith('#');
}

/**
 * 構成アイテムのうち、実際に絵として回す候補を選びます。
 *
 * 絞り込んだ結果が空になるタグ（mod のアイテムしか持たないもの）では、絞り込みを諦めて
 * 元の並びを返します。ここで空を返すと、そのスロットが何も描かれない絵になり、
 * 絞り込み前より悪くなるためです。
 *
 * 別タグへの参照は、指すのがタグ自身のネームスペースであってアイテムのものではないので
 * 常に残します。参照先を辿った時点で同じ絞り込みが改めて効きます。
 * @param values タグの構成要素
 * @param filter 絞り込み条件
 * @returns 回す候補
 */
export function pickTagCandidates<T>(values: readonly T[], filter: TagNamespaceFilter): readonly T[] {
  if (filter === null) return values;

  const picked = values.filter((v) => isTagReference(v) || filter.includes(namespaceOf(v) ?? ''));
  return picked.length > 0 ? picked : values;
}
