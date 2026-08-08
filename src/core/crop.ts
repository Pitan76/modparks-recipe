/**
 * @fileoverview 余白のクリッピング。切り抜きはブラウザ側で行い、その量と幾何だけをここで決めます。
 *
 * サーバーで切り抜くと、crop の値ごとに別の絵になってL1のキーが分かれます。同じレシピの
 * 同じ絵をクリップ量の数だけラスタライズしてR2に置くことになり、見た目の調整のために
 * レンダリング回数と保管オブジェクトが倍々に増えます。切り抜きは配ったあとのCSSで足ります。
 *
 * 依存を持たない純粋な形にしてあるのは、検索ページと埋め込み側の双方から同じ計算を読ませるためです。
 */

/** 背景のネイティブ解像度。クリップ量はこの座標系のpxで数えます。 */
export const NATIVE_W = 118;
export const NATIVE_H = 56;

/** 余白をクリップしない既定値。 */
export const DEFAULT_CROP = 0;

/**
 * クリップできる上限（ネイティブpx）。
 * ここを超えるとスロットの中身まで削れて、何のレシピか読めない絵になります。
 */
export const MAX_CROP = 8;

/** 切り抜きを表現するための寸法。いずれも百分率です。 */
export type CropGeometry = {
  /** 切り抜き後の縦横比。枠の高さを決めるのに使います。 */
  aspectRatio: string;
  /** 枠に対する画像の幅・高さ。 */
  width: string;
  height: string;
  /** 枠に対する画像の左上位置。負の値で外へ押し出します。 */
  left: string;
  top: string;
};

/**
 * クリップ量を受け付ける範囲へ丸めます。
 * @param value 判定対象の値
 * @returns 正規化されたクリップ量（ネイティブpx）
 */
export function normalizeCrop(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) return DEFAULT_CROP;
  return Math.min(n, MAX_CROP);
}

/**
 * 上下左右から均等に削るための寸法を求めます。
 *
 * すべて百分率で返すのは、表示倍率やデバイスピクセル比に関係なく同じ切り抜きにするためです。
 * pxで返すと、拡大率を変えるたびに削れる量がずれます。
 * @param crop 削る量（ネイティブpx）
 */
export function cropGeometry(crop: number): CropGeometry {
  const n = normalizeCrop(crop);
  const w = NATIVE_W - n * 2;
  const h = NATIVE_H - n * 2;
  return {
    aspectRatio: `${w} / ${h}`,
    width: `${(NATIVE_W / w) * 100}%`,
    height: `${(NATIVE_H / h) * 100}%`,
    left: `${(-n / w) * 100}%`,
    top: `${(-n / h) * 100}%`,
  };
}
