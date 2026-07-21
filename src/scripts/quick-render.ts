/**
 * @fileoverview クイック再レンダラー。既存の client.jar からデータを読み込み、SVGファイルのみを再生成します。
 */

import * as unzipper from 'unzipper';
import fs from 'fs';
import path from 'path';
import { renderModelToSvg } from '../utils/model-parser';

/**
 * クイック再レンダリング処理を実行します。
 */
async function run() {
    const tempFilePath = path.join(process.cwd(), 'client.jar');
    if (!fs.existsSync(tempFilePath)) {
        console.error('client.jar not found. Run fetch-mc-data.ts first.');
        process.exit(1);
    }

    const modelsCache = new Map<string, any>();
    const itemsCache = new Map<string, any>();
    const texturesCache = new Map<string, string>();

    const MODEL_PATHS = [
        /^assets\/minecraft\/models\/item\/.*\.json$/,
        /^assets\/minecraft\/models\/block\/.*\.json$/,
        /^assets\/minecraft\/items\/.*\.json$/
    ];

    console.log('Reading client.jar...');
    const nodeStream = fs.createReadStream(tempFilePath);
    
    await new Promise<void>((resolve, reject) => {
        nodeStream.pipe(unzipper.Parse())
            .on('entry', async (entry: unzipper.Entry) => {
                const fileName = entry.path;
                const isModel = MODEL_PATHS.some(r => r.test(fileName));
                const isTexture = fileName.endsWith('.png') && (
                    fileName.startsWith('assets/minecraft/textures/item/') ||
                    fileName.startsWith('assets/minecraft/textures/block/')
                );

                if (entry.type === 'File' && (isModel || isTexture)) {
                    const buffer = await entry.buffer();
                    if (isModel) {
                        try {
                            if (fileName.startsWith('assets/minecraft/items/')) {
                                itemsCache.set(fileName.replace('assets/minecraft/items/', ''), JSON.parse(buffer.toString('utf-8')));
                            } else {
                                modelsCache.set(fileName.replace('assets/minecraft/models/', ''), JSON.parse(buffer.toString('utf-8')));
                            }
                        } catch(e) {}
                    }
                    if (isTexture) {
                        texturesCache.set(fileName.replace('assets/minecraft/textures/', ''), `data:image/png;base64,${buffer.toString('base64')}`);
                    }
                } else {
                    entry.autodrain();
                }
            })
            .on('finish', resolve)
            .on('error', reject);
    });

    console.log(`Loaded ${modelsCache.size} models, ${itemsCache.size} items, ${texturesCache.size} textures`);

    const getModelJson = async (id: string) => {
        let name = id;
        if (name.startsWith('minecraft:')) name = name.replace('minecraft:', '');
        if (!name.endsWith('.json')) name += '.json';
        return modelsCache.get(name);
    };
    const getTextureBase64 = async (id: string) => {
        const name = id.replace('minecraft:', '') + '.png';
        return texturesCache.get(name) || null;
    };

    const outDir = path.join(process.cwd(), 'render_out');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    let renderCount = 0;

    // 従来のレガシーなアイテムモデルからレンダリングします。
    for (const [key] of modelsCache.entries()) {
        if (key.startsWith('item/')) {
            const modelId = 'minecraft:' + key.replace('.json', '');
            try {
                const svg = await renderModelToSvg(modelId, getModelJson, getTextureBase64);
                if (svg) {
                    const itemName = key.replace('item/', '').replace('.json', '');
                    fs.writeFileSync(path.join(outDir, `${itemName}.svg`), svg, 'utf-8');
                    renderCount++;
                }
            } catch(e) {
                console.error(`Failed to render ${modelId}`, e);
            }
        }
    }

    // モダンな 1.21 以降のアイテム定義からレンダリングします。
    for (const [key, itemData] of itemsCache.entries()) {
        const itemName = key.replace('.json', '');
        let modelId = itemData.model?.model;
        if (!modelId) modelId = `minecraft:item/${itemName}`;
        try {
            const svg = await renderModelToSvg(modelId, getModelJson, getTextureBase64);
            if (svg) {
                fs.writeFileSync(path.join(outDir, `${itemName}.svg`), svg, 'utf-8');
                renderCount++;
            }
        } catch(e) {
            console.error(`Failed to render item ${itemName}`, e);
        }
    }

    console.log(`Rendered ${renderCount} SVGs to ${outDir}`);
}

run().catch(console.error);
