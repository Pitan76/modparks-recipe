/**
 * @fileoverview 投入先に既にあるキーを数え上げます。差分だけを送るために使います。
 *
 * バニラ資産は数千件あり、毎回すべて送り直すと転送も書き込みも無駄なうえ、`minecraft` は共有
 * ネームスペースなのでバッチごとにバージョンが動いて全画像のキャッシュが繰り返し捨てられます。
 */

/** R2 の一覧を1000件ずつ辿るときの1回あたりの件数。`/admin/ls` の上限です。 */
const PAGE_SIZE = 1000;

/**
 * 接頭辞配下に既にあるキーを全件集めます。
 * @param baseUrl サーバのベースURL（末尾スラッシュ無し）
 * @param adminSecret 管理用シークレット
 * @param prefix R2のキー接頭辞
 * @returns 既存キーの集合
 */
export async function existingKeys(baseUrl: string, adminSecret: string, prefix: string): Promise<Set<string>> {
  const keys = new Set<string>();

  let cursor: string | null = null;
  do {
    const url = new URL(`${baseUrl}/admin/ls`);
    url.searchParams.set('secret', adminSecret);
    url.searchParams.set('prefix', prefix);
    url.searchParams.set('limit', String(PAGE_SIZE));
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Listing ${prefix} failed: ${res.status} ${await res.text()}`);

    const page = (await res.json()) as { objects: { key: string }[]; cursor: string | null };
    for (const obj of page.objects) keys.add(obj.key);
    cursor = page.cursor;
  } while (cursor);

  return keys;
}

/**
 * まだ投入先に無いものだけを残します。
 * @param entries 種別内のパスと中身のマップ
 * @param prefix R2のキー接頭辞
 * @param present 既存キーの集合
 */
export function missingOnly(
  entries: Record<string, string>,
  prefix: string,
  present: Set<string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, body] of Object.entries(entries)) {
    if (!present.has(`${prefix}${path}.json`)) out[path] = body;
  }
  return out;
}
