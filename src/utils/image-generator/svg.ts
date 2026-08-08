/**
 * @fileoverview レシピ画像用SVGジェネレーター。
 */

import { legacyAssetSource } from '../build/asset-source';
import type { AssetReader } from '../../core/asset-reader';
import { getItemImageBase64, getTag, Env } from '../minecraft';
import { DEFAULT_TAG_NAMESPACES, pickTagCandidates, type TagNamespaceFilter } from '../../core/tag-namespaces';

// レイアウト定数と純粋な描画ヘルパーは layout.ts に集約し、ここから再エクスポートします。
// （ローカルのプレビュー/検証スクリプトが wasm/R2 依存を引き込まずに再利用できるようにするため。）
export {
  CANVAS_W,
  CANVAS_H,
  BACKGROUND,
  ICON,
  GRID_X,
  GRID_Y,
  SLOT,
  OUT_X,
  OUT_Y,
  iconSvg,
} from './layout';

import {
  CANVAS_W,
  CANVAS_H,
  BACKGROUND,
  GRID_X,
  GRID_Y,
  SLOT,
  OUT_X,
  OUT_Y,
  ICON,
  iconSvg,
  countSvg,
} from './layout';

/**
 * リクエスト1回分の描画文脈。
 *
 * 「アイテムID -> アイコンデータURL」のメモに加えて、どのMCチャネルで解決するかを持ちます。
 * 素材の解決は ns を跨いで何段も潜るため、解決先を引数で持ち回るより文脈に載せる方が取り違えが起きません。
 */
export class IconCache {
  private readonly icons = new Map<string, Promise<string | null>>();

  /**
   * @param src アセット読み出し口
   * @param tagNamespaces タグの構成アイテムとして採用するネームスペース
   */
  constructor(
    readonly src: AssetReader,
    readonly tagNamespaces: TagNamespaceFilter = DEFAULT_TAG_NAMESPACES
  ) {}

  /**
   * メモ済みのアイコンを返します。
   * @param id アイテムID
   */
  get(id: string): Promise<string | null> | undefined {
    return this.icons.get(id);
  }

  /**
   * アイコンの解決結果をメモします。
   * @param id アイテムID
   * @param pending 解決中のPromise
   */
  set(id: string, pending: Promise<string | null>): void {
    this.icons.set(id, pending);
  }
}

/**
 * キャッシュを活用して、特定のアイテムIDに対応するアイコンデータURLを取得します。
 */
export function itemIcon(id: string, env: Env | null, cache: IconCache): Promise<string | null> {
  let pending = cache.get(id);
  if (!pending) {
    pending = getItemImageBase64(id, env, cache.src);
    cache.set(id, pending);
  }
  return pending;
}

/**
 * 素材参照をたどれる最大段数。
 * レシピJSONは書き込みAPIで形を検証していないため、深く入れ子になった配列や
 * 互いを指し合うタグ（A→B→A）で再帰が尽きるのを防ぎます。
 */
const MAX_INGREDIENT_DEPTH = 8;

/**
 * 1つの素材を解決する間だけ持ち回る探索状態。
 */
type IngredientTrail = {
  /** 既に展開したタグID。循環参照を検出するために使います。 */
  tags: Set<string>;
  /** 現在の再帰段数。 */
  depth: number;
};

/**
 * レシピの素材オブジェクト（item, tag, 配列など）を解決し、対応するアイテムのアイコンデータURLを返します。
 * @param trail 循環参照と深さの検出に使う探索状態（呼び出し側は省略します）
 */
export async function resolveIngredient(
  ingredient: any,
  env: Env | null,
  tagOffset: number,
  cache: IconCache,
  trail: IngredientTrail = { tags: new Set(), depth: 0 }
): Promise<string | null> {
  if (!ingredient) return null;
  if (trail.depth >= MAX_INGREDIENT_DEPTH) return null;

  const next = { tags: trail.tags, depth: trail.depth + 1 };
  if (typeof ingredient === 'string') {
    const wrapped = ingredient.startsWith('#') ? { tag: ingredient.substring(1) } : { item: ingredient };
    return resolveIngredient(wrapped, env, tagOffset, cache, next);
  }
  if (Array.isArray(ingredient)) return resolveIngredient(ingredient[0], env, tagOffset, cache, next);
  if (typeof ingredient.item === 'string') return itemIcon(ingredient.item, env, cache);
  if (typeof ingredient.tag === 'string') return resolveTag(ingredient.tag, env, tagOffset, cache, next);
  // `{ "type": "neoforge:components", "items": ..., "components": ... }` のように、素材本体を
  // `items` に持つ形があります。中身はID・タグ・配列のいずれも取るため、解決し直します。
  if (ingredient.items !== undefined) return resolveIngredient(ingredient.items, env, tagOffset, cache, next);
  // タグの構成要素は `{ "id": "minecraft:stone", "required": false }` の形も取ります。
  // 文字列として解決し直すことで、`#` 付きの別タグ参照もそのまま辿れます。
  if (typeof ingredient.id === 'string') return resolveIngredient(ingredient.id, env, tagOffset, cache, next);
  return null;
}

/**
 * タグを構成アイテムのいずれか1つに落として解決します。
 * 既に展開済みのタグは循環とみなして打ち切ります。
 */
async function resolveTag(
  tag: string,
  env: Env | null,
  tagOffset: number,
  cache: IconCache,
  trail: IngredientTrail
): Promise<string | null> {
  const id = tag.replace(/^#/, '');
  if (trail.tags.has(id)) return null;
  trail.tags.add(id);

  const tagItems = pickTagCandidates(await getTag(id, env, cache.src), cache.tagNamespaces);
  if (tagItems.length === 0) return null;
  return resolveIngredient(tagItems[tagOffset % tagItems.length], env, tagOffset, cache, trail);
}

/** クラフトグリッドの一辺のスロット数。 */
const GRID_SIZE = 3;

/** グリッド上の1マスに割り当てられた素材。 */
type Slot = { index: number; ingredient: any };

/**
 * 定型（shaped）レシピのパターンからスロット割り当てを作ります。
 * パターンは書き込みAPIで形を検証していない生の入力なので、
 * 3x3に収まらない行・列はグリッドを壊す前にここで捨てます。
 */
function shapedSlots(recipeData: any): Slot[] {
  const { pattern, key } = recipeData;
  if (!Array.isArray(pattern) || !key || typeof key !== 'object') return [];

  const slots: Slot[] = [];
  for (let r = 0; r < Math.min(pattern.length, GRID_SIZE); r++) {
    const row = pattern[r];
    if (typeof row !== 'string') continue;
    for (let c = 0; c < Math.min(row.length, GRID_SIZE); c++) {
      if (row[c] !== ' ') slots.push({ index: r * GRID_SIZE + c, ingredient: key[row[c]] });
    }
  }
  return slots;
}

/**
 * 不定形（shapeless）レシピの素材列からスロット割り当てを作ります。
 * 9個を超える分は3x3に置けないため捨てます。
 */
function shapelessSlots(recipeData: any): Slot[] {
  const { ingredients } = recipeData;
  if (!Array.isArray(ingredients)) return [];
  return ingredients
    .slice(0, GRID_SIZE * GRID_SIZE)
    .map((ingredient: any, index: number) => ({ index, ingredient }));
}

/**
 * レシピデータからスロット割り当てを作ります。クラフト系以外は空になります。
 */
function slotsOf(recipeData: any): Slot[] {
  const type = String(recipeData?.type ?? '').replace(/^minecraft:/, '');
  if (type === 'crafting_shaped') return shapedSlots(recipeData);
  if (type === 'crafting_shapeless') return shapelessSlots(recipeData);
  return [];
}

/**
 * レシピデータから3x3クラフトグリッドに対応する9スロットのアイコン画像データURLの配列を作成します。
 */
export async function createRecipeGrid(
  recipeData: any,
  env: Env | null,
  tagOffset: number,
  cache: IconCache = new IconCache(legacyAssetSource(env!))
): Promise<Array<string | null>> {
  const grid: Array<string | null> = Array(GRID_SIZE * GRID_SIZE).fill(null);
  await Promise.all(
    slotsOf(recipeData).map(async ({ index, ingredient }) => {
      grid[index] = await resolveIngredient(ingredient, env, tagOffset, cache);
    })
  );
  return grid;
}

/**
 * レシピ全体のUIを表現するSVG文字列を生成します。
 * @param tagNamespaces タグの構成アイテムとして採用するネームスペース（既定はバニラのみ）
 */
export async function generateRecipeSvg(
  recipeData: any,
  env: Env | null,
  tagOffset: number = 0,
  src: AssetReader = legacyAssetSource(env!),
  tagNamespaces: TagNamespaceFilter = DEFAULT_TAG_NAMESPACES
) {
  const cache = new IconCache(src, tagNamespaces);

  const result = recipeData.result ?? recipeData.output;
  const resultId = result
    ? (typeof result === 'string' ? result : result.id || result.item)
    : null;
  const resultCount = result && typeof result === 'object' && Number(result.count) > 1
    ? Math.floor(Number(result.count))
    : 0;

  const [grid, resultImage] = await Promise.all([
    createRecipeGrid(recipeData, env, tagOffset, cache),
    resultId ? itemIcon(resultId, env, cache) : Promise.resolve(null),
  ]);

  let body = `<image href="${BACKGROUND}" x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}"`
    + ` image-rendering="optimizeSpeed"/>`;

  for (let i = 0; i < 9; i++) {
    if (!grid[i]) continue;
    body += iconSvg(grid[i]!, GRID_X + (i % 3) * SLOT, GRID_Y + Math.floor(i / 3) * SLOT);
  }

  if (resultImage) {
    body += iconSvg(resultImage, OUT_X, OUT_Y);
    // 出力が2個以上ならバニラ同様、右下にスタック数を表示（SVG座標はネイティブの2倍なので px=2）。
    if (resultCount > 1) {
      body += countSvg(String(resultCount), OUT_X + ICON, OUT_Y + ICON, 2);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}"`
    + ` viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" shape-rendering="crispEdges">${body}</svg>`;
}
