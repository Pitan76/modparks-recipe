/**
 * @fileoverview Minecraftのアニメーションメタデータ（.mcmeta）を解釈するユーティリティ。
 */

import type { AssetReader } from './asset-reader';

export interface McmetaFrame {
  index: number;
  time: number; // 単位: ゲームチック（1/20秒）
}

export interface McmetaAnimation {
  interpolate: boolean;
  width?: number;
  height?: number;
  frametime: number;
  frames: McmetaFrame[];
}

/**
 * .mcmetaファイルの内容をパースします。
 * @param text メタデータのテキスト
 * @param w テクスチャの幅
 * @param h テクスチャの高さ
 */
export function parseMcmeta(text: string, w: number, h: number): McmetaAnimation | null {
  try {
    const json = JSON.parse(text);
    if (!json || typeof json.animation !== 'object') return null;

    const anim = json.animation;
    const frametime = typeof anim.frametime === 'number' ? anim.frametime : 1;
    const interpolate = anim.interpolate === true;

    const frames: McmetaFrame[] = [];
    if (Array.isArray(anim.frames)) {
      for (const f of anim.frames) {
        if (typeof f === 'number') {
          frames.push({ index: f, time: frametime });
        } else if (f && typeof f === 'object' && typeof f.index === 'number') {
          frames.push({ index: f.index, time: typeof f.time === 'number' ? f.time : frametime });
        }
      }
    } else {
      // framesが指定されていない場合は、縦横比からフレーム数を算出し、順番に再生します。
      const frameCount = Math.floor(h / w);
      for (let i = 0; i < frameCount; i++) {
        frames.push({ index: i, time: frametime });
      }
    }

    return {
      interpolate,
      width: anim.width || w,
      height: anim.height || h,
      frametime,
      frames,
    };
  } catch {
    return null;
  }
}

/**
 * 指定されたテクスチャパスに対応するアニメーションメタデータを取得します。
 * @param ns ネームスペース
 * @param texPath テクスチャの相対パス（例: "textures/block/prismarine.png"）
 * @param src アセットリーダー
 * @param w テクスチャの幅（mcmetaにframesがない場合の算出用）
 * @param h テクスチャの高さ（mcmetaにframesがない場合の算出用）
 */
export async function getTextureAnimation(
  ns: string,
  texPath: string,
  src: AssetReader,
  w: number,
  h: number
): Promise<McmetaAnimation | null> {
  const metaPath = texPath.endsWith('.png') ? `${texPath}.mcmeta` : `${texPath}.png.mcmeta`;
  const obj = await src.get(ns, metaPath);
  if (!obj) return null;

  try {
    const text = await obj.text();
    return parseMcmeta(text, w, h);
  } catch {
    return null;
  }
}

/**
 * 指定されたtick（時間）におけるアニメーションのフレームインデックスを計算します。
 * @param anim アニメーション定義
 * @param tick 現在の時刻（ゲームチック単位）
 */
export function getFrameIndexForTick(anim: McmetaAnimation, tick: number): number {
  if (anim.frames.length === 0) return 0;

  let totalTicks = 0;
  for (const f of anim.frames) totalTicks += f.time;

  const currentTick = tick % totalTicks;

  let accumulatedTicks = 0;
  for (const f of anim.frames) {
    accumulatedTicks += f.time;
    if (currentTick < accumulatedTicks) {
      return f.index;
    }
  }
  return anim.frames[0].index;
}
