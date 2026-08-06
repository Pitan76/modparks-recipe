/**
 * @fileoverview 検索ページが叩くAPIと、レシピIDの扱い。
 */

/** 索引に載る1レシピ。 */
export type RecipeEntry = { id: string; result?: string | null };

/** ネームスペースごとのアセットバージョン。画像URLの `?v=` に載せます。 */
export type Versions = Record<string, string>;

/** アイテムID -> 表示名。 */
export type Names = Record<string, string>;

/** R2直接配信の情報。`base` が空なら直接配信は無効です。 */
export type Assets = { base: string; rv: string };

/** 索引の取得結果。 */
export type RecipeIndex = { recipes: RecipeEntry[]; versions: Versions | null; assets: Assets | null };

/** Worker側の DEFAULT_SCALE。R2の直接URLを組むにはキーと同じ値が要ります。 */
const DEFAULT_SCALE = 2;

/** Worker側の既定 tagOffset。 */
const DEFAULT_TAG_OFFSET = 0;

/** 1回の名前解決で送るID数。 */
const NAME_BATCH = 50;

/** 名前解決の同時実行数。全件検索時に数十本を一斉に投げないための上限です。 */
const NAME_CONCURRENCY = 6;

/**
 * レシピIDをネームスペースとパスに割ります。
 * @param full `ns:id` 形式のID（`:` が無ければ minecraft 扱い）
 */
export function splitId(full: string): { ns: string; id: string } {
  const i = full.indexOf(':');
  if (i === -1) return { ns: 'minecraft', id: full };
  return { ns: full.slice(0, i), id: full.slice(i + 1) };
}

/**
 * レシピ画像のURLを組み立てます。
 *
 * `?v=` を付けるとURL自体がバージョンを内包するため、エッジもブラウザもキャッシュでき、
 * サーバ側のバージョン参照も省けます。付けないと毎回レンダリングが走りかねません。
 * @param recipeId レシピID
 * @param fmt 画像形式
 * @param versions ネームスペースごとのバージョン
 */
export function imagePath(recipeId: string, fmt: string, versions: Versions | null): string {
  const p = splitId(recipeId);
  const version = versions?.[p.ns];
  const base = `/api/${encodeURIComponent(p.ns)}/${encodeURIComponent(p.id)}.${fmt}`;
  return version ? `${base}?v=${encodeURIComponent(version)}` : base;
}

/**
 * レンダリング済み画像をR2から直接取る URL を組み立てます。
 *
 * Worker を通さないぶん Worker 実行が丸ごと消えますが、未レンダリングの画像は 404 になります。
 * 呼び出し側は失敗時に {@link imagePath} へフォールバックしてください（Worker が生成してR2へ
 * 保存するので、次回からは直接ヒットします）。
 * @param recipeId レシピID
 * @param fmt 画像形式
 * @param versions ネームスペースごとのバージョン
 * @param assets 配信情報（`/api/list.json` の `assets`）
 * @returns 直接配信できないときは null
 */
export function imageCdnPath(
  recipeId: string,
  fmt: string,
  versions: Versions | null,
  assets: Assets | null
): string | null {
  if (!assets?.base) return null;

  const p = splitId(recipeId);
  const version = versions?.[p.ns];
  // バージョンが無いとサーバ側が引いた値がキーに入るため、クライアントからは行き先を当てられない。
  if (!version || version === '0') return null;

  const key = `cache/img/${assets.rv}/${p.ns}/${version}/${p.id}@${DEFAULT_SCALE}+${DEFAULT_TAG_OFFSET}.${fmt}`;
  return `${assets.base}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * レシピ索引を取得します。
 * @returns 取得できなければ空の索引
 */
export async function fetchIndex(): Promise<RecipeIndex> {
  const res = await fetch('/api/list.json');
  if (!res.ok) return { recipes: [], versions: null, assets: null };

  const body = (await res.json()) as { recipes?: RecipeEntry[]; ids?: string[]; versions?: Versions; assets?: Assets };
  const versions = body.versions ?? null;
  const assets = body.assets ?? null;
  if (Array.isArray(body.recipes)) return { recipes: body.recipes, versions, assets };
  if (Array.isArray(body.ids)) return { recipes: body.ids.map((id) => ({ id, result: id })), versions, assets };
  return { recipes: [], versions, assets };
}

/**
 * 表示名の静的索引を取得します。ページ送りのたびに名前を引かずに済みます。
 * @param locale Minecraftのロケール名（例: `ja_jp`）
 */
export async function fetchNameIndex(locale: string): Promise<Names> {
  const res = await fetch(`/api/names.json?lang=${encodeURIComponent(locale)}`);
  if (!res.ok) return {};

  const body = (await res.json()) as { names?: Names };
  return body.names ?? {};
}

/**
 * 静的索引から漏れたIDの表示名を引きます。
 * @param ids アイテムID一覧
 * @param locale Minecraftのロケール名
 * @param onLoaded 取得できた分を都度受け取るコールバック
 */
export async function fetchNames(ids: string[], locale: string, onLoaded: (names: Names) => void): Promise<void> {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += NAME_BATCH) batches.push(ids.slice(i, i + NAME_BATCH));

  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < batches.length) {
      const batch = batches[next++];
      const names = await fetchNameBatch(batch, locale);
      if (Object.keys(names).length > 0) onLoaded(names);
    }
  };
  await Promise.all(Array.from({ length: Math.min(NAME_CONCURRENCY, batches.length) }, worker));
}

/**
 * 1バッチ分の表示名を引きます。失敗は空として扱い、他のバッチを巻き込みません。
 * @param ids アイテムID一覧
 * @param locale Minecraftのロケール名
 */
async function fetchNameBatch(ids: string[], locale: string): Promise<Names> {
  try {
    const res = await fetch(`/api/names?lang=${locale}&ids=${encodeURIComponent(ids.join(','))}`);
    if (!res.ok) return {};
    const body = (await res.json()) as { names?: Names };
    return body.names ?? {};
  } catch {
    return {};
  }
}
