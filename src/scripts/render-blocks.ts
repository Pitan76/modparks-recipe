// Pure Node.js block renderer using node-canvas.
// No browser dependency - works in GitHub Actions.
//
// Reads models + textures from client.jar, renders isometric 3D block PNGs,
// then uploads the results to R2. The rendering pipeline lives in
// ./render-blocks/*; this file is just the CLI entry point.

import { execSync } from 'child_process';
import path from 'path';
import { uploadToR2, runPool, BUCKET_NAME } from './r2';
import { JAR_PATH, readJarJson } from './render-blocks/jar';
import { renderBlock, renderModel } from './render-blocks/render';
import { chestModel, CHEST_VARIANTS } from './render-blocks/chest';

const R2_PREFIX = 'assets/minecraft/textures/render3d/';

async function main() {
    // Get all item definitions
    const listOutput = execSync(
        `unzip -l "${JAR_PATH}" "assets/minecraft/items/*.json" | grep "assets/minecraft/items/" | awk '{print $4}'`,
        { encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024 }
    ).trim();
    const itemPaths = listOutput.split('\n').filter(Boolean);
    console.log(`Found ${itemPaths.length} item definitions`);

    // Render first (single-threaded canvas work), then upload the results to R2
    // with bounded concurrency in one Node process.
    const rendered: { name: string; png: Buffer }[] = [];
    for (let i = 0; i < itemPaths.length; i++) {
        const itemPath = itemPaths[i];
        const itemName = path.basename(itemPath, '.json');

        try {
            const itemData = readJarJson(itemPath);
            if (!itemData) continue;

            let modelId = itemData.model?.model;
            if (!modelId) modelId = `minecraft:item/${itemName}`;
            if (typeof modelId !== 'string') continue;

            // Chests (and other block entities) have no renderable model; use a
            // synthesized box model with the entity atlas texture instead.
            const png = CHEST_VARIANTS[itemName]
                ? await renderModel(chestModel(CHEST_VARIANTS[itemName]))
                : await renderBlock(modelId);
            if (!png) continue;

            rendered.push({ name: itemName, png });
            if (rendered.length % 50 === 0) console.log(`  Rendered ${rendered.length} blocks... (${itemName})`);
        } catch (e: any) {
            // Skip items that can't be rendered
        }
    }

    console.log(`\nRendered ${rendered.length} block PNGs. Uploading to R2 bucket "${BUCKET_NAME}"...`);
    let uploaded = 0;
    let failed = 0;
    await runPool(rendered, 20, async ({ name, png }) => {
        try {
            await uploadToR2(`${R2_PREFIX}${name}.png`, png);
            uploaded++;
            if (uploaded % 100 === 0) console.log(`  Uploaded ${uploaded}/${rendered.length}...`);
        } catch (e) {
            failed++;
            console.error(`  Failed to upload ${name}.png:`, (e as Error).message);
        }
    });

    console.log(`Done. Uploaded ${uploaded} block PNGs, ${failed} failures.`);
    if (failed > 0) process.exitCode = 1;
}

main().catch(console.error);
