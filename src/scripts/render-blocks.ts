/**
 * @fileoverview バニラのブロックアイコンPNGを焼いて R2 へ載せるCLIエントリーポイント。
 *
 * client.jar からアイテム定義を数え上げ、Worker と同じ描画コードでアイコンを作り、`render3d/` に
 * 上げます。GUI環境に依存しないので GitHub Actions 上でも動きます。
 *
 * `render3d/` に置いた絵は配信時に最優先で返され、ライブ描画へは落ちません。つまりここが焼いた
 * 絵がそのまま見えるものになるため、描き方は Worker と一致していなければなりません。以前は
 * node-canvas で独立に描いており、Worker 側だけ直した修正（ガラスの裏面カリング、チェストの
 * 留め具）が反映されないままでした。
 *
 * 使用例:
 *   npx tsx src/scripts/render-blocks.ts
 */

import path from 'path';
import { uploadAll, describeTarget } from './upload-target';
import { JAR_PATH } from './render-blocks/jar';
import { bakeIcon } from './render-blocks/rasterize';
import { jarSource } from './jar-reader';

const NAMESPACE = 'minecraft';
const R2_PREFIX = `assets/${NAMESPACE}/textures/render3d/`;

/** 進捗を出す間隔。 */
const PROGRESS_EVERY = 50;

async function main() {
    const src = await jarSource(path.isAbsolute(JAR_PATH) ? JAR_PATH : path.join(process.cwd(), JAR_PATH));
    const ids = await src.itemIds(NAMESPACE);
    console.log(`Found ${ids.length} item definitions`);

    // 先に全部焼いてから上げます。描画は単一プロセスで直列、アップロードだけ同時実行に回すためです。
    const rendered: { name: string; png: Buffer }[] = [];
    for (const id of ids) {
        // 描けないものは飛ばします。専用描画が要るアイテム（旗・シュルカーボックス等）は
        // まだ組み立てられず、ここで落ちるのが正しい振る舞いです。
        const png = await bakeIcon(NAMESPACE, id, src).catch(() => null);
        if (!png) continue;

        rendered.push({ name: id, png });
        if (rendered.length % PROGRESS_EVERY === 0) console.log(`  Rendered ${rendered.length} blocks... (${id})`);
    }

    console.log(`\nRendered ${rendered.length} block PNGs. Uploading via ${describeTarget()}...`);
    await uploadAll(
        rendered.map(({ name, png }) => ({ key: `${R2_PREFIX}${name}.png`, body: png })),
        (done) => { if (done % 100 === 0) console.log(`  Uploaded ${done}/${rendered.length}...`); }
    );

    console.log(`Done. Uploaded ${rendered.length} block PNGs.`);
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
