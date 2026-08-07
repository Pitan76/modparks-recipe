/**
 * @fileoverview エンティティのテクスチャを箱モデルに貼るための展開規則。
 *
 * チェストや頭部のようなブロックエンティティは、モデルにエレメントを持たず（`builtin/entity`）、
 * 絵はエンティティ用のテクスチャにあります。通常の描画経路へ載せるには、箱の形とUVを合成します。
 *
 * UVはテクスチャの実ピクセル単位です。展開はマインクラフトのエンティティモデルと同じで、
 * 上下面が入れ替わって見えるのは、エンティティの箱がY軸を反転した座標で定義されるためです。
 */

/** 箱の各面のUV。 */
export type BoxFaces = Record<string, { uv: number[] }>;

/**
 * 箱の各面のUV座標を計算します。
 * @param tx テクスチャ上のXオフセット
 * @param ty テクスチャ上のYオフセット
 * @param w 箱の幅
 * @param h 箱の高さ
 * @param d 箱の奥行き
 */
export function boxFaces(tx: number, ty: number, w: number, h: number, d: number): BoxFaces {
  return {
    up:    { uv: [tx + d + w, ty, tx + d + 2 * w, ty + d] },
    down:  { uv: [tx + d, ty, tx + d + w, ty + d] },
    east:  { uv: [tx, ty + d, tx + d, ty + d + h] },
    north: { uv: [tx + d, ty + d, tx + d + w, ty + d + h] },
    west:  { uv: [tx + d + w, ty + d, tx + 2 * d + w, ty + d + h] },
    south: { uv: [tx + 2 * d + w, ty + d, tx + 2 * d + 2 * w, ty + d + h] },
  };
}

/**
 * 各面に同じテクスチャを割り当てます。
 * @param faces 面ごとのUV
 * @param texture モデル内のテクスチャ参照名（`#skin` など）
 */
export function withTexture(faces: BoxFaces, texture: string): any {
  const out: any = {};
  for (const dir of Object.keys(faces)) out[dir] = { texture, uv: faces[dir].uv };
  return out;
}
