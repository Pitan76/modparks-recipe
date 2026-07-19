// Chests are block entities: their models are `builtin/entity` with no
// elements, and the texture lives in the entity atlas (64x64) rather than a
// flat item/block texture. Synthesize a box model + atlas UVs so the normal
// pipeline can draw them. UVs are in atlas pixels (0..64), matching how the
// renderer treats face.uv. Uses the standard Minecraft box unwrap.
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

function withTexture(faces: any) {
    const out: any = {};
    for (const dir of Object.keys(faces)) out[dir] = { texture: '#chest', uv: faces[dir].uv };
    return out;
}

export function chestModel(variant: string): any {
    return {
        textures: { chest: `entity/chest/${variant}` },
        elements: [
            // Bottom box: 14w x 10h x 14d, atlas offset (0,19)
            { from: [1, 0, 1], to: [15, 10, 15], faces: withTexture(boxFaces(0, 19, 14, 10, 14)) },
            // Lid box: 14w x 5h x 14d sitting on top, atlas offset (0,0)
            { from: [1, 10, 1], to: [15, 15, 15], faces: withTexture(boxFaces(0, 0, 14, 5, 14)) },
        ],
    };
}

export const CHEST_VARIANTS: Record<string, string> = {
    chest: 'normal',
    trapped_chest: 'trapped',
    ender_chest: 'ender',
};
