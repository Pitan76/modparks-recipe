// Pure Node.js block renderer using node-canvas.
// No browser dependency - works in GitHub Actions.
//
// Reads models + textures from client.jar, renders isometric 3D block PNGs.

import { createCanvas, loadImage, type Canvas, type CanvasRenderingContext2D, type Image } from 'canvas';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const JAR_PATH = path.join(process.cwd(), 'client.jar');
const OUT_DIR = path.join(process.cwd(), 'render_out_png');
const SIZE = 128; // Output image size

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ── Jar reading ──────────────────────────────────────────

function readJarBuffer(entryPath: string): Buffer | null {
    try {
        return execSync(`unzip -p "${JAR_PATH}" "${entryPath}"`, { maxBuffer: 4 * 1024 * 1024 });
    } catch { return null; }
}

function readJarJson(entryPath: string): any {
    const buf = readJarBuffer(entryPath);
    if (!buf) return null;
    try { return JSON.parse(buf.toString('utf-8')); }
    catch { return null; }
}

// ── Model loading ────────────────────────────────────────

const modelCache = new Map<string, any>();

function loadModel(modelId: string): any {
    if (modelCache.has(modelId)) return modelCache.get(modelId);

    let name = modelId.replace('minecraft:', '');
    if (!name.endsWith('.json')) name += '.json';

    const model = readJarJson(`assets/minecraft/models/${name}`);
    if (!model) { modelCache.set(modelId, null); return null; }

    if (model.parent) {
        let parentId = model.parent;
        if (!parentId.startsWith('minecraft:') && !parentId.includes(':'))
            parentId = 'minecraft:' + parentId;

        // Skip builtin parents
        if (parentId.includes('builtin/')) {
            modelCache.set(modelId, model);
            return model;
        }

        const parent = loadModel(parentId);
        if (parent) {
            const merged = {
                ...parent, ...model,
                textures: { ...(parent.textures || {}), ...(model.textures || {}) },
                elements: model.elements || parent.elements,
                display:  { ...(parent.display  || {}), ...(model.display  || {}) },
            };
            modelCache.set(modelId, merged);
            return merged;
        }
    }
    modelCache.set(modelId, model);
    return model;
}

function resolveTexture(texName: string, textures: any): string | null {
    if (!texName) return null;
    let current = texName.startsWith('#') ? texName.substring(1) : texName;
    const visited = new Set<string>();
    while (textures?.[current]) {
        if (visited.has(current)) break;
        visited.add(current);
        const next = textures[current];
        if (typeof next !== 'string') return null;
        if (next.startsWith('#')) { current = next.substring(1); }
        else return next;
    }
    if (current && !current.startsWith('#') && visited.size === 0) return current;
    return null;
}

// ── 3D math ──────────────────────────────────────────────

interface Vec3 { x: number; y: number; z: number }
interface Vec2 { x: number; y: number }

function rotateVec(v: Vec3, axis: string, angleDeg: number): Vec3 {
    const r = angleDeg * Math.PI / 180;
    const c = Math.cos(r), s = Math.sin(r);
    if (axis === 'x') return { x: v.x, y: v.y*c - v.z*s, z: v.y*s + v.z*c };
    if (axis === 'y') return { x: v.x*c + v.z*s, y: v.y, z: -v.x*s + v.z*c };
    if (axis === 'z') return { x: v.x*c - v.y*s, y: v.x*s + v.y*c, z: v.z };
    return v;
}

// ── Rendering ────────────────────────────────────────────

interface FaceData {
    pts2d: Vec2[];
    uv: number[];
    img: Image;
    brightness: number;
    centroidZ: number;
}

async function renderBlock(modelId: string): Promise<Buffer | null> {
    const model = loadModel(modelId);
    if (!model) return null;

    // Skip 2D items
    const p = model.parent || '';
    if (p === 'minecraft:item/generated' || p === 'item/generated' ||
        p === 'minecraft:item/handheld'  || p === 'item/handheld') return null;

    if (!model.elements) return null;

    // GUI display
    const gui = model.display?.gui || { rotation: [30, 225, 0], scale: [0.625, 0.625, 0.625], translation: [0, 0, 0] };
    const rot   = gui.rotation    || [30, 225, 0];
    const scale = gui.scale       || [0.625, 0.625, 0.625];
    const trans = gui.translation || [0, 0, 0];

    // Load textures
    const texImages = new Map<string, Image>();
    async function getTexImage(texPath: string): Promise<Image | null> {
        if (texImages.has(texPath)) return texImages.get(texPath)!;
        const pngPath = texPath.replace('minecraft:', '') + '.png';
        const buf = readJarBuffer(`assets/minecraft/textures/${pngPath}`);
        if (!buf) return null;
        try {
            const img = await loadImage(buf);
            texImages.set(texPath, img);
            return img;
        } catch { return null; }
    }

    const faces: FaceData[] = [];

    for (const el of model.elements) {
        const from = el.from as number[];
        const to   = el.to   as number[];

        for (const [dir, face] of Object.entries(el.faces) as [string, any][]) {
            const texPath = resolveTexture(face.texture, model.textures);
            if (!texPath) continue;
            const img = await getTexImage(texPath);
            if (!img) continue;

            let uv: number[] = face.uv;
            if (!uv) {
                switch (dir) {
                    case 'north': uv = [16-to[0], 16-to[1], 16-from[0], 16-from[1]]; break;
                    case 'south': uv = [from[0],  16-to[1], to[0],      16-from[1]]; break;
                    case 'west':  uv = [from[2],  16-to[1], to[2],      16-from[1]]; break;
                    case 'east':  uv = [16-to[2], 16-to[1], 16-from[2], 16-from[1]]; break;
                    case 'up':    uv = [from[0],  from[2],  to[0],      to[2]];       break;
                    case 'down':  uv = [from[0],  16-to[2], to[0],      16-from[2]]; break;
                    default:      uv = [0, 0, 16, 16];
                }
            }

            // 3D corner vertices
            let pts: Vec3[];
            switch (dir) {
                case 'north':
                    pts = [
                        { x: to[0],   y: to[1],   z: from[2] },
                        { x: from[0], y: to[1],   z: from[2] },
                        { x: from[0], y: from[1], z: from[2] },
                        { x: to[0],   y: from[1], z: from[2] },
                    ]; break;
                case 'south':
                    pts = [
                        { x: from[0], y: to[1],   z: to[2] },
                        { x: to[0],   y: to[1],   z: to[2] },
                        { x: to[0],   y: from[1], z: to[2] },
                        { x: from[0], y: from[1], z: to[2] },
                    ]; break;
                case 'west':
                    pts = [
                        { x: from[0], y: to[1],   z: from[2] },
                        { x: from[0], y: to[1],   z: to[2] },
                        { x: from[0], y: from[1], z: to[2] },
                        { x: from[0], y: from[1], z: from[2] },
                    ]; break;
                case 'east':
                    pts = [
                        { x: to[0], y: to[1],   z: to[2] },
                        { x: to[0], y: to[1],   z: from[2] },
                        { x: to[0], y: from[1], z: from[2] },
                        { x: to[0], y: from[1], z: to[2] },
                    ]; break;
                case 'up':
                    pts = [
                        { x: from[0], y: to[1], z: from[2] },
                        { x: to[0],   y: to[1], z: from[2] },
                        { x: to[0],   y: to[1], z: to[2] },
                        { x: from[0], y: to[1], z: to[2] },
                    ]; break;
                case 'down':
                    pts = [
                        { x: from[0], y: from[1], z: to[2] },
                        { x: to[0],   y: from[1], z: to[2] },
                        { x: to[0],   y: from[1], z: from[2] },
                        { x: from[0], y: from[1], z: from[2] },
                    ]; break;
                default: continue;
            }

            // Element rotation
            if (el.rotation) {
                const o = { x: el.rotation.origin[0], y: el.rotation.origin[1], z: el.rotation.origin[2] };
                pts = pts.map(p => {
                    let np = { x: p.x - o.x, y: p.y - o.y, z: p.z - o.z };
                    np = rotateVec(np, el.rotation.axis, el.rotation.angle);
                    return { x: np.x + o.x, y: np.y + o.y, z: np.z + o.z };
                });
            }

            // GUI transform: center, rotate, scale, translate
            const center = { x: 8, y: 8, z: 8 };
            pts = pts.map(p => {
                let np = { x: p.x - center.x, y: p.y - center.y, z: p.z - center.z };
                np = rotateVec(np, 'y', rot[1]);
                np = rotateVec(np, 'x', rot[0]);
                np = rotateVec(np, 'z', rot[2]);
                return {
                    x: np.x * scale[0] + trans[0],
                    y: np.y * scale[1] + trans[1],
                    z: np.z * scale[2] + trans[2],
                };
            });

            // Minecraft face brightness
            let brightness = 1.0;
            switch (dir) {
                case 'up':    brightness = 1.0;  break;
                case 'north': case 'south': brightness = 0.4; break;
                case 'east':  case 'west':  brightness = 0.7; break;
                case 'down':  brightness = 0.3; break;
            }

            const centroidZ = pts.reduce((s, p) => s + p.z, 0) / 4;

            // Project: y-flip for screen coords
            const pts2d = pts.map(p => ({ x: p.x, y: -p.y }));

            faces.push({ pts2d, uv, img, brightness, centroidZ });
        }
    }

    if (faces.length === 0) return null;

    // Sort back-to-front (painter's algorithm)
    faces.sort((a, b) => a.centroidZ - b.centroidZ);

    // Compute bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const f of faces) {
        for (const p of f.pts2d) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }
    }

    const bw = maxX - minX;
    const bh = maxY - minY;
    const fitScale = SIZE / Math.max(bw, bh) * 0.9; // 90% fill
    const cx = SIZE / 2 - (minX + maxX) / 2 * fitScale;
    const cy = SIZE / 2 - (minY + maxY) / 2 * fitScale;

    // Create canvas
    const canvas = createCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    for (const face of faces) {
        const p = face.pts2d.map(v => ({ x: v.x * fitScale + cx, y: v.y * fitScale + cy }));
        const [u1, v1, u2, v2] = face.uv;
        const sw = u2 - u1;
        const sh = v2 - v1;
        if (sw <= 0 || sh <= 0) continue;

        ctx.save();

        // Clip to face polygon
        ctx.beginPath();
        ctx.moveTo(p[0].x, p[0].y);
        ctx.lineTo(p[1].x, p[1].y);
        ctx.lineTo(p[2].x, p[2].y);
        ctx.lineTo(p[3].x, p[3].y);
        ctx.closePath();
        ctx.clip();

        // Affine transform: map UV space → screen
        // p[0] ↔ (u1,v1),  p[1] ↔ (u2,v1),  p[3] ↔ (u1,v2)
        const ax = (p[1].x - p[0].x) / sw;
        const ay = (p[1].y - p[0].y) / sw;
        const bx = (p[3].x - p[0].x) / sh;
        const by = (p[3].y - p[0].y) / sh;
        const ex = p[0].x - ax * u1 - bx * v1;
        const ey = p[0].y - ay * u1 - by * v1;

        ctx.setTransform(ax, ay, bx, by, ex, ey);
        ctx.drawImage(face.img, 0, 0);
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        // Apply Minecraft face shading
        if (face.brightness < 1.0) {
            ctx.fillStyle = `rgba(0,0,0,${1.0 - face.brightness})`;
            ctx.fill(); // fills the clipped polygon
        }

        ctx.restore();
    }

    return canvas.toBuffer('image/png');
}

// ── Main ─────────────────────────────────────────────────

async function main() {
    // Get all item definitions
    const listOutput = execSync(
        `unzip -l "${JAR_PATH}" "assets/minecraft/items/*.json" | grep "assets/minecraft/items/" | awk '{print $4}'`,
        { encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024 }
    ).trim();
    const itemPaths = listOutput.split('\n').filter(Boolean);
    console.log(`Found ${itemPaths.length} item definitions`);

    let count = 0;
    for (let i = 0; i < itemPaths.length; i++) {
        const itemPath = itemPaths[i];
        const itemName = path.basename(itemPath, '.json');

        try {
            const itemData = readJarJson(itemPath);
            if (!itemData) continue;

            let modelId = itemData.model?.model;
            if (!modelId) modelId = `minecraft:item/${itemName}`;
            if (typeof modelId !== 'string') continue;

            const png = await renderBlock(modelId);
            if (!png) continue;

            fs.writeFileSync(path.join(OUT_DIR, `${itemName}.png`), png);
            count++;
            if (count % 50 === 0) console.log(`  Rendered ${count} blocks... (${itemName})`);
        } catch (e: any) {
            // Skip items that can't be rendered
        }
    }

    console.log(`\nDone! Rendered ${count} block PNGs to ${OUT_DIR}`);
}

main().catch(console.error);
