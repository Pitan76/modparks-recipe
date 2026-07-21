/**
 * @fileoverview 両方のレンダラー（Worker側のSVGレンダラー `core/model-parser.ts` と、オフラインのnode-canvasレンダラー `scripts/render-blocks/render.ts`）で共有されるMinecraft of ブロックモデルのジオメトリ。
 * 両者は、面のワインディング、デフォルトのUV、シェーディング、およびフレーミングが一致している必要があります。
 * そうしないと、書き込みAPI経由で送信されたブロックが、オフラインでレンダリングされた同じブロックと異なって表示されてしまいます。
 */

import { Vec3, Vec2, Axis, rotateVec, project, boundsOf } from './math';

/** バニラのデフォルト値が補完された、GUI表示のトランスフォーム。 */
export interface GuiTransform {
    rotation: number[];
    scale: number[];
    translation: number[];
}

/** モデルJSONに定義されている、エレメントレベルの回転。 */
export interface ElementRotation {
    origin: number[];
    axis: Axis;
    angle: number;
}

const DEFAULT_GUI: GuiTransform = {
    rotation: [30, 225, 0],
    scale: [0.625, 0.625, 0.625],
    translation: [0, 0, 0],
};

const MODEL_CENTER: Vec3 = { x: 8, y: 8, z: 8 };

/**
 * 面の明るさの倍率（1.0 = シェーディングなし）。
 *
 * 参照レンダラー（mcrecipe.pitan76.net）を基準に調整されています。
 * 2つの異なるブロックで面全体の平均輝度を測定したところ、上面と北/南面は正確に一致し、
 * 東/西面だけが 0.6 だと 0.922 倍暗すぎたため、0.651 に設定しました。
 * （GUI投影で左側に見える面が東/西、右側が北/南です。北/南を変更すると右側の面が変化する
 * ことで対応を確認しました。）下面はGUI投影では見えないため、以前の値のままです。
 */
const BRIGHTNESS: Record<string, number> = {
    up: 1.0,
    north: 0.4,
    south: 0.4,
    east: 0.651,
    west: 0.651,
    down: 0.2,
};

/**
 * 解決済みモデルのGUI表示用トランスフォームを取得します。未定義の部分はバニラのデフォルトで補完されます。
 * @param model モデルデータ
 * @returns GUIトランスフォーム
 */
export function guiTransform(model: any): GuiTransform {
    const gui = model?.display?.gui;
    if (!gui) return DEFAULT_GUI;
    return {
        rotation: gui.rotation || DEFAULT_GUI.rotation,
        scale: gui.scale || DEFAULT_GUI.scale,
        translation: gui.translation || DEFAULT_GUI.translation,
    };
}

/**
 * モデルでUVが省略されている場合に、面がフォールバックするデフォルトのUV。
 * @param dir 方向（面）
 * @param from 開始座標 [x, y, z]
 * @param to 終了座標 [x, y, z]
 * @returns デフォルトのUV座標配列 [u1, v1, u2, v2]
 */
export function defaultUv(dir: string, from: number[], to: number[]): number[] {
    switch (dir) {
        case 'north': return [16 - to[0], 16 - to[1], 16 - from[0], 16 - from[1]];
        case 'south': return [from[0], 16 - to[1], to[0], 16 - from[1]];
        case 'west': return [from[2], 16 - to[1], to[2], 16 - from[1]];
        case 'east': return [16 - to[2], 16 - to[1], 16 - from[2], 16 - from[1]];
        case 'up': return [from[0], from[2], to[0], to[2]];
        case 'down': return [from[0], 16 - to[2], to[0], 16 - from[2]];
        default: return [0, 0, 16, 16];
    }
}

/**
 * モデル空間における面の4つの角の座標を取得します。
 * インデックス0がUVの起点、1が+u端、3が+v端になるように巻かれています（時計回り/反時計回り）。
 * 不明な方向の場合は null を返します。
 * @param dir 方向（面）
 * @param from 開始座標 [x, y, z]
 * @param to 終了座標 [x, y, z]
 * @returns 頂点座標の配列、または null
 */
export function faceVertices(dir: string, from: number[], to: number[]): Vec3[] | null {
    switch (dir) {
        case 'north': return [
            { x: to[0], y: to[1], z: from[2] },
            { x: from[0], y: to[1], z: from[2] },
            { x: from[0], y: from[1], z: from[2] },
            { x: to[0], y: from[1], z: from[2] },
        ];
        case 'south': return [
            { x: from[0], y: to[1], z: to[2] },
            { x: to[0], y: to[1], z: to[2] },
            { x: to[0], y: from[1], z: to[2] },
            { x: from[0], y: from[1], z: to[2] },
        ];
        case 'west': return [
            { x: from[0], y: to[1], z: from[2] },
            { x: from[0], y: to[1], z: to[2] },
            { x: from[0], y: from[1], z: to[2] },
            { x: from[0], y: from[1], z: from[2] },
        ];
        case 'east': return [
            { x: to[0], y: to[1], z: to[2] },
            { x: to[0], y: to[1], z: from[2] },
            { x: to[0], y: from[1], z: from[2] },
            { x: to[0], y: from[1], z: to[2] },
        ];
        case 'up': return [
            { x: from[0], y: to[1], z: from[2] },
            { x: to[0], y: to[1], z: from[2] },
            { x: to[0], y: to[1], z: to[2] },
            { x: from[0], y: to[1], z: to[2] },
        ];
        case 'down': return [
            { x: from[0], y: from[1], z: to[2] },
            { x: to[0], y: from[1], z: to[2] },
            { x: to[0], y: from[1], z: from[2] },
            { x: from[0], y: from[1], z: from[2] },
        ];
        default: return null;
    }
}

/**
 * 指定された方向の面の明るさを取得します。
 * @param dir 方向（面）
 * @returns 明るさの倍率
 */
export function faceBrightness(dir: string): number {
    return BRIGHTNESS[dir] ?? 1.0;
}

/**
 * 面をそのエレメントの回転起点を中心に回転させます。
 * @param pts 頂点座標の配列
 * @param rotation エレメントの回転設定
 * @returns 回転適用後の頂点座標の配列
 */
export function applyElementRotation(pts: Vec3[], rotation: ElementRotation | undefined): Vec3[] {
    if (!rotation) return pts;
    const [ox, oy, oz] = rotation.origin;
    return pts.map(p => {
        const np = rotateVec({ x: p.x - ox, y: p.y - oy, z: p.z - oz }, rotation.axis, rotation.angle);
        return { x: np.x + ox, y: np.y + oy, z: np.z + oz };
    });
}

/**
 * GUI表示用トランスフォームを適用します。
 * 具体的には、モデルの中心への再配置、Y軸・X軸・Z軸の順での回転、スケーリング、平行移動を行います。
 * 回転は交換法則が成り立たないため、この順序がバニラ風のアイコンを再現する鍵となります。順序を変更しないでください。
 * @param pts 頂点座標の配列
 * @param gui GUIトランスフォーム
 * @returns 変換適用後の頂点座標の配列
 */
export function applyGuiTransform(pts: Vec3[], gui: GuiTransform): Vec3[] {
    const { rotation, scale, translation } = gui;
    return pts.map(p => {
        let np: Vec3 = { x: p.x - MODEL_CENTER.x, y: p.y - MODEL_CENTER.y, z: p.z - MODEL_CENTER.z };
        np = rotateVec(np, 'y', rotation[1]);
        np = rotateVec(np, 'x', rotation[0]);
        np = rotateVec(np, 'z', rotation[2]);
        return {
            x: np.x * scale[0] + translation[0],
            y: np.y * scale[1] + translation[1],
            z: np.z * scale[2] + translation[2],
        };
    });
}

/**
 * デフォルトのGUIトランスフォーム下における、標準的なフルサイズ（16³）ブロックの投影サイズ（モデル単位）。
 * 固定の正規化分母として使用され、小さいブロック（ボタン、ハーフブロックなど）がフレームいっぱいに引き伸ばされず、
 * フルサイズのブロックよりも小さく描画されるようにします。
 */
export const REF_SIZE = (() => {
    const corners: Vec3[] = [];
    for (const x of [0, 16]) for (const y of [0, 16]) for (const z of [0, 16]) corners.push({ x, y, z });
    const { minX, minY, maxX, maxY } = boundsOf([project(applyGuiTransform(corners, DEFAULT_GUI))]);
    return Math.max(maxX - minX, maxY - minY);
})();

/**
 * `REF_SIZE` の倍数としてのフレームサイズ。フルサイズの立方体はフレームの 1/FRAME_MARGIN を占め、残りは余白になります。
 * 両方のレンダラーがこの値を参照するため、出力の互換性が維持されます。
 *
 * 参照レンダラー（mcrecipe.pitan76.net）を基準に調整されています。
 * そちらのフルブロックのシルエットは 32px のスロット内で 28x30 であり、1/0.9 だと 26x28 になっていました。
 */
export const FRAME_MARGIN = 28 / 27;

/**
 * 「このアイテムをフラットな2Dスプライトとして描画する」ことを意味するモデルの親（parent）。
 * 例えば松明のアイテムモデルは `block/torch` テクスチャの上に `item/generated` を指定しているため、
 * ゲーム内では3Dの松明ではなくスプライトが表示されます。
 * レンダラーはブロックモデルを参照するのではなく、この挙動に従う必要があります。
 */
export const FLAT_ITEM_PARENTS = new Set([
    'minecraft:item/generated', 'item/generated',
    'minecraft:item/handheld', 'item/handheld',
]);
