import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { init as initSatori } from 'satori/standalone';

// @ts-ignore
import resvgWasmModule from '@resvg/resvg-wasm/index_bg.wasm';
// @ts-ignore
import yogaWasmModule from 'satori/yoga.wasm';

// Shared WASM init. initWasm/initSatori must run exactly once per isolate, so
// every renderer (recipe images and on-the-fly 3D block icons) goes through here
// instead of each keeping its own guard (which would double-initialize).
let wasmReady: Promise<void> | null = null;

export function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    wasmReady = (async () => {
      await initWasm(resvgWasmModule);
      await initSatori(yogaWasmModule);
    })();
  }
  return wasmReady;
}

/** Rasterize an SVG string to PNG bytes. Caller must have awaited ensureWasm(). */
export function svgToPng(svg: string, options?: ConstructorParameters<typeof Resvg>[1]): Uint8Array {
  return new Resvg(svg, options).render().asPng();
}
