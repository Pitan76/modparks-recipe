/**
 * @fileoverview レンダリング済み画像（L1）のR2キーと、その公開URLの組み立て。
 *
 * Worker を通さず R2 のカスタムドメインから直接配信するため、キーの作り方をサーバ・クライアントで
 * 共有します。クライアントは `/api/**\/list.json` が返す `assets`（base と rv）からURLを組めます。
 * L1 に無い画像は 404 になるので、呼び出し側は Worker の `/api/:ns/:id.png` へフォールバックして
 * ください（Worker がレンダリングしてL1へ保存するため、次回からは直接ヒットします）。
 */

import type { Env } from './minecraft';
import { rendererVersion } from './render-version';

/** クライアントへ渡す配信情報。`base` が空なら直接配信は無効です。 */
export type AssetDelivery = { base: string; rv: string };

/**
 * L1（レンダリング済み画像）のR2キーを組み立てます。
 * @param rv レンダラー版
 * @param ns ネームスペース
 * @param version アセットバージョン（またはbuild ID先頭16文字）
 * @param id レシピID（ネームスペースを除いた部分）
 * @param scale 拡大率
 * @param tagOffset タグの回転位置
 * @param ext 拡張子
 */
export function imageCacheKey(
  rv: string,
  ns: string,
  version: string,
  id: string,
  scale: number,
  tagOffset: number,
  ext: string
): string {
  return `cache/img/${rv}/${ns}/${version}/${id}@${scale}+${tagOffset}.${ext}`;
}

/**
 * クライアントに配る配信情報を返します。
 * @param env 環境変数
 */
export function assetDelivery(env: Env): AssetDelivery {
  return { base: trimSlash(env.PUBLIC_IMAGE_BASE ?? ''), rv: rendererVersion(env) };
}

/** 末尾のスラッシュを落とします。URL結合時の `//` を避けるためです。 */
function trimSlash(base: string): string {
  return base.endsWith('/') ? base.slice(0, -1) : base;
}
