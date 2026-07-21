/**
 * @fileoverview ID処理ユーティリティ。
 */

/**
 * ネームスペース付きID（例: "minecraft:stone"）を分割して、ネームスペースとパスのオブジェクトを返します。
 * ネームスペースが省略されている場合はデフォルトで "minecraft" になります。
 * @param id アイテムID文字列
 */
export function parseNamespacedId(id: string): { namespace: string; path: string } {
  if (id.includes(':')) {
    const [namespace, ...rest] = id.split(':');
    return { namespace, path: rest.join(':') };
  }
  return { namespace: 'minecraft', path: id };
}
