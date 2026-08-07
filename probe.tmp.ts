import JSZip from 'jszip';
import fs from 'fs';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { renderBlockIconSvg } from './src/utils/block-icon';
import type { AssetBody, AssetReader } from './src/core/asset-reader';

const ROOTS: Record<string, (ns: string) => string> = {
  textures: (ns) => `assets/${ns}/textures/`,
  models: (ns) => `assets/${ns}/models/`,
};
class JarOnly implements AssetReader {
  readonly persistIcons = false;
  constructor(private zip: JSZip) {}
  async get(ns: string, p: string): Promise<AssetBody | null> {
    const i = p.indexOf('/');
    const root = ROOTS[p.slice(0, i)];
    const f = root ? this.zip.file(`${root(ns)}${p.slice(i + 1)}`) : null;
    return f ? { text: () => f.async('string'), arrayBuffer: () => f.async('arraybuffer') } : null;
  }
  async buildOf() { return 'local-0'; }
}
(async () => {
  await initWasm(fs.readFileSync('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
  const zip = await JSZip.loadAsync(fs.readFileSync('./client.jar'));
  const reader = new JarOnly(zip);
  for (const id of ['wither_skeleton_skull', 'skeleton_skull', 'creeper_head', 'chest']) {
    const svg = await renderBlockIconSvg(null, 'minecraft', id, reader);
    if (!svg) { console.log(id, '描画できず'); continue; }
    fs.writeFileSync(`${process.argv[2]}/fix-${id}.png`,
      new Resvg(svg, { fitTo: { mode: 'width', value: 128 }, shapeRendering: 0, imageRendering: 1 }).render().asPng());
    console.log(id, 'OK');
  }
})();
