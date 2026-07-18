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

    if (model.parent === 'minecraft:item/generated' || model.parent === 'item/generated' || model.parent === 'minecraft:item/handheld' || model.parent === 'item/handheld') {
        const texPath = resolveTexture('#layer0', model.textures);
        if (texPath) {
            const b64 = await getTextureBase64(texPath);
            if (b64) {
                return `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><image href="${b64}" width="16" height="16" image-rendering="pixelated"/></svg>`;
            }
        }
        return null;
    }

    if (!model.elements) return null;

    let guiDisplay = model.display?.gui || { rotation: [30, 225, 0], translation: [0, 0, 0], scale: [0.625, 0.625, 0.625] };
    let rotX = guiDisplay.rotation?.[0] || 0;
    let rotY = guiDisplay.rotation?.[1] || 0;
    let rotZ = guiDisplay.rotation?.[2] || 0;
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

            let p00, p10, p01, p11;
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
            }

            let pts = [p00, p10, p11, p01];

            if (elRot) {
                const origin = { x: elRot.origin[0], y: elRot.origin[1], z: elRot.origin[2] };
                pts = pts.map(p => {
                    let np = { x: p.x - origin.x, y: p.y - origin.y, z: p.z - origin.z };
                    if (elRot.axis === 'x') np = rotateX(np, elRot.angle);
                    if (elRot.axis === 'y') np = rotateY(np, elRot.angle);
                    if (elRot.axis === 'z') np = rotateZ(np, elRot.angle);
                    return { x: np.x + origin.x, y: np.y + origin.y, z: np.z + origin.z };
                });
            }

            const center = { x: 8, y: 8, z: 8 };
            pts = pts.map(p => {
                let np = { x: p.x - center.x, y: p.y - center.y, z: p.z - center.z };
                np = rotateX(np, rotX);
                np = rotateY(np, rotY);
                np = rotateZ(np, rotZ);
                return { 
                    x: (np.x * scale[0]) + trans[0], 
                    y: (np.y * scale[1]) + trans[1], 
                    z: (np.z * scale[2]) + trans[2] 
                };
            });

            let shade = 0;
            if (dir === 'down') shade = 0.5;
            else if (dir === 'east' || dir === 'west') shade = 0.2;
            else if (dir === 'north' || dir === 'south') shade = 0.4;
            
            const centroidZ = (pts[0].z + pts[1].z + pts[2].z + pts[3].z) / 4;

            facesToRender.push({
                pts, uv, b64, shade, centroidZ, dir
            });
        }
    }

    facesToRender.sort((a, b) => a.centroidZ - b.centroidZ);

    let svg = `<svg viewBox="-24 -24 48 48" xmlns="http://www.w3.org/2000/svg">\n`;
    
    for (const f of facesToRender) {
        const p = f.pts.map((pt: any) => ({ x: pt.x, y: -pt.y }));
        
        const u1 = f.uv[0], v1 = f.uv[1], u2 = f.uv[2], v2 = f.uv[3];
        const w = u2 - u1;
        const h = v2 - v1;

        const vx = (p[1].x - p[0].x) / w;
        const vy = (p[1].y - p[0].y) / w;
        const ux = (p[3].x - p[0].x) / h;
        const uy = (p[3].y - p[0].y) / h;
        
        const originX = p[0].x - vx * u1 - ux * v1;
        const originY = p[0].y - vy * u1 - uy * v1;

        const matrix = `matrix(${vx}, ${vy}, ${ux}, ${uy}, ${originX}, ${originY})`;
        const clipId = `clip_${Math.random().toString(36).substring(7)}`;

        svg += `<g>
            <clipPath id="${clipId}">
                <polygon points="${p[0].x},${p[0].y} ${p[1].x},${p[1].y} ${p[2].x},${p[2].y} ${p[3].x},${p[3].y}"/>
            </clipPath>
            <image href="${f.b64}" width="16" height="16" transform="${matrix}" image-rendering="pixelated" clip-path="url(#${clipId})"/>
            <polygon points="${p[0].x},${p[0].y} ${p[1].x},${p[1].y} ${p[2].x},${p[2].y} ${p[3].x},${p[3].y}" fill="black" opacity="${f.shade}" />
        </g>\n`;
    }

    svg += `</svg>`;
    return svg;
}
