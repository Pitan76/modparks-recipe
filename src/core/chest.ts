/**
 * @fileoverview チェストなどのブロックエンティティのモデル生成とテクスチャマッピング。
 * チェストはブロックエンティティです。そのモデルは `builtin/entity` でエレメントを持たず、
 * テクスチャは通常の平面的なアイテム/ブロック用ではなく、エンティティ用アトラス（64x64）に存在します。
 * 通常のパイプラインで描画できるように、ボックスモデルとアトラスUVを合成します。
 * UVはアトラスのピクセル単位（0..64）であり、レンダラーが face.uv を処理する方法と一致します。
 * 標準的なマインクラフトのボックス展開方式を使用します。展開そのものは頭部とも共通なので
 * `entity-box.ts` に置いています。
 */

import { boxFaces, withTexture } from './entity-box';

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
            { from: [1, 0, 1], to: [15, 10, 15], faces: withTexture(boxFaces(0, 19, 14, 10, 14), '#chest') },
            // 蓋部ボックス: 14w x 5h x 14d （上部乗せ）, アトラスオフセット (0,0)
            { from: [1, 10, 1], to: [15, 15, 15], faces: withTexture(boxFaces(0, 0, 14, 5, 14), '#chest') },
        ],
    };
}

/** チェストの種類からアトラス画像名へのマッピングテーブル。 */
export const CHEST_VARIANTS: Record<string, string> = {
    chest: 'normal',
    trapped_chest: 'trapped',
    ender_chest: 'ender',
};
