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
    FRAME_MARGIN,
    FLAT_ITEM_PARENTS,
    type Vec2,
} from '../core/block-geometry';

interface SvgFace {
    pts2d: Vec2[];
    uv: number[];
    b64: string;
    /** Natural pixel size of the texture; UVs are expressed in this space. */
    texW: number;
    texH: number;
    brightness: number;
    centroidZ: number;
}

/**
 * Width/height from a PNG data URL's IHDR chunk. Face UVs are in texture pixels
 * (0..16 for a block texture, but 0..64 for an entity atlas such as a chest's),
 * so the <image> has to be placed at the texture's real size — hardcoding 16
 * squashes anything larger onto a 16x16 square.
 */
function pngSize(dataUrl: string): { w: number; h: number } {
    const comma = dataUrl.indexOf(',');
    // 33 bytes covers the 8-byte signature, the chunk header and IHDR's w/h.
    const header = atob(dataUrl.slice(comma + 1, comma + 1 + 64)).slice(0, 33);
    const be32 = (o: number) =>
        (header.charCodeAt(o) << 24 | header.charCodeAt(o + 1) << 16 |
         header.charCodeAt(o + 2) << 8 | header.charCodeAt(o + 3)) >>> 0;
    const w = be32(16), h = be32(20);
    return w > 0 && h > 0 ? { w, h } : { w: 16, h: 16 };
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
    // Animated textures are a vertical strip of frames; show only the first.
    const { w } = pngSize(b64);
    return `<svg viewBox="0 0 ${w} ${w}" xmlns="http://www.w3.org/2000/svg">`
        + `<image href="${b64}" width="${w}" height="${w}" preserveAspectRatio="xMinYMin slice"`
        + ` image-rendering="optimizeSpeed"/></svg>`;
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

            const { w: texW, h: texH } = pngSize(b64);
            const pts = applyGuiTransform(applyElementRotation(corners, el.rotation), gui);
            faces.push({
                pts2d: project(pts),
                uv: face.uv || defaultUv(dir, el.from, el.to),
                b64,
                texW,
                texH,
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
        // Shading goes on the <g>, not the <image>: a filter on the image is
        // resolved against its own pre-transform box, which the UV matrix then
        // shrinks, and resvg drops faces whose filter region collapses.
        body += `<g clip-path="url(#${clipId})"${filter}><image href="${f.b64}" width="${f.texW}" height="${f.texH}"`
            + ` transform="matrix(${m.join(', ')})" image-rendering="optimizeSpeed"/></g>\n`;
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
