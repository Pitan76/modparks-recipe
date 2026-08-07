/**
 * @fileoverview 頭部ブロック（スケルトンの頭など）のモデル生成。
 *
 * 頭部はチェストと同じブロックエンティティです。バニラの jar にはアイテム用のテクスチャもモデルも
 * 無く、絵はモブのエンティティテクスチャの中にあります。そのため通常の解決経路では何も見つからず、
 * レシピの素材として置かれると空きスロットになります。ここで箱モデルを合成して描けるようにします。
 *
 * ドラゴンの頭は含めません。単純な箱ではなく、専用のモデルとテクスチャ配置を持つためです。
 */

import { boxFaces, withTexture } from './entity-box';

/** 頭部の一辺（ピクセル）。 */
const HEAD_SIZE = 8;

/**
 * 頭部アイテムから、絵のあるエンティティテクスチャへの対応表。
 *
 * プレイヤーの頭は着せ替えで中身が変わるため、既定のスキンを充てます。
 */
export const SKULL_TEXTURES: Record<string, string> = {
  skeleton_skull: 'entity/skeleton/skeleton',
  wither_skeleton_skull: 'entity/skeleton/wither_skeleton',
  zombie_head: 'entity/zombie/zombie',
  creeper_head: 'entity/creeper/creeper',
  piglin_head: 'entity/piglin/piglin',
  player_head: 'entity/player/wide/steve',
};

/**
 * 頭部の合成モデルを作ります。
 *
 * 箱は床置きの頭と同じ 8x8x8 で、水平方向は中央に寄せます。テクスチャ上の頭は左上（0,0）から
 * 始まる決まりなので、オフセットは固定で構いません。
 * @param texture エンティティテクスチャのパス
 */
export function skullModel(texture: string): any {
  const box = boxFaces(0, 0, HEAD_SIZE, HEAD_SIZE, HEAD_SIZE);
  // 頭は箱そのものが上下反転して定義されるチェストと違い、そのままの向きで置かれます。
  // 入れ替えないと頭頂に底面（首の穴）が来て、穴が開いて見えます。
  const faces = withTexture({ ...box, up: box.down, down: box.up }, '#skin');
  return {
    textures: { skin: texture },
    elements: [{ from: [4, 0, 4], to: [12, HEAD_SIZE, 12], faces }],
  };
}
