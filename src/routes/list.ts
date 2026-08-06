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
import { AssetSource } from '../utils/build/asset-source';
import { readChannels } from '../utils/build/channels';
import { foldBuild } from '../utils/build/manifest';
import { toChannel, resolveChannel } from '../utils/build/mc-version';
import { assetDelivery } from '../utils/image-cdn';
import { getRecipe } from '../utils/minecraft/data';
import { hasVariantTag } from '../utils/tag-variants';
import { runPool } from '../utils/pool';

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
  const cacheControl = { 'Cache-Control': `public, max-age=${INDEX_MAX_AGE}` };
  const assets = await assetDelivery(c.env);
  // 索引が未生成のときも同じだけキャッシュさせる。ここを素通しにすると、
  // 立ち上げ直後や再構築中に空応答のリクエストが全部オリジンまで来る。
  if (!obj) return c.json({ count: 0, versions, assets, recipes: [] }, 200, cacheControl);

  const index = await obj.json<Record<string, unknown>>();
  return c.json({ ...index, versions, assets }, 200, cacheControl);
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

  const wanted = toChannel(c.req.query('mc') ?? '');
  const src = new AssetSource(c.env, wanted);
  const listing = await namespaceListing(c.env, namespace, wanted, src);

  if (locale) await attachNames(c.env, listing.recipes, locale, src);

  return c.json({ namespace, ...listing, assets: await assetDelivery(c.env), count: listing.recipes.length }, 200, {
    // `?v=` 付きは内容が一意に定まるため恒久キャッシュにできます。
    'Cache-Control': c.req.query('v')
      ? 'public, max-age=31536000, immutable'
      : `public, max-age=${INDEX_MAX_AGE}`,
  });
});

/**
 * 1ネームスペース分の索引を、build があればそこから、無ければ従来の全体索引から作ります。
 *
 * build 経由なら `version` は build ID になります。内容ハッシュなので、クライアントが
 * `?v=` に載せた時点でそのURLは不変になり、恒久キャッシュが安全に効きます。
 * @param env 環境変数
 * @param ns ネームスペース
 * @param wanted 要求されたMCチャネル（未指定なら最新）
 * @param src アセット読み出し口
 */
async function namespaceListing(
  env: Env,
  ns: string,
  wanted: string | null,
  src: AssetSource
): Promise<{ version: string; mc: string | null; channels: string[]; recipes: NamedEntry[] }> {
  const channels = Object.keys(await readChannels(env, ns)).sort();
  const buildId = await src.buildOf(ns);

  if (buildId) {
    const folded = await foldBuild(env, ns, buildId);
    const recipes = (folded?.recipes ?? []) as NamedEntry[];
    await refineTagged(env, recipes, src);
    return {
      version: buildId.slice(0, 16),
      mc: resolveChannel(wanted, channels),
      channels,
      recipes,
    };
  }

  // build を持つのに要求MCで解決できなかった場合、従来索引へ落とすと全チャネルの合併を
  // 返してしまう。対応していないMCには何も返さないのが正しい。
  if (!(await src.isUnmigrated(ns))) return { version: '0', mc: null, channels, recipes: [] };

  const [all, version] = await Promise.all([readIndex(env), getAssetVersion(env, ns)]);
  const recipes = all.filter((r) => r.id.startsWith(`${ns}:`)) as NamedEntry[];
  await refineTagged(env, recipes, src);
  return { version, mc: null, channels, recipes };
}

/**
 * `tagged` を「実際に素材が切り替わるもの」に絞り込みます。
 *
 * 索引が持つのは「タグを使うか」までです。構成アイテムが1つのタグは絵が変わらないため、
 * ここでタグを展開して落とします。判定にタグ本体が要るので、取り込み時ではなく配信時に行います。
 *
 * 明示的に偽のエントリは触りません。値を持たないのは `tagged` が無かった頃の build なので、
 * そのときだけ本体を読んで判定します（build は内容ハッシュで固定され、後から書き換えられません）。
 * @param env 環境変数
 * @param recipes 索引エントリ群（その場で書き換えます）
 * @param src アセット読み出し口
 */
async function refineTagged(env: Env, recipes: NamedEntry[], src: AssetSource): Promise<void> {
  const candidates = recipes.filter((r) => r.tagged !== false);
  if (candidates.length === 0) return;

  await runPool(candidates, 20, async (entry) => {
    const data = await getRecipe(entry.id, env, src);
    entry.tagged = !!data && (await hasVariantTag(data, env, src));
  });
}

/**
 * 各エントリに完成品のアイテム名を書き込みます。
 * 完成品は別ネームスペース（`minecraft:` など）を指すことがあるため、解決はIDに対して行います。
 *
 * 未翻訳のアイテムにはIDをそのまま入れます。呼び出し側ごとにフォールバックを書くと表示が揺れるため、
 * ここで一度だけ決めます。
 * @param env 環境変数
 * @param recipes 対象のエントリ（破壊的に更新します）
 * @param locale ロケール名
 * @param src アセット読み出し口
 */
async function attachNames(env: Env, recipes: NamedEntry[], locale: string, src: AssetSource): Promise<void> {
  const ids = recipes.map((r) => r.result).filter((r): r is string => !!r);
  const names = ids.length > 0 ? await resolveNames(env, ids, locale, src) : {};

  for (const entry of recipes) {
    const fallback = entry.result ?? entry.id;
    entry.name = (entry.result && names[entry.result]) || fallback;
  }
}
