/**
 * @fileoverview 書き込みAPIが受け取るネームスペースとパスの検証。
 *
 * これらは R2 のオブジェクトキーにそのまま連結されます。R2 のキーは単なる文字列なので
 * `../` でバケットの外に出られるわけではありませんが、`assets/ns/textures/../x.png` のような
 * 読み出し経路と一致しないキーを作れてしまい、書けたのに一生参照されないオブジェクトが残ります。
 * 意図しない場所を指すキーは、作られる前に弾きます。
 */

/** ネームスペースとして許す形。Minecraft のリソースIDと同じ文字種です。 */
const NAMESPACE_PATTERN = /^[a-z0-9_.-]{1,64}$/;

/** パスの長さ上限。R2 のキー長（1024バイト）に対して十分手前で切ります。 */
const MAX_PATH_LENGTH = 255;

/**
 * ネームスペースがR2キーとして安全な形かどうかを判定します。
 * @param namespace ネームスペース（例: "mymod"）
 */
export function isValidNamespace(namespace: string): boolean {
  return NAMESPACE_PATTERN.test(namespace);
}

/**
 * アセット/データのパスがR2キーとして安全な形かどうかを判定します。
 *
 * 中身の文字種までは絞りません（既存の取り込み経路が置いているパスを弾かないため）。
 * 位置を変えてしまうもの（絶対パス、`..`、バックスラッシュ、制御文字）だけを拒否します。
 * @param path テクスチャ/モデル/タグなどのパス（例: "item/foo.png"）
 */
export function isSafePath(path: string): boolean {
  if (!path || path.length > MAX_PATH_LENGTH) return false;
  if (path.startsWith('/') || path.includes('\\')) return false;
  if (path.includes('//')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(path)) return false;
  return !path.split('/').includes('..');
}

/**
 * ネームスペースとパスの両方が安全かどうかを判定します。
 * @param namespace ネームスペース
 * @param path パス
 */
export function isSafeAssetTarget(namespace: string, path: string): boolean {
  return isValidNamespace(namespace) && isSafePath(path);
}
