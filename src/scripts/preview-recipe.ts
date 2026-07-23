/**
 * @fileoverview 実レシピのローカル即確認スクリプト。
 *
 * preview-slots.ts が「1モデルを全スロットに敷き詰める配置検証」なのに対し、
 * こちらは client.jar 内の実際のレシピ JSON（例: data/minecraft/recipe/chest.json）を読み、
 * 本番 generateRecipeSvg と同一のレイアウト・iconSvg・背景で SVG を組み立てて PNG 化します。
 *
 * アイコン解決は R2/wasm に依存せず、client.jar から直接おこないます（本番 getItemImageBase64 と同じ優先順）:
 *   1) 3Dブロックとしてレンダリング（item/<path> → block/<path>、フラットアイテムはスキップ）
 *   2) 平面アイテムテクスチャ item/<path>.png にフォールバック
 * タグ（#minecraft:planks 等）は data/minecraft/tags/item/<tag>.json から解決します。
 *
 * 実行:
 *   npx tsx src/scripts/preview-recipe.ts [recipeId] [scale] [tagOffset]
 *   例: npx tsx src/scripts/preview-recipe.ts chest 2
 *       npx tsx src/scripts/preview-recipe.ts oak_planks
 *
 * 出力: preview/recipe-<id>@<scale>x.png
 */

import fs from 'fs';
import path from 'path';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { renderModel } from './render-blocks/render';
import { loadModel } from './render-blocks/model';
import { readJarBuffer, readJarJson } from './render-blocks/jar';
import { chestModel, CHEST_VARIANTS } from '../core/chest';
import {
  BACKGROUND,
  iconSvg,
  countSvg,
  ICON,
  GRID_X,
  GRID_Y,
  SLOT,
  OUT_X,
  OUT_Y,
  CANVAS_W,
  CANVAS_H,
} from '../utils/image-generator/layout';

/** resvg-wasm をローカルの wasm ファイルで初期化する。 */
async function initLocalResvg(): Promise<void> {
  const wasmPath = path.join(process.cwd(), 'node_modules/@resvg/resvg-wasm/index_bg.wasm');
  await initWasm(fs.readFileSync(wasmPath));
}

/** `ns:path` / `path` をネームスペース無しのパスに正規化する（バニラ前提）。 */
function bare(id: string): string {
  return id.includes(':') ? id.split(':').slice(1).join(':') : id;
}

/** PNG バッファを data URI に変換する。 */
function toDataUri(png: Buffer | Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
}

/** 解決されたモデルチェーンが、実際にレンダリング可能なジオメトリを持つか判定する（block-icon.ts の hasGeometry と同じ）。 */
function hasGeometry(model: any): boolean {
  return !!model && Array.isArray(model.elements) && model.elements.length > 0;
}

/**
 * アイテムIDのアイコン data URI を jar から解決する（本番 renderBlockIconSvg のローカル版）。
 * 解決順は block-icon.ts と一致させる:
 *   - チェスト等のブロックエンティティは builtin/entity でエレメントを持たないため、
 *     エンティティアトラスから合成した chestModel を使う。
 *   - それ以外は item モデル優先、無ければ block モデルの 3D ジオメトリを描画。
 *     （松明の item/generated のようにジオメトリを持たないモデルはスキップして block/<path> を採用）
 *   - どちらも解決できなければ平面アイテムテクスチャにフォールバック。
 */
const iconCache = new Map<string, Promise<string | null>>();
function resolveIcon(itemId: string): Promise<string | null> {
  let pending = iconCache.get(itemId);
  if (!pending) {
    pending = (async () => {
      const p = bare(itemId);
      // 1) ブロックエンティティ（チェスト系）は合成モデルで描画
      if (CHEST_VARIANTS[p]) {
        const png = await renderModel(chestModel(CHEST_VARIANTS[p])).catch(() => null);
        if (png) return toDataUri(png);
      } else {
        // 2) 3Dブロック（item モデル優先、無ければ block モデル）
        for (const modelId of [`item/${p}`, `block/${p}`]) {
          const model = loadModel(modelId);
          if (!hasGeometry(model)) continue;
          const png = await renderModel(model).catch(() => null);
          if (png) return toDataUri(png);
        }
      }
      // 3) 平面アイテムテクスチャにフォールバック
      const tex = readJarBuffer(`assets/minecraft/textures/item/${p}.png`);
      if (tex) return toDataUri(tex);
      return null;
    })();
    iconCache.set(itemId, pending);
  }
  return pending;
}

/** タグの最初の（tagOffset 番目の）アイテムIDを解決する。ネストしたタグ（#）も辿る。 */
function resolveTag(tag: string, tagOffset: number, seen = new Set<string>()): string | null {
  const p = bare(tag);
  if (seen.has(p)) return null;
  seen.add(p);
  const json = readJarJson(`assets/minecraft/tags/item/${p}.json`)
    ?? readJarJson(`data/minecraft/tags/item/${p}.json`);
  const values: any[] = json?.values;
  if (!Array.isArray(values) || values.length === 0) return null;
  const picked = values[tagOffset % values.length];
  const id = typeof picked === 'string' ? picked : picked?.id;
  if (typeof id !== 'string') return null;
  return id.startsWith('#') ? resolveTag(id.substring(1), tagOffset, seen) : id;
}

/** 素材（文字列/配列/{item}/{tag}）を1つのアイテムIDへ解決する（createRecipeGrid と同じ規則）。 */
function ingredientToItemId(ingredient: any, tagOffset: number): string | null {
  if (!ingredient) return null;
  if (typeof ingredient === 'string') {
    return ingredient.startsWith('#') ? resolveTag(ingredient.substring(1), tagOffset) : ingredient;
  }
  if (Array.isArray(ingredient)) return ingredientToItemId(ingredient[0], tagOffset);
  if (ingredient.item) return ingredient.item;
  if (ingredient.tag) return resolveTag(ingredient.tag, tagOffset);
  return null;
}

/** レシピデータを9スロットのアイテムID配列にする（svg.ts createRecipeGrid と同じロジック）。 */
function recipeToGrid(recipe: any, tagOffset: number): (string | null)[] {
  const slots: { index: number; ingredient: any }[] = [];
  const type = String(recipe.type || '').replace(/^minecraft:/, '');
  if (type === 'crafting_shaped') {
    const { pattern, key } = recipe;
    for (let r = 0; r < pattern.length; r++)
      for (let c = 0; c < pattern[r].length; c++)
        if (pattern[r][c] !== ' ') slots.push({ index: r * 3 + c, ingredient: key[pattern[r][c]] });
  } else if (type === 'crafting_shapeless') {
    recipe.ingredients.forEach((ing: any, i: number) => slots.push({ index: i, ingredient: ing }));
  }
  const grid: (string | null)[] = Array(9).fill(null);
  for (const { index, ingredient } of slots) grid[index] = ingredientToItemId(ingredient, tagOffset);
  return grid;
}

async function main(): Promise<void> {
  const recipeId = process.argv[2] || 'chest';
  const scale = Number(process.argv[3] || 1);
  const tagOffset = Number(process.argv[4] || 0);

  await initLocalResvg();

  const recipe = readJarJson(`data/minecraft/recipe/${bare(recipeId)}.json`);
  if (!recipe) {
    console.error(`レシピが見つかりません: data/minecraft/recipe/${bare(recipeId)}.json`);
    process.exit(1);
  }

  const grid = recipeToGrid(recipe, tagOffset);
  const result = recipe.result ?? recipe.output;
  const resultId = result ? (typeof result === 'string' ? result : result.id || result.item) : null;
  const resultCount =
    result && typeof result === 'object' && Number(result.count) > 1 ? Math.floor(Number(result.count)) : 0;

  // アイコン解決（入力9 + 出力を並行に）
  const gridIcons = await Promise.all(grid.map((id) => (id ? resolveIcon(id) : Promise.resolve(null))));
  const resultIcon = resultId ? await resolveIcon(resultId) : null;

  // 本番 generateRecipeSvg と同一の組み立て
  let body = `<image href="${BACKGROUND}" x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" image-rendering="optimizeSpeed"/>`;
  for (let i = 0; i < 9; i++) {
    if (!gridIcons[i]) continue;
    body += iconSvg(gridIcons[i]!, GRID_X + (i % 3) * SLOT, GRID_Y + Math.floor(i / 3) * SLOT);
  }
  if (resultIcon) {
    body += iconSvg(resultIcon, OUT_X, OUT_Y);
    if (resultCount > 1) body += countSvg(String(resultCount), OUT_X + ICON, OUT_Y + ICON, 2);
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}"` +
    ` viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" shape-rendering="crispEdges">${body}</svg>`;

  const resvg = new Resvg(svg, { fitTo: { mode: 'zoom', value: scale }, shapeRendering: 0, imageRendering: 1 });
  const out = resvg.render().asPng();

  const outDir = path.join(process.cwd(), 'preview');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `recipe-${bare(recipeId).replace(/[\/:]/g, '_')}@${scale}x.png`);
  fs.writeFileSync(outPath, out);

  console.log(`recipe=${recipeId} type=${recipe.type} scale=${scale}`);
  console.log(`入力グリッド: ${grid.map((g) => g ?? '.').join(' | ')}`);
  console.log(`出力: ${resultId ?? '(なし)'}${resultCount > 1 ? ` x${resultCount}` : ''}`);
  const missing = grid.filter((g, i) => g && !gridIcons[i]);
  if (missing.length || (resultId && !resultIcon))
    console.log(`⚠ アイコン未解決: ${[...missing, resultId && !resultIcon ? resultId : null].filter(Boolean).join(', ')}`);
  console.log(`保存: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
