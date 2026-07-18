// Renders Minecraft block models to PNG using HTML5 Canvas in Puppeteer.
// This replaces the SVG approach which had rendering issues with matrix transforms.

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const JAR_PATH = path.join(__dirname, '../../client.jar');
const OUT_DIR = path.join(__dirname, '../../render_out_png');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Extract JSON from jar
function readJarJson(jarPath) {
    try {
        const out = execSync(`unzip -p "${JAR_PATH}" "${jarPath}"`, { encoding: 'utf-8', maxBuffer: 1024 * 1024 });
        return JSON.parse(out);
    } catch { return null; }
}

// Extract PNG as base64 from jar
function readJarPngBase64(jarPath) {
    try {
        const buf = execSync(`unzip -p "${JAR_PATH}" "${jarPath}"`, { maxBuffer: 1024 * 1024 });
        return `data:image/png;base64,${buf.toString('base64')}`;
    } catch { return null; }
}

// Load model with parent chain resolution
function loadModel(modelId) {
    let name = modelId.replace('minecraft:', '');
    if (!name.endsWith('.json')) name += '.json';
    const model = readJarJson(`assets/minecraft/models/${name}`);
    if (!model) return null;

    if (model.parent) {
        let parentId = model.parent;
        if (!parentId.startsWith('minecraft:') && !parentId.includes(':')) parentId = 'minecraft:' + parentId;
        const parent = loadModel(parentId);
        if (parent) {
            return {
                ...parent, ...model,
                textures: { ...(parent.textures || {}), ...(model.textures || {}) },
                elements: model.elements || parent.elements,
                display: { ...(parent.display || {}), ...(model.display || {}) }
            };
        }
    }
    return model;
}

function resolveTexture(texName, textures) {
    if (!texName) return null;
    let current = texName.startsWith('#') ? texName.substring(1) : texName;
    let visited = new Set();
    while (textures && textures[current]) {
        if (visited.has(current)) break;
        visited.add(current);
        let next = textures[current];
        if (typeof next !== 'string') return null;
        if (next.startsWith('#')) { current = next.substring(1); }
        else return next;
    }
    if (current && !current.startsWith('#') && visited.size === 0) return current;
    return null;
}

function rotateVec(v, axis, angle) {
    const rad = angle * Math.PI / 180;
    const c = Math.cos(rad), s = Math.sin(rad);
    if (axis === 'x') return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
    if (axis === 'y') return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
    if (axis === 'z') return { x: v.x * c - v.y * s, y: v.x * s + v.y * c, z: v.z };
    return v;
}

async function run() {
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    
    // Get list of all items
    const itemsList = execSync(`unzip -l "${JAR_PATH}" "assets/minecraft/items/*.json" | grep "assets/minecraft/items/" | awk '{print $4}'`, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);
    
    console.log(`Found ${itemsList.length} item definitions`);
    
    let renderCount = 0;
    const page = await browser.newPage();
    await page.setViewport({ width: 128, height: 128, deviceScaleFactor: 1 });

    for (let idx = 0; idx < itemsList.length; idx++) {
        const itemPath = itemsList[idx];
        const itemName = path.basename(itemPath, '.json');
        const pngPath = path.join(OUT_DIR, `${itemName}.png`);

        try {
            const itemData = readJarJson(itemPath);
            if (!itemData) continue;
            
            let modelId = itemData.model?.model;
            if (!modelId) modelId = `minecraft:item/${itemName}`;
            if (typeof modelId !== 'string') continue;

            const model = loadModel(modelId);
            if (!model) continue;

            // Skip 2D items (item/generated, item/handheld)
            if (model.parent === 'minecraft:item/generated' || model.parent === 'item/generated' || 
                model.parent === 'minecraft:item/handheld' || model.parent === 'item/handheld') {
                continue;
            }

            if (!model.elements) continue;

            // GUI display params
            const gui = model.display?.gui || { rotation: [30, 225, 0], translation: [0, 0, 0], scale: [0.625, 0.625, 0.625] };
            const rotAngles = gui.rotation || [30, 225, 0];
            const scale = gui.scale || [0.625, 0.625, 0.625];
            const trans = gui.translation || [0, 0, 0];

            // Collect all faces with their textures
            const faces = [];
            const textureCache = {};

            for (const el of model.elements) {
                const from = el.from;
                const to = el.to;

                for (const [dir, face] of Object.entries(el.faces)) {
                    const texPath = resolveTexture(face.texture, model.textures);
                    if (!texPath) continue;

                    // Load texture if not cached
                    if (!textureCache[texPath]) {
                        const texId = texPath.replace('minecraft:', '') + '.png';
                        const b64 = readJarPngBase64(`assets/minecraft/textures/${texId}`);
                        if (!b64) continue;
                        textureCache[texPath] = b64;
                    }

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

                    let p00, p10, p01, p11;
                    if (dir === 'north') {
                        p00 = { x: to[0], y: to[1], z: from[2] };
                        p10 = { x: from[0], y: to[1], z: from[2] };
                        p01 = { x: to[0], y: from[1], z: from[2] };
                        p11 = { x: from[0], y: from[1], z: from[2] };
                    } else if (dir === 'south') {
                        p00 = { x: from[0], y: to[1], z: to[2] };
                        p10 = { x: to[0], y: to[1], z: to[2] };
                        p01 = { x: from[0], y: from[1], z: to[2] };
                        p11 = { x: to[0], y: from[1], z: to[2] };
                    } else if (dir === 'west') {
                        p00 = { x: from[0], y: to[1], z: from[2] };
                        p10 = { x: from[0], y: to[1], z: to[2] };
                        p01 = { x: from[0], y: from[1], z: from[2] };
                        p11 = { x: from[0], y: from[1], z: to[2] };
                    } else if (dir === 'east') {
                        p00 = { x: to[0], y: to[1], z: to[2] };
                        p10 = { x: to[0], y: to[1], z: from[2] };
                        p01 = { x: to[0], y: from[1], z: to[2] };
                        p11 = { x: to[0], y: from[1], z: from[2] };
                    } else if (dir === 'up') {
                        p00 = { x: from[0], y: to[1], z: from[2] };
                        p10 = { x: to[0], y: to[1], z: from[2] };
                        p01 = { x: from[0], y: to[1], z: to[2] };
                        p11 = { x: to[0], y: to[1], z: to[2] };
                    } else if (dir === 'down') {
                        p00 = { x: from[0], y: from[1], z: to[2] };
                        p10 = { x: to[0], y: from[1], z: to[2] };
                        p01 = { x: from[0], y: from[1], z: from[2] };
                        p11 = { x: to[0], y: from[1], z: from[2] };
                    } else continue;

                    let pts = [p00, p10, p11, p01];

                    // Element rotation
                    if (el.rotation) {
                        const origin = { x: el.rotation.origin[0], y: el.rotation.origin[1], z: el.rotation.origin[2] };
                        pts = pts.map(p => {
                            let np = { x: p.x - origin.x, y: p.y - origin.y, z: p.z - origin.z };
                            np = rotateVec(np, el.rotation.axis, el.rotation.angle);
                            return { x: np.x + origin.x, y: np.y + origin.y, z: np.z + origin.z };
                        });
                    }

                    // GUI transform
                    const center = { x: 8, y: 8, z: 8 };
                    pts = pts.map(p => {
                        let np = { x: p.x - center.x, y: p.y - center.y, z: p.z - center.z };
                        np = rotateVec(np, 'x', rotAngles[0]);
                        np = rotateVec(np, 'y', rotAngles[1]);
                        np = rotateVec(np, 'z', rotAngles[2]);
                        return {
                            x: (np.x * scale[0]) + trans[0],
                            y: (np.y * scale[1]) + trans[1],
                            z: (np.z * scale[2]) + trans[2]
                        };
                    });

                    // Minecraft brightness: up=1.0, N/S=0.8, E/W=0.6, down=0.5
                    let brightness = 1.0;
                    if (dir === 'up') brightness = 1.0;
                    else if (dir === 'north' || dir === 'south') brightness = 0.8;
                    else if (dir === 'east' || dir === 'west') brightness = 0.6;
                    else if (dir === 'down') brightness = 0.5;

                    const centroidZ = (pts[0].z + pts[1].z + pts[2].z + pts[3].z) / 4;
                    faces.push({ pts, uv, texPath, brightness, centroidZ, dir });
                }
            }

            if (faces.length === 0) continue;

            // Sort back-to-front
            faces.sort((a, b) => a.centroidZ - b.centroidZ);

            // Project to 2D (x stays, -y for SVG)
            const projected = faces.map(f => ({
                ...f,
                pts2d: f.pts.map(p => ({ x: p.x, y: -p.y }))
            }));

            // Compute bounding box
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const f of projected) {
                for (const p of f.pts2d) {
                    if (p.x < minX) minX = p.x;
                    if (p.y < minY) minY = p.y;
                    if (p.x > maxX) maxX = p.x;
                    if (p.y > maxY) maxY = p.y;
                }
            }

            const bw = maxX - minX;
            const bh = maxY - minY;
            const margin = Math.max(bw, bh) * 0.05;
            const totalW = bw + margin * 2;
            const totalH = bh + margin * 2;
            const scaleFactor = 128 / Math.max(totalW, totalH);
            const offsetX = -minX + margin + (128 / scaleFactor - totalW) / 2;
            const offsetY = -minY + margin + (128 / scaleFactor - totalH) / 2;

            // Build data for the canvas renderer
            const renderData = {
                faces: projected.map(f => ({
                    pts: f.pts2d.map(p => ({
                        x: (p.x + offsetX) * scaleFactor,
                        y: (p.y + offsetY) * scaleFactor
                    })),
                    uv: f.uv,
                    tex: textureCache[f.texPath],
                    brightness: f.brightness
                }))
            };

            // Create HTML with canvas renderer
            const html = `<!DOCTYPE html>
<html><body style="margin:0;background:transparent;">
<canvas id="c" width="128" height="128"></canvas>
<script>
const data = ${JSON.stringify(renderData)};
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

let loaded = 0;
const total = new Set(data.faces.map(f => f.tex)).size;
const images = {};

function drawAll() {
    ctx.clearRect(0, 0, 128, 128);
    for (const face of data.faces) {
        const img = images[face.tex];
        if (!img) continue;
        const p = face.pts;
        const [u1, v1, u2, v2] = face.uv;
        const sw = u2 - u1;
        const sh = v2 - v1;
        if (sw <= 0 || sh <= 0) continue;

        ctx.save();
        
        // Clip to the face polygon
        ctx.beginPath();
        ctx.moveTo(p[0].x, p[0].y);
        ctx.lineTo(p[1].x, p[1].y);
        ctx.lineTo(p[2].x, p[2].y);
        ctx.lineTo(p[3].x, p[3].y);
        ctx.closePath();
        ctx.clip();

        // Compute affine transform from UV space to screen space
        // p[0] = UV origin (u1,v1), p[1] = UV u-axis end (u2,v1), p[3] = UV v-axis end (u1,v2)
        const ax = (p[1].x - p[0].x) / sw;
        const ay = (p[1].y - p[0].y) / sw;
        const bx = (p[3].x - p[0].x) / sh;
        const by = (p[3].y - p[0].y) / sh;
        const cx = p[0].x - ax * u1 - bx * v1;
        const cy = p[0].y - ay * u1 - by * v1;

        ctx.setTransform(ax, ay, bx, by, cx, cy);
        ctx.drawImage(img, 0, 0);
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        // Apply brightness (draw semi-transparent black overlay for shadow)
        if (face.brightness < 1.0) {
            ctx.fillStyle = 'rgba(0,0,0,' + (1.0 - face.brightness) + ')';
            ctx.fill(); // fills the clipped polygon
        }

        ctx.restore();
    }
    document.title = 'DONE';
}

// Load all unique textures
const uniqueTextures = [...new Set(data.faces.map(f => f.tex))];
for (const tex of uniqueTextures) {
    const img = new Image();
    img.onload = () => {
        images[tex] = img;
        loaded++;
        if (loaded >= total) drawAll();
    };
    img.src = tex;
}
</script></body></html>`;

            await page.setContent(html, { waitUntil: 'load' });
            
            // Wait for canvas rendering to complete
            await page.waitForFunction(() => document.title === 'DONE', { timeout: 5000 });

            // Extract canvas as PNG
            const dataUrl = await page.evaluate(() => document.getElementById('c').toDataURL('image/png'));
            const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
            fs.writeFileSync(pngPath, Buffer.from(base64Data, 'base64'));
            
            renderCount++;
            if (renderCount % 50 === 0) console.log(`Rendered ${renderCount} blocks (${itemName})`);

        } catch (e) {
            // Silent skip for items that can't be rendered
        }
    }

    await browser.close();
    console.log(`Done! Rendered ${renderCount} block PNGs to ${OUT_DIR}`);
}

run().catch(console.error);
