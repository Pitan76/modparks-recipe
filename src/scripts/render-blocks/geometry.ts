// 3D math helpers and the fixed normalization reference size.

export interface Vec3 { x: number; y: number; z: number }
export interface Vec2 { x: number; y: number }

export function rotateVec(v: Vec3, axis: string, angleDeg: number): Vec3 {
    const r = angleDeg * Math.PI / 180;
    const c = Math.cos(r), s = Math.sin(r);
    if (axis === 'x') return { x: v.x, y: v.y*c - v.z*s, z: v.y*s + v.z*c };
    if (axis === 'y') return { x: v.x*c + v.z*s, y: v.y, z: -v.x*s + v.z*c };
    if (axis === 'z') return { x: v.x*c - v.y*s, y: v.x*s + v.y*c, z: v.z };
    return v;
}

// Projected size (in model units) of a canonical full 16³ block under the
// default GUI transform. Used as a FIXED normalization denominator so that
// small blocks (buttons, slabs, ...) render smaller than full blocks instead of
// each being stretched to fill the frame.
function referenceProjectedSize(): number {
    const rot = [30, 225, 0], scale = [0.625, 0.625, 0.625];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const x of [0, 16]) for (const y of [0, 16]) for (const z of [0, 16]) {
        let np: Vec3 = { x: x - 8, y: y - 8, z: z - 8 };
        np = rotateVec(np, 'y', rot[1]);
        np = rotateVec(np, 'x', rot[0]);
        np = rotateVec(np, 'z', rot[2]);
        const px = np.x * scale[0];
        const py = -(np.y * scale[1]);
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
    }
    return Math.max(maxX - minX, maxY - minY);
}

export const REF_SIZE = referenceProjectedSize();
