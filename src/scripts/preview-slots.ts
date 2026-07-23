/**
 * @fileoverview スロット配置のローカル即確認スクリプト。
 *
 * R2 に依存せず、client.jar から実ブロックをレンダリング（＝本番パイプラインと同じ画像）し、
 * 本番と同じ `svg.ts` の定数・`iconSvg`・背景を使って SVG を組み立て、resvg で PNG 化します。
 * さらに「入力スロット」と「出力スロット」に同じアイテム画像を置き、
 * それぞれのスロット内でアイテムの不透明ピクセルが実際にどこから描画されているかを計測して表示します。
 *
 * 実行:
 *   npx tsx src/scripts/preview-slots.ts [modelId] [scale]
 *   例: npx tsx src/scripts/preview-slots.ts block/crafting_table 2
 *
 * 出力: preview-slots.png（プロジェクト直下）
 */

import fs from 'fs';
import path from 'path';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { createCanvas, loadImage } from 'canvas';
import { renderBlock } from './render-blocks/render';
import {
  BACKGROUND,
  iconSvg,
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

/** PNG バッファを SVG に埋め込める data URI に変換する。 */
function toDataUri(png: Buffer | Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
}

/**
 * 指定領域内でアイテム（不透明ピクセル）のバウンディングボックスを計測する。
 * @returns 領域左上を基準とした content の開始/終了座標とマージン
 */
function measure(
  pixels: Uint8Array,
  W: number,
  region: { x: number; y: number; w: number; h: number },
): { minx: number; miny: number; maxx: number; maxy: number } | null {
  let minx = 1e9, miny = 1e9, maxx = -1, maxy = -1;
  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      const a = pixels[(y * W + x) * 4 + 3];
      if (a > 10) {
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
        if (y < miny) miny = y;
        if (y > maxy) maxy = y;
      }
    }
  }
  if (maxx < 0) return null;
  return { minx, miny, maxx, maxy };
}

async function main(): Promise<void> {
  const modelId = process.argv[2] || 'block/crafting_table';
  const scale = Number(process.argv[3] || 2);

  await initLocalResvg();

  const png = await renderBlock(modelId);
  if (!png) {
    console.error(`renderBlock("${modelId}") が null を返しました（フラットアイテム/未対応モデルの可能性）。`);
    process.exit(1);
  }
  const href = toDataUri(png);

  // 本番と同じ背景・同じ iconSvg で、入力スロット(0) と 出力スロット に同一画像を配置。
  const inputX = GRID_X;
  const inputY = GRID_Y;
  const body =
    `<image href="${BACKGROUND}" x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" image-rendering="optimizeSpeed"/>` +
    iconSvg(href, inputX, inputY) +
    iconSvg(href, OUT_X, OUT_Y);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}"` +
    ` viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" shape-rendering="crispEdges">${body}</svg>`;

  const resvg = new Resvg(svg, { fitTo: { mode: 'zoom', value: scale }, shapeRendering: 0, imageRendering: 1 });
  const rendered = resvg.render();
  const out = rendered.asPng();

  const outDir = path.join(process.cwd(), 'preview');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `slots-${modelId.replace(/[\/:]/g, '_')}@${scale}x.png`);
  fs.writeFileSync(outPath, out);

  // レンダリング結果を読み直して、各スロット内のアイテム実描画位置を計測。
  const img = await loadImage(Buffer.from(out));
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const W = img.width;
  const data = ctx.getImageData(0, 0, img.width, img.height).data as unknown as Uint8Array;

  const inputRegion = { x: inputX * scale, y: inputY * scale, w: ICON * scale, h: ICON * scale };
  const outputRegion = { x: OUT_X * scale, y: OUT_Y * scale, w: ICON * scale, h: ICON * scale };
  const inM = measure(data, W, inputRegion);
  const outM = measure(data, W, outputRegion);

  console.log(`model=${modelId} scale=${scale}  canvas=${img.width}x${img.height}`);
  console.log(`保存: ${outPath}`);
  console.log(`ICON枠(2倍基準): input=(${GRID_X},${GRID_Y})  output=(${OUT_X},${OUT_Y})  ICON=${ICON}`);
  const rel = (m: typeof inM, base: { x: number; y: number }) =>
    m ? `content開始 abs(${m.minx},${m.miny}) / 枠内オフセット(${m.minx - base.x},${m.miny - base.y})` : '（不透明ピクセルなし）';
  console.log(`入力スロット: ${rel(inM, { x: inputRegion.x, y: inputRegion.y })}`);
  console.log(`出力スロット: ${rel(outM, { x: outputRegion.x, y: outputRegion.y })}`);
  if (inM && outM) {
    const dx = (outM.minx - outputRegion.x) - (inM.minx - inputRegion.x);
    const dy = (outM.miny - outputRegion.y) - (inM.miny - inputRegion.y);
    console.log(`入力基準の出力ズレ: (${dx}, ${dy})  ※0なら入力と完全一致`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
