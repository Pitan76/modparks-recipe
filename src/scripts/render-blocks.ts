/**
 * @fileoverview node-canvas を使用した純粋な Node.js ブロックレンダラーのCLIエントリーポイント。
 * ブラウザなどのGUI環境に依存せず、GitHub Actions上でも動作します。
 *
 * client.jar からモデルとテクスチャを読み込み、3D等角投影のブロックPNG画像をレンダリングして、
 * その結果を R2 にアップロードします。レンダリングパイプライン自体は `./render-blocks/*` 内にあり、
 * このファイルはコマンドラインのエントリーポイントです。
 */

import { execSync } from 'child_process';
import path from 'path';
import { uploadAll, describeTarget } from './upload-target';
import { JAR_PATH, readJarJson } from './render-blocks/jar';
import { renderBlock, renderModel } from './render-blocks/render';
import { chestModel, CHEST_VARIANTS } from '../core/chest';

const R2_PREFIX = 'assets/minecraft/textures/render3d/';

async function main() {
    // すべてのアイテム定義を取得します
    const listOutput = execSync(
        `unzip -l "${JAR_PATH}" "assets/minecraft/items/*.json" | grep "assets/minecraft/items/" | awk '{print $4}'`,
        { encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024 }
    ).trim();
    const itemPaths = listOutput.split('\n').filter(Boolean);
    console.log(`Found ${itemPaths.length} item definitions`);

    // 最初にシングルスレッドのCanvas処理でレンダリングを完了させ、その後、
    // 同時実行制限を設けた1つのNodeプロセス内で結果をR2にアップロードします。
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

            // チェスト（および他のブロックエンティティ）はレンダリング可能なモデルを持ちません。
            // 代わりに、エンティティアトラスのテクスチャを用いた合成ボックスモデルを使用します。
            const png = CHEST_VARIANTS[itemName]
                ? await renderModel(chestModel(CHEST_VARIANTS[itemName]))
                : await renderBlock(modelId);
            if (!png) continue;

            rendered.push({ name: itemName, png });
            if (rendered.length % 50 === 0) console.log(`  Rendered ${rendered.length} blocks... (${itemName})`);
        } catch (e: any) {
            // レンダリングできないアイテムはスキップします
        }
    }

    console.log(`\nRendered ${rendered.length} block PNGs. Uploading via ${describeTarget()}...`);
    await uploadAll(
        rendered.map(({ name, png }) => ({ key: `${R2_PREFIX}${name}.png`, body: png })),
        (done) => { if (done % 100 === 0) console.log(`  Uploaded ${done}/${rendered.length}...`); }
    );

    console.log(`Done. Uploaded ${rendered.length} block PNGs.`);
}

main().catch(console.error);
