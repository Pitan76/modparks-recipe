/**
 * @fileoverview `/extractor.js` の中身。`core/jar-assets` をグローバルに生やすだけの薄い層です。
 *
 * この公開URLは ModParks 本体や外部のツールが素の script タグで読み込むための口で、
 * バンドラを持たない呼び出し側もそのまま使えるようにしてあります。
 * 実装は TS 側に一本化してあるので、ここを手で書き足さないでください。
 */

import { analyzeJar, bytesToBase64 } from '../core/jar-assets';

const g = globalThis as unknown as Record<string, unknown>;
g.analyzeJar = analyzeJar;
g.bytesToBase64 = bytesToBase64;
