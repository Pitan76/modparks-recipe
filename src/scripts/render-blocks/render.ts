// Isometric 3D block rendering with node-canvas.

import { createCanvas, loadImage, type Image, type CanvasRenderingContext2D } from 'canvas';
import { readJarBuffer } from './jar';
import { loadModel, resolveTexture } from './model';
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
} from '../../core/block-geometry';

export const SIZE = 128; // Output image size

interface FaceData {
    pts2d: Vec2[];
    uv: number[];
    img: Image;
    brightness: number;
    centroidZ: number;
}

export async function renderBlock(modelId: string): Promise<Buffer | null> {
    const model = loadModel(modelId);
    if (!model) return null;
    return renderModel(model);
}

export async function renderModel(model: any): Promise<Buffer | null> {
    if (FLAT_ITEM_PARENTS.has(model.parent || '')) return null;
    if (!model.elements) return null;

    const faces = await collectFaces(model);
    if (faces.length === 0) return null;
    faces.sort((a, b) => a.centroidZ - b.centroidZ);

    return drawFaces(faces);
}

async function collectFaces(model: any): Promise<FaceData[]> {
    const gui = guiTransform(model);
    const getTexImage = textureLoader();
    const faces: FaceData[] = [];

    for (const el of model.elements) {
        for (const [dir, face] of Object.entries(el.faces) as [string, any][]) {
            const corners = faceVertices(dir, el.from, el.to);
            if (!corners) continue;

            const texPath = resolveTexture(face.texture, model.textures);
            if (!texPath) continue;
            const img = await getTexImage(texPath);
            if (!img) continue;

            const pts = applyGuiTransform(applyElementRotation(corners, el.rotation), gui);
            faces.push({
                pts2d: project(pts),
                uv: face.uv || defaultUv(dir, el.from, el.to),
                img,
                brightness: faceBrightness(dir),
                centroidZ: centroidZ(pts),
            });
        }
    }
    return faces;
}

function textureLoader(): (texPath: string) => Promise<Image | null> {
    const cache = new Map<string, Image>();
    return async (texPath: string) => {
        const cached = cache.get(texPath);
        if (cached) return cached;

        const buf = readJarBuffer(`assets/minecraft/textures/${texPath.replace('minecraft:', '')}.png`);
        if (!buf) return null;
        try {
            const img = await loadImage(buf);
            cache.set(texPath, img);
            return img;
        } catch {
            return null;
        }
    };
}

/**
 * Scale relative to a full block, so smaller blocks stay smaller (a button
 * shouldn't fill the slot like a full cube), centred on the model's own
 * bounding box. Clamped so an unusually large model can't overflow.
 */
function framing(faces: FaceData[]): { scale: number; offsetX: number; offsetY: number } {
    const { minX, minY, maxX, maxY } = boundsOf(faces.map(f => f.pts2d));
    const scale = Math.min(SIZE / (REF_SIZE * FRAME_MARGIN), SIZE / Math.max(maxX - minX, maxY - minY, 1));
    return {
        scale,
        offsetX: SIZE / 2 - (minX + maxX) / 2 * scale,
        offsetY: SIZE / 2 - (minY + maxY) / 2 * scale,
    };
}

function drawFaces(faces: FaceData[]): Buffer {
    const { scale, offsetX, offsetY } = framing(faces);

    const canvas = createCanvas(SIZE, SIZE);
    const ctx = pixelContext(canvas.getContext('2d'));

    // Faces are composited one at a time on a scratch canvas so shading can be
    // masked to the face's own opaque pixels (source-atop) instead of painting
    // a black quad over cut-out textures.
    const scratch = createCanvas(SIZE, SIZE);
    const sctx = pixelContext(scratch.getContext('2d'));

    for (const face of faces) {
        const p = face.pts2d.map(v => ({ x: v.x * scale + offsetX, y: v.y * scale + offsetY }));
        const m = uvMatrix(p, face.uv);
        if (!m) continue;

        sctx.clearRect(0, 0, SIZE, SIZE);
        sctx.save();
        clipPolygon(sctx, p);

        sctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
        sctx.drawImage(face.img, 0, 0);
        sctx.setTransform(1, 0, 0, 1, 0, 0);

        if (face.brightness < 1.0) {
            sctx.globalCompositeOperation = 'source-atop';
            sctx.fillStyle = `rgba(0,0,0,${1.0 - face.brightness})`;
            sctx.fillRect(0, 0, SIZE, SIZE);
        }

        sctx.restore();
        ctx.drawImage(scratch, 0, 0);
    }

    return canvas.toBuffer('image/png');
}

function pixelContext(ctx: CanvasRenderingContext2D): CanvasRenderingContext2D {
    ctx.imageSmoothingEnabled = false;
    ctx.antialias = 'none';
    return ctx;
}

function clipPolygon(ctx: CanvasRenderingContext2D, p: Vec2[]): void {
    ctx.beginPath();
    ctx.moveTo(p[0].x, p[0].y);
    for (const pt of p.slice(1)) ctx.lineTo(pt.x, pt.y);
    ctx.closePath();
    ctx.clip();
}
