/**
 * @fileoverview 検索ページが叩くAPIと、レシピIDの扱い。
 */

/** 索引に載る1レシピ。 */
export type RecipeEntry = { id: string; result?: string | null };

/** ネームスペースごとのアセットバージョン。画像URLの `?v=` に載せます。 */
export type Versions = Record<string, string>;

/** アイテムID -> 表示名。 */
export type Names = Record<string, string>;

/** 索引の取得結果。 */
export type RecipeIndex = { recipes: RecipeEntry[]; versions: Versions | null };

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
 * レシピ索引を取得します。
 * @returns 取得できなければ空の索引
 */
export async function fetchIndex(): Promise<RecipeIndex> {
  const res = await fetch('/api/list.json');
  if (!res.ok) return { recipes: [], versions: null };

  const body = (await res.json()) as { recipes?: RecipeEntry[]; ids?: string[]; versions?: Versions };
  const versions = body.versions ?? null;
  if (Array.isArray(body.recipes)) return { recipes: body.recipes, versions };
  if (Array.isArray(body.ids)) return { recipes: body.ids.map((id) => ({ id, result: id })), versions };
  return { recipes: [], versions };
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
