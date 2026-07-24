/**
 * @fileoverview アイソレート内で共有されるアイテムアイコンのメモ（L0キャッシュ）。
 *
 * アイテムアイコンは数千種なのに対しレシピは数万件あり、同じアイコンが極端に使い回されます。
 * それにも関わらず従来はレシピ1枚のレンダリングごとにキャッシュが作り直されており、
 * 同一アイソレート内ですら同じテクスチャを何度も R2 から取り直していました（1往復あたり実測 約220ms）。
 *
 * 解決失敗（透明アイコンへのフォールバック）も必ず記録します。失敗経路は最大5段の直列プローブを
 * 伴うため、記録しないと失敗するたびに 1秒超を再度支払うことになります。
 */

/** 保持する最大エントリ数。16x16 PNG の dataURL は概ね数百B〜1KB なので、上限でも数MB に収まります。 */
const MAX_ENTRIES = 3000;

/** `${ns}|${gen}|${path}` -> dataURL。Map の挿入順を LRU として利用します。 */
const memo = new Map<string, string>();

/** ネームスペース -> 現在のアセットバージョン。 */
const gens = new Map<string, string>();

/**
 * ネームスペースの現在のアセットバージョンを記録します。
 * 変化していた場合、そのネームスペースの古いエントリを破棄します。
 * @param ns ネームスペース
 * @param version アセットバージョン
 */
export function noteVersion(ns: string, version: string): void {
  if (gens.get(ns) === version) return;
  gens.set(ns, version);

  const stale = `${ns}|`;
  const keep = `${ns}|${version}|`;
  for (const key of memo.keys()) {
    if (key.startsWith(stale) && !key.startsWith(keep)) memo.delete(key);
  }
}

/**
 * メモのキーを組み立てます。バージョン未知のネームスペースは '?' 世代として扱い、
 * 後から `noteVersion` で確定した時点で破棄されます。
 */
function keyFor(ns: string, path: string): string {
  return `${ns}|${gens.get(ns) ?? '?'}|${path}`;
}

/**
 * メモからアイコンの dataURL を取得します。
 * @param ns ネームスペース
 * @param path テクスチャパス
 * @returns 記録済みなら dataURL、無ければ undefined
 */
export function getIcon(ns: string, path: string): string | undefined {
  const key = keyFor(ns, path);
  const hit = memo.get(key);
  if (hit === undefined) return undefined;

  // 参照されたエントリを末尾へ移し、LRU の新しい側に置く。
  memo.delete(key);
  memo.set(key, hit);
  return hit;
}

/**
 * アイコンの dataURL をメモに記録します。
 * @param ns ネームスペース
 * @param path テクスチャパス
 * @param dataUrl 記録する dataURL
 */
export function setIcon(ns: string, path: string, dataUrl: string): void {
  memo.set(keyFor(ns, path), dataUrl);
  while (memo.size > MAX_ENTRIES) {
    const oldest = memo.keys().next();
    if (oldest.done) break;
    memo.delete(oldest.value);
  }
}
