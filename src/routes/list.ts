/**
 * @fileoverview レシピインデックスの配信ルート定義。
 *
 * 全体版（`/api/list.json`）とネームスペース版（`/api/:namespace/list.json`）があります。
 * 1つのModのページを描くのに全Modの索引を転送するのは無駄なので、通常はネームスペース版を使ってください。
 */

import { Hono } from 'hono';
import type { Env } from '../utils/minecraft';
import type { IndexEntry } from '../utils/recipe-store';
import { getAllVersions, getAssetVersion } from '../utils/cache-version';
import { resolveNames, isValidLocale } from '../utils/lang-store';

export const listRoutes = new Hono<{ Bindings: Env }>();

const INDEX_KEY = 'index/recipes.json';

/**
 * `versions` が変わると画像URLも変わるため、ここが古いと新しい画像に切り替わりません。
 * クライアント側の revalidate と歩調を合わせて短くしています。
 */
const INDEX_MAX_AGE = 60;

/** アイテム名まで載った1レシピの形。未翻訳ならIDがそのまま入ります。 */
type NamedEntry = IndexEntry & { name?: string };

/**
 * レシピインデックスを読み出します。
 * @param env 環境変数
 * @returns 索引エントリの配列。未生成なら空配列
 */
async function readIndex(env: Env): Promise<IndexEntry[]> {
  const obj = await env.BUCKET.get(INDEX_KEY);
  if (!obj) return [];

  const idx = await obj.json<{ recipes?: unknown }>();
  return Array.isArray(idx.recipes) ? (idx.recipes as IndexEntry[]) : [];
}

/**
 * 閲覧可能なレシピインデックスを全ネームスペース分まとめて返します。
 *
 * ネームスペースごとのアセットバージョンを `versions` として同梱します。クライアントはこれを
 * 画像URLの `?v=` に載せることで、画像1枚ごとのバージョン参照（R2 往復 約220ms）を消せます。
 * インデックスとバージョンは並列に読むため、この同梱による遅延の増加はありません。
 */
listRoutes.get('/api/list.json', async (c) => {
  const [obj, versions] = await Promise.all([c.env.BUCKET.get(INDEX_KEY), getAllVersions(c.env)]);
  if (!obj) return c.json({ count: 0, versions, recipes: [] });

  const index = await obj.json<Record<string, unknown>>();
  return c.json({ ...index, versions }, 200, {
    'Cache-Control': `public, max-age=${INDEX_MAX_AGE}`,
  });
});

/**
 * 1ネームスペース分のレシピインデックスを返します。
 *
 * `?lang=<locale>` を付けると各エントリに完成品のアイテム名（`name`）を同梱します。
 * 名前解決を別リクエストに分けずに済むため、一覧表示は1往復で完結します。
 * 未翻訳のアイテムにはIDが入るため、呼び出し側は `name` をそのまま表示できます。
 */
listRoutes.get('/api/:namespace/list.json', async (c) => {
  const { namespace } = c.req.param();
  const locale = c.req.query('lang');
  if (locale && !isValidLocale(locale)) return c.text('Invalid locale', 400);

  const [all, version] = await Promise.all([readIndex(c.env), getAssetVersion(c.env, namespace)]);
  const recipes: NamedEntry[] = all.filter((r) => r.id.startsWith(`${namespace}:`));

  if (locale) await attachNames(c.env, recipes, locale);

  return c.json({ namespace, version, count: recipes.length, recipes }, 200, {
    // `?v=` 付きは内容が一意に定まるため恒久キャッシュにできます。
    'Cache-Control': c.req.query('v')
      ? 'public, max-age=31536000, immutable'
      : `public, max-age=${INDEX_MAX_AGE}`,
  });
});

/**
 * 各エントリに完成品のアイテム名を書き込みます。
 * 完成品は別ネームスペース（`minecraft:` など）を指すことがあるため、解決はIDに対して行います。
 *
 * 未翻訳のアイテムにはIDをそのまま入れます。呼び出し側ごとにフォールバックを書くと表示が揺れるため、
 * ここで一度だけ決めます。
 * @param env 環境変数
 * @param recipes 対象のエントリ（破壊的に更新します）
 * @param locale ロケール名
 */
async function attachNames(env: Env, recipes: NamedEntry[], locale: string): Promise<void> {
  const ids = recipes.map((r) => r.result).filter((r): r is string => !!r);
  const names = ids.length > 0 ? await resolveNames(env, ids, locale) : {};

  for (const entry of recipes) {
    const fallback = entry.result ?? entry.id;
    entry.name = (entry.result && names[entry.result]) || fallback;
  }
}
