// Minecraft block-model geometry shared by both renderers: the Worker-side SVG
// renderer (utils/model-parser.ts) and the offline node-canvas renderer
// (scripts/render-blocks/render.ts). Both must agree on face winding, default
// UVs, shading and framing, otherwise a block pushed through the write API
// looks different from the same block rendered offline.

export interface Vec3 { x: number; y: number; z: number }
export interface Vec2 { x: number; y: number }

export type Axis = 'x' | 'y' | 'z';

/** GUI display transform, with vanilla defaults filled in. */
export interface GuiTransform {
    rotation: number[];
    scale: number[];
    translation: number[];
}

/** Element-level rotation as it appears in model JSON. */
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

/** Vanilla face brightness multipliers (1.0 = unshaded). */
const BRIGHTNESS: Record<string, number> = {
    up: 1.0,
    north: 0.4,
    south: 0.4,
    east: 0.6,
    west: 0.6,
    down: 0.2,
};

export function rotateVec(v: Vec3, axis: string, angleDeg: number): Vec3 {
    const r = angleDeg * Math.PI / 180;
    const c = Math.cos(r), s = Math.sin(r);
    if (axis === 'x') return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
    if (axis === 'y') return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
    if (axis === 'z') return { x: v.x * c - v.y * s, y: v.x * s + v.y * c, z: v.z };
    return v;
}

/** GUI display block of a resolved model, with vanilla defaults for gaps. */
export function guiTransform(model: any): GuiTransform {
    const gui = model?.display?.gui;
    if (!gui) return DEFAULT_GUI;
    return {
        rotation: gui.rotation || DEFAULT_GUI.rotation,
        scale: gui.scale || DEFAULT_GUI.scale,
        translation: gui.translation || DEFAULT_GUI.translation,
    };
}

/** UVs a face falls back to when the model omits them. */
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
 * The four corners of a face in model space, wound so that index 0 is the UV
 * origin, 1 is the +u end and 3 is the +v end. Null for an unknown direction.
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

export function faceBrightness(dir: string): number {
    return BRIGHTNESS[dir] ?? 1.0;
}

/** Rotate a face about its element's rotation origin. */
export function applyElementRotation(pts: Vec3[], rotation: ElementRotation | undefined): Vec3[] {
    if (!rotation) return pts;
    const [ox, oy, oz] = rotation.origin;
    return pts.map(p => {
        const np = rotateVec({ x: p.x - ox, y: p.y - oy, z: p.z - oz }, rotation.axis, rotation.angle);
        return { x: np.x + ox, y: np.y + oy, z: np.z + oz };
    });
}

/**
 * Apply the GUI display transform: recenter on the model centre, rotate Y then
 * X then Z, scale, translate. Rotations do not commute, so the order is what
 * gives vanilla-looking icons — do not reorder.
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

export function centroidZ(pts: Vec3[]): number {
    return pts.reduce((s, p) => s + p.z, 0) / pts.length;
}

/** Project to screen space (y grows downward). */
export function project(pts: Vec3[]): Vec2[] {
    return pts.map(p => ({ x: p.x, y: -p.y }));
}

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

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
 * Affine transform mapping UV space onto the face's screen quad, as the
 * six components of `matrix(a, b, c, d, e, f)` / `setTransform`. Null when the
 * UV rect is degenerate and nothing can be drawn.
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

/**
 * Projected size (in model units) of a canonical full 16³ block under the
 * default GUI transform. Used as a FIXED normalization denominator so that
 * small blocks (buttons, slabs, ...) render smaller than full blocks instead of
 * each being stretched to fill the frame.
 */
export const REF_SIZE = (() => {
    const corners: Vec3[] = [];
    for (const x of [0, 16]) for (const y of [0, 16]) for (const z of [0, 16]) corners.push({ x, y, z });
    const { minX, minY, maxX, maxY } = boundsOf([project(applyGuiTransform(corners, DEFAULT_GUI))]);
    return Math.max(maxX - minX, maxY - minY);
})();

/**
 * Frame size as a multiple of REF_SIZE: a full cube occupies 1/FRAME_MARGIN of
 * the frame and the rest is padding. Both renderers read this, so their output
 * stays interchangeable.
 *
 * Calibrated against the reference renderer (mcrecipe.pitan76.net): a full
 * block's silhouette there measures 28x30 inside a 32px slot, where 1/0.9
 * produced 26x28.
 */
export const FRAME_MARGIN = 28 / 27;

/**
 * Model parents that mean "draw this item as a flat 2D sprite". A torch's item
 * model is `item/generated` over the block/torch texture, so the game shows the
 * sprite rather than the 3D torch; renderers must honour that instead of
 * reaching for the block model.
 */
export const FLAT_ITEM_PARENTS = new Set([
    'minecraft:item/generated', 'item/generated',
    'minecraft:item/handheld', 'item/handheld',
]);
