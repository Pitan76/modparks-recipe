export interface Vector3 { x: number, y: number, z: number }

export function rotateX(v: Vector3, angle: number): Vector3 {
    const rad = angle * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return { x: v.x, y: v.y * cos - v.z * sin, z: v.y * sin + v.z * cos };
}
export function rotateY(v: Vector3, angle: number): Vector3 {
    const rad = angle * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return { x: v.x * cos + v.z * sin, y: v.y, z: -v.x * sin + v.z * cos };
}
export function rotateZ(v: Vector3, angle: number): Vector3 {
    const rad = angle * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos, z: v.z };
}

/**
 * Projected size (in model units) of a canonical full 16³ block under the
 * default GUI transform, used as the fixed framing denominator. Mirrors
 * REF_SIZE in scripts/render-blocks/geometry.ts so both renderers agree on how
 * large a full block appears in its slot.
 */
const REFERENCE_BLOCK_SIZE = (() => {
    const rot = [30, 225, 0];
    const s = 0.625;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const x of [0, 16]) for (const y of [0, 16]) for (const z of [0, 16]) {
        let np: Vector3 = { x: x - 8, y: y - 8, z: z - 8 };
        np = rotateY(np, rot[1]);
        np = rotateX(np, rot[0]);
        np = rotateZ(np, rot[2]);
        const px = np.x * s;
        const py = -(np.y * s);
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
    }
    return Math.max(maxX - minX, maxY - minY);
})();

// Recursively load and merge models
export async function loadModel(
    modelId: string, 
    getModelJson: (id: string) => Promise<any>
): Promise<any> {
    const model = await getModelJson(modelId);
    if (!model) return null;

    if (model.parent) {
        let parentId = model.parent;
        if (!parentId.startsWith('minecraft:') && !parentId.includes(':')) {
            parentId = 'minecraft:' + parentId;
        }
        const parentModel = await loadModel(parentId, getModelJson);
        if (parentModel) {
            const mergedTextures = { ...(parentModel.textures || {}), ...(model.textures || {}) };
            const mergedElements = model.elements || parentModel.elements;
            const mergedDisplay = { ...(parentModel.display || {}), ...(model.display || {}) };
            return {
                ...parentModel,
                ...model,
                textures: mergedTextures,
                elements: mergedElements,
                display: mergedDisplay
            };
        }
    }
    return model;
}

export function resolveTexture(texName: string, textures: any): string | null {
    if (!texName) return null;
    let current = texName.startsWith('#') ? texName.substring(1) : texName;
    let visited = new Set();
    while (textures && textures[current]) {
        if (visited.has(current)) break;
        visited.add(current);
        let next = textures[current];
        if (next.startsWith('#')) {
            current = next.substring(1);
        } else {
            return next;
        }
    }
    if (current && !current.startsWith('#') && visited.size === 0) return current;
    return null;
}

export async function renderModelToSvg(
    modelId: string,
    getModelJson: (id: string) => Promise<any>,
    getTextureBase64: (path: string) => Promise<string | null>
): Promise<string | null> {
    const model = await loadModel(modelId, getModelJson);
    if (!model) return null;

    // 2D items: just wrap the texture
    if (model.parent === 'minecraft:item/generated' || model.parent === 'item/generated' || model.parent === 'minecraft:item/handheld' || model.parent === 'item/handheld') {
        const texPath = resolveTexture('#layer0', model.textures);
        if (texPath) {
            const b64 = await getTextureBase64(texPath);
            if (b64) {
                return `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><image href="${b64}" width="16" height="16" image-rendering="optimizeSpeed"/></svg>`;
            }
        }
        return null;
    }

    if (!model.elements) return null;

    // GUI display transform from the model
    let guiDisplay = model.display?.gui || { rotation: [30, 225, 0], translation: [0, 0, 0], scale: [0.625, 0.625, 0.625] };
    let rotXAngle = guiDisplay.rotation?.[0] || 0;
    let rotYAngle = guiDisplay.rotation?.[1] || 0;
    let rotZAngle = guiDisplay.rotation?.[2] || 0;
    let scale = guiDisplay.scale || [1, 1, 1];
    let trans = guiDisplay.translation || [0, 0, 0];

    const facesToRender: any[] = [];

    for (const el of model.elements) {
        const from = el.from;
        const to = el.to;
        const elRot = el.rotation;
        
        for (const [dir, face] of Object.entries(el.faces) as [string, any][]) {
            const texPath = resolveTexture(face.texture, model.textures);
            if (!texPath) continue;

            const b64 = await getTextureBase64(texPath);
            if (!b64) continue;

            let p00: Vector3, p10: Vector3, p01: Vector3, p11: Vector3;
            let uv = face.uv;
            if (!uv) {
                switch(dir) {
                    case 'north': uv = [16 - to[0], 16 - to[1], 16 - from[0], 16 - from[1]]; break;
                    case 'south': uv = [from[0], 16 - to[1], to[0], 16 - from[1]]; break;
                    case 'west':  uv = [from[2], 16 - to[1], to[2], 16 - from[1]]; break;
                    case 'east':  uv = [16 - to[2], 16 - to[1], 16 - from[2], 16 - from[1]]; break;
                    case 'up':    uv = [from[0], from[2], to[0], to[2]]; break;
                    case 'down':  uv = [from[0], 16 - to[2], to[0], 16 - from[2]]; break;
                    default: uv = [0, 0, 16, 16];
                }
            }

            if (dir === 'north') { // -z
                p00 = { x: to[0], y: to[1], z: from[2] };
                p10 = { x: from[0], y: to[1], z: from[2] };
                p01 = { x: to[0], y: from[1], z: from[2] };
                p11 = { x: from[0], y: from[1], z: from[2] };
            } else if (dir === 'south') { // +z
                p00 = { x: from[0], y: to[1], z: to[2] };
                p10 = { x: to[0], y: to[1], z: to[2] };
                p01 = { x: from[0], y: from[1], z: to[2] };
                p11 = { x: to[0], y: from[1], z: to[2] };
            } else if (dir === 'west') { // -x
                p00 = { x: from[0], y: to[1], z: from[2] };
                p10 = { x: from[0], y: to[1], z: to[2] };
                p01 = { x: from[0], y: from[1], z: from[2] };
                p11 = { x: from[0], y: from[1], z: to[2] };
            } else if (dir === 'east') { // +x
                p00 = { x: to[0], y: to[1], z: to[2] };
                p10 = { x: to[0], y: to[1], z: from[2] };
                p01 = { x: to[0], y: from[1], z: to[2] };
                p11 = { x: to[0], y: from[1], z: from[2] };
            } else if (dir === 'up') { // +y
                p00 = { x: from[0], y: to[1], z: from[2] };
                p10 = { x: to[0], y: to[1], z: from[2] };
                p01 = { x: from[0], y: to[1], z: to[2] };
                p11 = { x: to[0], y: to[1], z: to[2] };
            } else if (dir === 'down') { // -y
                p00 = { x: from[0], y: from[1], z: to[2] };
                p10 = { x: to[0], y: from[1], z: to[2] };
                p01 = { x: from[0], y: from[1], z: from[2] };
                p11 = { x: to[0], y: from[1], z: from[2] };
            } else {
                continue;
            }

            let pts = [p00, p10, p11, p01] as Vector3[];

            // Element-level rotation
            if (elRot) {
                const origin = { x: elRot.origin[0], y: elRot.origin[1], z: elRot.origin[2] };
                pts = pts.map(p => {
                    let np = { x: p!.x - origin.x, y: p!.y - origin.y, z: p!.z - origin.z };
                    if (elRot.axis === 'x') np = rotateX(np, elRot.angle);
                    if (elRot.axis === 'y') np = rotateY(np, elRot.angle);
                    if (elRot.axis === 'z') np = rotateZ(np, elRot.angle);
                    return { x: np.x + origin.x, y: np.y + origin.y, z: np.z + origin.z };
                });
            }

            // GUI display transform: center at (8,8,8), rotate, scale, translate
            const center = { x: 8, y: 8, z: 8 };
            pts = pts.map(p => {
                // Y then X then Z, matching the GUI transform order the offline
                // renderer (scripts/render-blocks/render.ts) uses. Rotations do
                // not commute, so the vanilla-parity order matters.
                let np = { x: p!.x - center.x, y: p!.y - center.y, z: p!.z - center.z };
                np = rotateY(np, rotYAngle);
                np = rotateX(np, rotXAngle);
                np = rotateZ(np, rotZAngle);
                return { 
                    x: (np.x * scale[0]) + trans[0], 
                    y: (np.y * scale[1]) + trans[1], 
                    z: (np.z * scale[2]) + trans[2] 
                };
            });

            // Minecraft face brightness (up=1.0, n/s=0.4, e/w=0.6, down=0.2),
            // expressed as a black overlay with opacity = 1 - brightness. Same
            // values as the offline renderer, so both produce the same shading.
            let shade = 0;
            if (dir === 'up') shade = 0;
            else if (dir === 'north' || dir === 'south') shade = 0.6;
            else if (dir === 'east' || dir === 'west') shade = 0.4;
            else if (dir === 'down') shade = 0.8;
            
            const centroidZ = (pts[0].z + pts[1].z + pts[2].z + pts[3].z) / 4;

            facesToRender.push({
                pts, uv, b64, shade, centroidZ, dir
            });
        }
    }

    // Sort by Z for painter's algorithm (back to front)
    facesToRender.sort((a, b) => a.centroidZ - b.centroidZ);

    // Compute the bounding box of all projected points to auto-size the viewBox
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const f of facesToRender) {
        for (const pt of f.pts) {
            const sx = pt.x;
            const sy = -pt.y; // SVG y is flipped
            if (sx < minX) minX = sx;
            if (sy < minY) minY = sy;
            if (sx > maxX) maxX = sx;
            if (sy > maxY) maxY = sy;
        }
    }

    // Frame against a FIXED reference (the projected size of a full 16³ block),
    // not against this model's own bounds. Fitting each model to its bounding box
    // would blow a button or a slab up to the same on-screen size as a full
    // block, and would not match the offline renderer's framing for full blocks
    // either. Same rule as scripts/render-blocks/render.ts: a model larger than
    // the reference is clamped down so it can't overflow the frame.
    const w = maxX - minX;
    const h = maxY - minY;
    const extent = Math.max(REFERENCE_BLOCK_SIZE / 0.9, w, h, 1);
    const vbX = (minX + maxX) / 2 - extent / 2;
    const vbY = (minY + maxY) / 2 - extent / 2;
    const vbW = extent;
    const vbH = extent;

    let svg = `<svg viewBox="${vbX} ${vbY} ${vbW} ${vbH}" xmlns="http://www.w3.org/2000/svg">\n@@DEFS@@\n`;
    let defs = '';
    let clipSeq = 0;
    const shades = new Set<number>();

    for (const f of facesToRender) {
        const p = f.pts.map((pt: any) => ({ x: pt.x, y: -pt.y })) as {x: number, y: number}[];
        if (p.length < 4) continue;
        
        const u1 = f.uv[0], v1 = f.uv[1], u2 = f.uv[2], v2 = f.uv[3];
        const w = u2 - u1;
        const h = v2 - v1;

        if (w === 0 || h === 0) continue;

        const vx = (p[1]!.x - p[0]!.x) / w;
        const vy = (p[1]!.y - p[0]!.y) / w;
        const ux = (p[3]!.x - p[0]!.x) / h;
        const uy = (p[3]!.y - p[0]!.y) / h;
        
        const originX = p[0]!.x - vx * u1 - ux * v1;
        const originY = p[0]!.y - vy * u1 - uy * v1;

        const matrix = `matrix(${vx}, ${vy}, ${ux}, ${uy}, ${originX}, ${originY})`;
        const clipId = `clip_${clipSeq++}`;
        const points = p.map((pt) => `${pt.x},${pt.y}`).join(' ');

        // The clip path must be applied in the face's own (untransformed) space,
        // so it lives on the wrapping <g> while the UV matrix stays on the
        // <image>. Putting both on one element would run the polygon through the
        // matrix as well and clip away most of the texture.
        //
        // Face shading multiplies RGB and leaves alpha alone, so cut-out
        // textures don't gain a black quad the way a flat overlay would.
        defs += `<clipPath id="${clipId}"><polygon points="${points}"/></clipPath>\n`;
        const b = 1 - f.shade;
        const filter = f.shade > 0 ? ` filter="url(#shade${Math.round(b * 100)})"` : '';
        svg += `<g clip-path="url(#${clipId})"><image href="${f.b64}" width="16" height="16" transform="${matrix}" image-rendering="optimizeSpeed"${filter}/></g>\n`;
        shades.add(b);
    }

    let defsBlock = defs;
    for (const b of shades) {
        defsBlock += `<filter id="shade${Math.round(b * 100)}" color-interpolation-filters="sRGB">` +
            `<feColorMatrix type="matrix" values="${b} 0 0 0 0  0 ${b} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0"/></filter>\n`;
    }

    return svg.replace('@@DEFS@@', `<defs>\n${defsBlock}</defs>`) + `</svg>`;
}
