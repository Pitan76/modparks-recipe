/**
 * @fileoverview ブラウザだけでレシピ画像を組み立てる処理。
 *
 * jar は手元にあるので、その中身をそのまま読み出し口にします。jar に無いもの（`minecraft:` の
 * テクスチャやモデル、`c:` のタグ）だけを外から取ります。
 *
 * 取得は「描いて不足を集め、まとめて取る」の繰り返しです。素材の依存は多段で、タグを読むまで
 * どのアイテムが要るか分からず、そのアイテムのテクスチャはさらにその先にあります。1周で止めると
 * 入力スロットのように段数の多いものが埋まりません。新しい不足が出なくなるまで回します。
 *
 * 描画に何が要るかは実際に描いてみないと分からないうえ、一覧をまるごと配らせると要らないものまで
 * 運ぶことになるため、都度必要な分だけを問い合わせます。R2 直取りなので Worker も起きません。
 *
 * レシピのSVGは文字列として組み立てられるため、ラスタライザ（wasm）は要りません。
 * ブラウザにそのまま渡せば描画されます。
 */

import type { AssetReader } from '../../core/asset-reader';
import type { ZipLike } from '../../core/jar-assets';
import { RECIPE_PATH } from '../../core/paths';
import { isCraftingType } from '../../core/recipe';
import { generateRecipeSvg } from '../../utils/image-generator/svg';
import { TRANSPARENT_PNG } from '../../utils/minecraft/texture';
import { LocalAssetReader } from './local-asset-reader';

// 表示・書き出し向けの変換は `svg-image.ts` にあります。ここを経由して読ませているのは、
// 呼び出し側が「手元で描く」入口としてこのファイルだけを見れば済むようにするためです。
export { svgDataUrl, svgToPngDataUrl } from './svg-image';
/**
 * 不足を集めて取りに行く回数の上限。
 *
 * タグ→アイテム→テクスチャ、モデル→親モデル→テクスチャ、と辿る段数を吸収できれば足ります。
 * 上限を設けるのは、解決できない参照が残ったときに往復し続けないためです。
 */
const MAX_RESOLVE_ROUNDS = 5;

/** 素材の切り替わりを見せるコマ数の上限。Worker 側の GIF と揃えています。 */
const MAX_FRAMES = 5;

/**
 * レシピの入力スロット数を数えます。
 *
 * 描けたかどうかを判断する基準になります。素材の解決に失敗したスロットは描画側が黙って飛ばすため、
 * 枚数を突き合わせないと「欠けたまま出来上がった絵」を配ってしまいます。
 * @param data レシピJSON
 */
function slotCount(data: any): number {
  const type = String(data?.type ?? '').replace(/^minecraft:/, '');
  if (type === 'crafting_shapeless') {
    return Array.isArray(data.ingredients) ? Math.min(data.ingredients.length, 9) : 0;
  }
  if (type !== 'crafting_shaped' || !Array.isArray(data.pattern)) return 0;

  let slots = 0;
  for (const row of data.pattern.slice(0, 3)) {
    if (typeof row !== 'string') continue;
    for (const ch of row.slice(0, 3)) if (ch !== ' ') slots++;
  }
  return slots;
}

/**
 * 素材がすべて揃った絵かどうかを判定します。
 * @param data レシピJSON
 * @param svg 組み立てた SVG
 */
function isComplete(data: any, svg: string): boolean {
  // 透明で埋まったスロットは「解決できなかった」印です。欠けたまま配らないために弾きます。
  if (svg.includes(TRANSPARENT_PNG)) return false;

  const result = data?.result ?? data?.output;
  // 背景 + 入力スロット + 完成品
  const expected = 1 + slotCount(data) + (result ? 1 : 0);
  return (svg.match(/<image /g) ?? []).length === expected;
}

/**
 * 手元で組み立てた1レシピ。
 *
 * `frames` は素材が切り替わるレシピのコマです。切り替わらないものは1つだけ入ります。
 */
export type LocalRecipe = { id: string; svg: string; frames: string[] };

/** 手元での描画結果。 */
export type LocalRenderResult = {
  /** 素材が揃って描けたもの */
  recipes: LocalRecipe[];
  /** 素材が足りず描けなかったレシピID */
  failed: string[];
};

/**
 * jar からクラフト系のレシピを取り出し、SVGに組み立てます。
 * @param zip 展開済みの jar
 * @param onProgress 進捗の通知
 */
export async function renderJarLocally(
  zip: ZipLike,
  onProgress?: (done: number, total: number) => void
): Promise<LocalRenderResult> {
  const reader = new LocalAssetReader(zip);
  const recipes = await collectRecipes(zip);

  // 描いては不足を取る、を新しい不足が出なくなるまで繰り返します。ここでの描画は結果を捨て、
  // 何が要るかを知るためだけに行います。
  for (let round = 0; round < MAX_RESOLVE_ROUNDS; round++) {
    for (const { data } of recipes) await framesOf(data, reader).catch(() => []);
    if ((await reader.loadMissing()) === 0) break;
  }

  const out: LocalRecipe[] = [];
  const failed: string[] = [];
  let done = 0;
  for (const { id, data } of recipes) {
    const frames = await framesOf(data, reader).catch(() => []);
    // 素材が欠けたものは出しません。中途半端な絵は、無いことより分かりにくい間違いになります。
    if (frames.length > 0 && isComplete(data, frames[0])) out.push({ id, svg: frames[0], frames });
    else failed.push(id);
    onProgress?.(++done, recipes.length);
  }
  return { recipes: out, failed };
}

/**
 * 素材の切り替わりぶんのコマを作ります。
 *
 * タグを展開して構成アイテム数を数える代わりに、実際に描いて絵が変わるかで判断します。
 * 1周して1コマ目に戻った時点で打ち切るため、同じ絵を並べたGIFになりません。
 * @param data レシピJSON
 * @param reader アセット読み出し口
 */
async function framesOf(data: any, reader: AssetReader): Promise<string[]> {
  const frames: string[] = [];

  for (let offset = 0; offset < MAX_FRAMES; offset++) {
    const svg = await generateRecipeSvg(data, null, offset, reader);
    if (offset > 0 && svg === frames[0]) break;
    frames.push(svg);
  }
  return frames;
}

/**
 * jar からクラフト系のレシピを取り出します。
 * @param zip 展開済みの jar
 */
async function collectRecipes(zip: ZipLike): Promise<{ id: string; data: any }[]> {
  const found: { id: string; data: any }[] = [];

  for (const path of Object.keys(zip.files)) {
    const entry = zip.files[path];
    if (entry.dir) continue;

    const match = path.match(RECIPE_PATH);
    if (!match) continue;

    const data = await entry.async('string').then((t) => JSON.parse(t)).catch(() => null);
    if (!data || !isCraftingType(data.type)) continue;
    found.push({ id: `${match[1]}:${match[2]}`, data });
  }

  return found.sort((a, b) => a.id.localeCompare(b.id));
}
