/**
 * @fileoverview レンダラー群で共有される WebAssembly (WASM) の初期化モジュール。
 * `initWasm` および `initSatori` はアイソレートごとに正確に1回だけ実行する必要があるため、
 * すべてのレンダラー（レシピ画像やオンデマンドの3Dブロックアイコンなど）は、個別に初期化チェックを持つのではなく、
 * 二重初期化を防ぐためにここを経由して初期化を行います。
 */

import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { init as initSatori } from 'satori/standalone';

// @ts-ignore
import resvgWasmModule from '@resvg/resvg-wasm/index_bg.wasm';
// @ts-ignore
import yogaWasmModule from 'satori/yoga.wasm';

let wasmReady: Promise<void> | null = null;

/**
 * WASMモジュール（resvgおよびsatoriのyoga）が初期化されていることを保証します。
 * @returns 初期化完了を示す Promise
 */
export function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    wasmReady = (async () => {
      await initWasm(resvgWasmModule);
      await initSatori(yogaWasmModule);
    })();
  }
  return wasmReady;
}

/**
 * SVG文字列をPNGのバイナリデータにラスタライズします。呼び出し側は事前に `ensureWasm()` を完了しておく必要があります。
 * @param svg SVG形式の文字列
 * @param options resvgのレンダリングオプション
 * @returns PNG画像のバイナリ
 */
export function svgToPng(svg: string, options?: ConstructorParameters<typeof Resvg>[1]): Uint8Array {
  return new Resvg(svg, options).render().asPng();
}
