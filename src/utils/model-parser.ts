import {
    applyElementRotation,
    applyGuiTransform,
    boundsOf,
    centroidZ,
    defaultUv,
    faceBrightness,
    faceVertices,
    guiTransform,
    project,
    uvMatrix,
    REF_SIZE,
    type Vec2,
} from '../core/block-geometry';

const FLAT_ITEM_PARENTS = new Set([
    'minecraft:item/generated', 'item/generated',
    'minecraft:item/handheld', 'item/handheld',
]);

interface SvgFace {
    pts2d: Vec2[];
    uv: number[];
    b64: string;
    brightness: number;
    centroidZ: number;
}

/** Load a model and merge it with its parent chain, recursively. */
export async function loadModel(
    modelId: string,
    getModelJson: (id: string) => Promise<any>
): Promise<any> {
    const model = await getModelJson(modelId);
    if (!model) return null;
    if (!model.parent) return model;

    let parentId = model.parent;
    if (!parentId.includes(':')) parentId = 'minecraft:' + parentId;

    const parent = await loadModel(parentId, getModelJson);
    if (!parent) return model;

    return {
        ...parent, ...model,
        textures: { ...(parent.textures || {}), ...(model.textures || {}) },
        elements: model.elements || parent.elements,
        display: { ...(parent.display || {}), ...(model.display || {}) },
    };
}

/** Follow `#ref` texture indirections down to a real texture path. */
export function resolveTexture(texName: string, textures: any): string | null {
    if (!texName) return null;
    let current = texName.startsWith('#') ? texName.substring(1) : texName;
    const visited = new Set<string>();
    while (textures && textures[current]) {
        if (visited.has(current)) break;
        visited.add(current);
        const next = textures[current];
        if (typeof next !== 'string') return null;
        if (!next.startsWith('#')) return next;
        current = next.substring(1);
    }
    if (current && !current.startsWith('#') && visited.size === 0) return current;
    return null;
}

/** Render a model to an isometric SVG icon, or null if it has no geometry. */
export async function renderModelToSvg(
    modelId: string,
    getModelJson: (id: string) => Promise<any>,
    getTextureBase64: (path: string) => Promise<string | null>
): Promise<string | null> {
    const model = await loadModel(modelId, getModelJson);
    if (!model) return null;

    if (FLAT_ITEM_PARENTS.has(model.parent)) return flatItemSvg(model, getTextureBase64);
    if (!model.elements) return null;

    const faces = await collectFaces(model, getTextureBase64);
    if (faces.length === 0) return null;
    faces.sort((a, b) => a.centroidZ - b.centroidZ);

    return buildSvg(faces);
}

async function flatItemSvg(
    model: any,
    getTextureBase64: (path: string) => Promise<string | null>
): Promise<string | null> {
    const texPath = resolveTexture('#layer0', model.textures);
    if (!texPath) return null;
    const b64 = await getTextureBase64(texPath);
    if (!b64) return null;
    return `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">`
        + `<image href="${b64}" width="16" height="16" image-rendering="optimizeSpeed"/></svg>`;
}

async function collectFaces(
    model: any,
    getTextureBase64: (path: string) => Promise<string | null>
): Promise<SvgFace[]> {
    const gui = guiTransform(model);
    const faces: SvgFace[] = [];

    for (const el of model.elements) {
        for (const [dir, face] of Object.entries(el.faces) as [string, any][]) {
            const corners = faceVertices(dir, el.from, el.to);
            if (!corners) continue;

            const texPath = resolveTexture(face.texture, model.textures);
            if (!texPath) continue;
            const b64 = await getTextureBase64(texPath);
            if (!b64) continue;

            const pts = applyGuiTransform(applyElementRotation(corners, el.rotation), gui);
            faces.push({
                pts2d: project(pts),
                uv: face.uv || defaultUv(dir, el.from, el.to),
                b64,
                brightness: faceBrightness(dir),
                centroidZ: centroidZ(pts),
            });
        }
    }
    return faces;
}

/**
 * Frame against a FIXED reference (the projected size of a full 16³ block), not
 * against the model's own bounds: fitting each model to its bounding box would
 * blow a button or a slab up to the size of a full block, and would not match
 * the offline renderer either. A model larger than the reference is clamped
 * down so it can't overflow the frame.
 */
function viewBox(faces: SvgFace[]): string {
    const { minX, minY, maxX, maxY } = boundsOf(faces.map(f => f.pts2d));
    const extent = Math.max(REF_SIZE * FRAME_MARGIN, maxX - minX, maxY - minY, 1);
    return `${(minX + maxX) / 2 - extent / 2} ${(minY + maxY) / 2 - extent / 2} ${extent} ${extent}`;
}

function buildSvg(faces: SvgFace[]): string {
    let defs = '';
    let body = '';
    let clipSeq = 0;
    const brightnesses = new Set<number>();

    for (const f of faces) {
        const m = uvMatrix(f.pts2d, f.uv);
        if (!m) continue;

        const clipId = `clip_${clipSeq++}`;
        const points = f.pts2d.map(pt => `${pt.x},${pt.y}`).join(' ');

        // The clip path must be applied in the face's own (untransformed) space,
        // so it lives on the wrapping <g> while the UV matrix stays on the
        // <image>. Putting both on one element would run the polygon through the
        // matrix as well and clip away most of the texture.
        defs += `<clipPath id="${clipId}"><polygon points="${points}"/></clipPath>\n`;
        const filter = f.brightness < 1 ? ` filter="url(#${shadeId(f.brightness)})"` : '';
        body += `<g clip-path="url(#${clipId})"><image href="${f.b64}" width="16" height="16"`
            + ` transform="matrix(${m.join(', ')})" image-rendering="optimizeSpeed"${filter}/></g>\n`;
        if (f.brightness < 1) brightnesses.add(f.brightness);
    }

    for (const b of brightnesses) defs += shadeFilter(b);

    return `<svg viewBox="${viewBox(faces)}" xmlns="http://www.w3.org/2000/svg">\n`
        + `<defs>\n${defs}</defs>\n${body}</svg>`;
}

function shadeId(brightness: number): string {
    return `shade${Math.round(brightness * 100)}`;
}

/** Shading multiplies RGB and leaves alpha alone, so cut-out textures don't
 *  gain a black quad the way a flat overlay would. */
function shadeFilter(b: number): string {
    return `<filter id="${shadeId(b)}" color-interpolation-filters="sRGB">`
        + `<feColorMatrix type="matrix" values="${b} 0 0 0 0  0 ${b} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0"/></filter>\n`;
}
