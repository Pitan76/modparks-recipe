/**
 * @fileoverview 3Dレンダリングやジオメトリ計算のための汎用的な数学およびベクトル・ユーティリティ。
 */

/** 3次元の座標を表すインターフェース。 */
export interface Vec3 { x: number; y: number; z: number }

/** 2次元の座標を表すインターフェース。 */
export interface Vec2 { x: number; y: number }

/** 回転の軸。 */
export type Axis = 'x' | 'y' | 'z';

/** 2次元の境界ボックス（バウンディングボックス）。 */
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

/**
 * ベクトルを指定された軸を中心に指定された角度（度）だけ回転させます。
 * @param v 回転対象のベクトル
 * @param axis 回転軸（'x', 'y', 'z'）
 * @param angleDeg 回転角度（度数法）
 * @returns 回転後のベクトル
 */
export function rotateVec(v: Vec3, axis: string, angleDeg: number): Vec3 {
    const r = angleDeg * Math.PI / 180;
    const c = Math.cos(r), s = Math.sin(r);
    if (axis === 'x') return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
    if (axis === 'y') return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
    if (axis === 'z') return { x: v.x * c - v.y * s, y: v.x * s + v.y * c, z: v.z };
    return v;
}

/**
 * 頂点座標の配列から、Z軸の重心（中心座標）を計算します。
 * @param pts 頂点座標の配列
 * @returns Z軸の重心
 */
export function centroidZ(pts: Vec3[]): number {
    return pts.reduce((s, p) => s + p.z, 0) / pts.length;
}

/**
 * スクリーン空間（y軸が下向きに増加）へ投影します。
 * @param pts 3次元頂点座標の配列
 * @returns 2次元頂点座標の配列
 */
export function project(pts: Vec3[]): Vec2[] {
    return pts.map(p => ({ x: p.x, y: -p.y }));
}

/**
 * ポリゴン群の境界ボックス（最小・最大座標）を計算します。
 * @param polygons 2次元ポリゴンの配列
 * @returns 境界ボックス
 */
export function boundsOf(polygons: Vec2[][]): Bounds {
    const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const poly of polygons) {
        for (const p of poly) {
            if (p.x < b.minX) b.minX = p.x;
            if (p.y < b.minY) b.minY = p.y;
            if (p.x > b.maxX) b.maxX = p.x;
            if (p.y > b.maxY) b.maxY = p.y;
        }
    }
    return b;
}

/**
 * UV空間を面のスクリーン四角形にマッピングするアフィン変換行列を、
 * `matrix(a, b, c, d, e, f)` / `setTransform` の6つの成分として取得します。
 * UV矩形が退化していて何も描画できない場合は null を返します。
 * @param p スクリーンの頂点座標の配列（2次元）
 * @param uv UV座標 [u1, v1, u2, v2]
 * @returns 6つの変換行列成分の配列、または null
 */
export function uvMatrix(p: Vec2[], uv: number[]): number[] | null {
    const [u1, v1, u2, v2] = uv;
    const sw = u2 - u1;
    const sh = v2 - v1;
    if (sw === 0 || sh === 0) return null;

    const a = (p[1].x - p[0].x) / sw;
    const b = (p[1].y - p[0].y) / sw;
    const c = (p[3].x - p[0].x) / sh;
    const d = (p[3].y - p[0].y) / sh;
    return [a, b, c, d, p[0].x - a * u1 - c * v1, p[0].y - b * u1 - d * v1];
}
