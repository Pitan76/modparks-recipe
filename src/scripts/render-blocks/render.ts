/**
 * @fileoverview node-canvas を使用した 3D 等角投影（isometric）のブロックモデルレンダラー。
 */

import { createCanvas, loadImage, type Image, type CanvasRenderingContext2D } from 'canvas';
import { readJarBuffer } from './jar';
import { loadModel, resolveTexture } from './model';
import {
    applyElementRotation,
    applyGuiTransform,
    defaultUv,
    faceBrightness,
    faceVertices,
    guiTransform,
    REF_SIZE,
    FRAME_MARGIN,
    FLAT_ITEM_PARENTS,
} from '../../core/block-geometry';
import {
    boundsOf,
    centroidZ,
    project,
    uvMatrix,
    type Vec2,
} from '../../core/math';

/** 出力画像のサイズ。 */
export const SIZE = 128;

interface FaceData {
    pts2d: Vec2[];
    uv: number[];
    img: Image;
    brightness: number;
    centroidZ: number;
}

/**
 * 指定されたモデルIDのブロックをレンダリングし、PNG画像のバイナリデータ（Buffer）を返します。
 * @param modelId モデルのID
 * @returns PNG画像のBuffer、または null
 */
export async function renderBlock(modelId: string): Promise<Buffer | null> {
    const model = loadModel(modelId);
    if (!model) return null;
    return renderModel(model);
}

/**
 * 与えられたモデルオブジェクトをレンダリングし、PNG画像のバイナリデータ（Buffer）を返します。
 * @param model 解析済みのモデルデータ
 * @returns PNG画像のBuffer、または null
 */
export async function renderModel(model: any): Promise<Buffer | null> {
    if (FLAT_ITEM_PARENTS.has(model.parent || '')) return null;
    if (!model.elements) return null;

    const faces = await collectFaces(model);
    if (faces.length === 0) return null;
    faces.sort((a, b) => a.centroidZ - b.centroidZ);

    return drawFaces(faces);
}

/**
 * モデルデータ内のエレメントから、描画対象となるすべての面を収集します。
 * @param model モデルデータ
 * @returns 面データの配列
 */
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

/**
 * テクスチャ画像をJARからキャッシュ経由で読み込むローダー関数を作成します。
 */
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
 * フルサイズブロックに対する比率でスケーリングを行い、小さなブロック（ボタン等）が引き伸ばされて
 * スロット全体に表示されるのを防ぎつつ、モデル自身のバウンディングボックスの中央に配置します。
 * モデルが異常に大きい場合は、はみ出さないようにクリップされます。
 * @param faces 面データの配列
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

/**
 * 収集した面を描画し、PNGバイナリデータを返します。
 * @param faces 面データの配列
 * @returns PNG画像のBuffer
 */
function drawFaces(faces: FaceData[]): Buffer {
    const { scale, offsetX, offsetY } = framing(faces);

    const canvas = createCanvas(SIZE, SIZE);
    const ctx = pixelContext(canvas.getContext('2d'));

    // 各面は作業用（スクラッチ）Canvas上に1つずつ合成されます。これにより、
    // 切り抜き透過テクスチャの周囲に黒い四角形を塗る代わりに、シェーディングを面の不透明ピクセルだけに
    // マスク（source-atop）して描画できます。
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

/**
 * キャンバスのレンダリングコンテキストに対し、ピクセルアート用の設定（補間無効、アンチエイリアスなし）を適用します。
 */
function pixelContext(ctx: CanvasRenderingContext2D): CanvasRenderingContext2D {
    ctx.imageSmoothingEnabled = false;
    ctx.antialias = 'none';
    return ctx;
}

/**
 * 多角形（面）のパスに沿ってコンテキストをクリッピングします。
 */
function clipPolygon(ctx: CanvasRenderingContext2D, p: Vec2[]): void {
    ctx.beginPath();
    ctx.moveTo(p[0].x, p[0].y);
    for (const pt of p.slice(1)) ctx.lineTo(pt.x, pt.y);
    ctx.closePath();
    ctx.clip();
}
