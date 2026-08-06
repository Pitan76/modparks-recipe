/**
 * @fileoverview レシピの素材が実際に切り替わるかどうかの判定。
 *
 * タグを使っていても構成アイテムが1つなら絵は変わらないため、アニメーションにする意味がありません。
 * 判定にはタグ本体の読み出しが要ります。取り込み時はレシピがタグより先に書かれる（`/bulk` は
 * recipes を先に処理します）ので当てになりません。タグが出揃った配信時に解決します。
 */

import type { Env } from './minecraft';
import { getTag } from './minecraft/data';
import type { AssetReader } from '../core/asset-reader';

/** タグを辿る深さの上限。素材解決側と揃えています。 */
const MAX_DEPTH = 4;

/**
 * タグを展開して、構成アイテムが2つ以上あるかどうかを判定します。
 *
 * 2つ見つかった時点で打ち切ります。大きなタグを最後まで数える必要はありません。
 * @param tag タグID（`#` は付いていても構いません）
 * @param env 環境変数
 * @param src アセット読み出し口
 * @param seen 展開済みのタグ（循環の打ち切り用）
 * @param depth 現在の深さ
 * @returns 構成アイテム数（2以上は2で打ち切り）
 */
async function countItems(
  tag: string,
  env: Env,
  src: AssetReader,
  seen: Set<string>,
  depth: number
): Promise<number> {
  const id = tag.replace(/^#/, '');
  if (depth >= MAX_DEPTH || seen.has(id)) return 0;
  seen.add(id);

  let count = 0;
  for (const value of await getTag(id, env, src)) {
    const entry = typeof value === 'string' ? value : (value as { id?: string })?.id;
    if (typeof entry !== 'string') continue;

    count += entry.startsWith('#') ? await countItems(entry, env, src, seen, depth + 1) : 1;
    if (count >= 2) return 2;
  }
  return count;
}

/**
 * 素材からタグ参照を集めます。`resolveIngredient` が受け付ける形に合わせています。
 * @param ingredient レシピの素材1つ
 * @param out 収集先
 */
function tagsOf(ingredient: any, out: string[] = []): string[] {
  if (!ingredient) return out;
  if (typeof ingredient === 'string') {
    if (ingredient.startsWith('#')) out.push(ingredient);
    return out;
  }
  if (Array.isArray(ingredient)) {
    ingredient.forEach((x) => tagsOf(x, out));
    return out;
  }
  if (typeof ingredient.tag === 'string') out.push(ingredient.tag);
  if (ingredient.items !== undefined) tagsOf(ingredient.items, out);
  if (typeof ingredient.id === 'string' && ingredient.id.startsWith('#')) out.push(ingredient.id);
  return out;
}

/**
 * レシピの素材が切り替わりうるか、つまりアニメーションにする意味があるかを判定します。
 * @param data レシピJSONオブジェクト
 * @param env 環境変数
 * @param src アセット読み出し口
 */
export async function hasVariantTag(data: any, env: Env, src: AssetReader): Promise<boolean> {
  const shapeless = Array.isArray(data?.ingredients) ? data.ingredients : [];
  const shaped = data?.key && typeof data.key === 'object' ? Object.values(data.key) : [];

  for (const tag of [...shapeless, ...shaped].flatMap((i) => tagsOf(i))) {
    if ((await countItems(tag, env, src, new Set(), 0)) >= 2) return true;
  }
  return false;
}
