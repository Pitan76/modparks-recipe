/**
 * @fileoverview オフラインでアイコンPNGを焼く処理。
 *
 * 描画そのものは Worker と同じ `renderBlockIconSvg` を通し、ここは SVG を画像にするだけです。
 * 以前は node-canvas で独立に描き直していましたが、同じ絵を2つの実装が別々に描くことになり、
 * 片方だけ直した状態が長く続きました（ガラスが6面のまま、チェストに留め具が無いまま）。
 * ラスタライザも Worker と同じ resvg の Node 版を使うので、出力は一致します。
 */

import { Resvg } from '@resvg/resvg-js';
import { ICON_SIZE, renderBlockIconSvg } from '../../utils/block-icon';
import type { AssetReader } from '../../core/asset-reader';

/**
 * SVGをアイコンPNGにします。
 *
 * ピクセルアートなので補間は一切かけません。`shapeRendering` を落とすと面の境界がぼやけず、
 * `imageRendering` を落とすとテクスチャがニアレストネイバーで拡大されます。Worker 側と同じ設定です。
 * @param svg SVG文字列
 */
export function iconPng(svg: string): Buffer {
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: ICON_SIZE },
    shapeRendering: 0,
    imageRendering: 1,
  })
    .render()
    .asPng();
}

/**
 * アイテム1つ分のアイコンPNGを焼きます。
 * @param ns ネームスペース
 * @param id アイテムID
 * @param src アセット読み出し口
 * @returns 描けなければ null
 */
export async function bakeIcon(ns: string, id: string, src: AssetReader): Promise<Buffer | null> {
  const svg = await renderBlockIconSvg(null, ns, id, src);
  return svg ? iconPng(svg) : null;
}
