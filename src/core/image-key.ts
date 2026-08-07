/**
 * @fileoverview レンダリング済み画像（L1）のキー書式と、その構成要素の唯一の出所。
 *
 * このキーはサーバが書き、クライアントが R2 から直接読むために組み立てます。両者が別々に同じ
 * 文字列を作っていると、片方だけ変えたときに黙って行き先がずれ、直リンクが永久に 404 になった
 * まま Worker を起こし続けます。実際に「クライアントは1文字ずつ手で組み、既定の拡大率は
 * `Worker側の DEFAULT_SCALE` というコメント付きで写し取っていた」状態でした。
 *
 * 依存を持たない純粋な形にしてあるのは、Worker とブラウザの両方から同じものを読ませるためです。
 * 環境やレンダラーに触れるものはここへ置かないでください。
 */

/**
 * 既定の拡大率。
 *
 * scale は 0.5 倍を1単位とする整数指標で、実際のズーム倍率は scale * 0.5 です。
 *   scale=1 → 0.5倍 118x56 / scale=2 → 等倍 236x112 / scale=4 → 2倍 472x224
 * 偶数のときに整数倍ズームとなり、ピクセルアートの鮮明さが保たれます。
 */
export const DEFAULT_SCALE = 2;

/** 受け付ける拡大率の上限。 */
export const MAX_SCALE = 8;

/** 既定のタグ回転位置。素材が切り替わるレシピの、何番目の姿を描くかです。 */
export const DEFAULT_TAG_OFFSET = 0;

/** L1 キーの接頭辞。 */
export const IMAGE_CACHE_PREFIX = 'cache/img/';

/**
 * 拡大率を受け付ける範囲へ丸めます。
 * @param value 判定対象の値
 * @returns 正規化された拡大率
 */
export function normalizeScale(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_SCALE;
  return Math.min(n, MAX_SCALE);
}

/**
 * L1（レンダリング済み画像）のR2キーを組み立てます。
 * @param rv レンダラー版（共有ネームスペースを畳んだもの）
 * @param ns ネームスペース
 * @param version ネームスペースの画像バージョン
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
  return `${IMAGE_CACHE_PREFIX}${rv}/${ns}/${version}/${id}@${scale}+${tagOffset}.${ext}`;
}
