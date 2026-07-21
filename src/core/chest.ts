/**
 * @fileoverview チェストなどのブロックエンティティのモデル生成とテクスチャマッピング。
 * チェストはブロックエンティティです。そのモデルは `builtin/entity` でエレメントを持たず、
 * テクスチャは通常の平面的なアイテム/ブロック用ではなく、エンティティ用アトラス（64x64）に存在します。
 * 通常のパイプラインで描画できるように、ボックスモデルとアトラスUVを合成します。
 * UVはアトラスのピクセル単位（0..64）であり、レンダラーが face.uv を処理する方法と一致します。
 * 標準的なマインクラフトのボックス展開方式を使用します。
 */

/**
 * マインクラフトのテクスチャ展開ルールに従って、ボックスの各面のUV座標を計算します。
 * @param tx アトラス上でのテクスチャXオフセット
 * @param ty アトラス上でのテクスチャYオフセット
 * @param w ボックスの幅 (width)
 * @param h ボックスの高さ (height)
 * @param d ボックスの奥行き (depth)
 * @returns 各面のUV設定オブジェクト
 */
function boxFaces(tx: number, ty: number, w: number, h: number, d: number) {
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
 * 定義された各面に `#chest` テクスチャバインディングとUVを設定したオブジェクトを返します。
 * @param faces 各面のUV情報を持つオブジェクト
 * @returns テクスチャ名が割り当てられた面オブジェクト
 */
function withTexture(faces: any) {
    const out: any = {};
    for (const dir of Object.keys(faces)) out[dir] = { texture: '#chest', uv: faces[dir].uv };
    return out;
}

/**
 * チェストのバリアントに基づき、合成されたモデルデータを生成します。
 * @param variant チェストの種類（'normal', 'trapped', 'ender' など）
 * @returns 合成されたチェストのモデルオブジェクト
 */
export function chestModel(variant: string): any {
    return {
        textures: { chest: `entity/chest/${variant}` },
        elements: [
            // 下部ボックス: 14w x 10h x 14d, アトラスオフセット (0,19)
            { from: [1, 0, 1], to: [15, 10, 15], faces: withTexture(boxFaces(0, 19, 14, 10, 14)) },
            // 蓋部ボックス: 14w x 5h x 14d （上部乗せ）, アトラスオフセット (0,0)
            { from: [1, 10, 1], to: [15, 15, 15], faces: withTexture(boxFaces(0, 0, 14, 5, 14)) },
        ],
    };
}

/** チェストの種類からアトラス画像名へのマッピングテーブル。 */
export const CHEST_VARIANTS: Record<string, string> = {
    chest: 'normal',
    trapped_chest: 'trapped',
    ender_chest: 'ender',
};
