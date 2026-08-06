/**
 * @fileoverview プレビュー結果を zip にまとめて保存する処理。
 *
 * 画像は既に data URL として手元にあるため、取得のやり直しは要りません。base64 のまま
 * 詰めることで、いったんバイト列に直して積み直す無駄を避けています。
 */

/** JSZip はページに読み込まれたものを使います。 */
declare const JSZip: {
  new (): {
    file(name: string, data: string | Uint8Array, options?: { base64: true }): void;
    generateAsync(options: { type: 'blob' }): Promise<Blob>;
  };
};

import type { LocalRecipe } from './local-render';
import { svgFramesToGif, svgToPng } from './local-export';

/**
 * プレビュー結果を zip にして保存させます。
 * @param images レシピIDからデータURLへの対応
 * @param fileName 保存するファイル名
 */
export async function saveDataUrlZip(images: Record<string, string | null>, fileName: string): Promise<void> {
  const zip = new JSZip();
  let added = 0;

  for (const [id, dataUrl] of Object.entries(images)) {
    if (!dataUrl) continue;
    const ext = extensionOf(dataUrl);
    // `ns:id` の `:` と `/` はファイル名に使えないため、階層に開きます。
    zip.file(`${id.replace(':', '/')}.${ext}`, dataUrl.slice(dataUrl.indexOf(',') + 1), { base64: true });
    added++;
  }
  if (added === 0) return;

  saveBlob(await zip.generateAsync({ type: 'blob' }), fileName);
}

/**
 * データURLの種別から拡張子を決めます。
 * @param dataUrl データURL
 */
function extensionOf(dataUrl: string): string {
  if (dataUrl.startsWith('data:image/gif')) return 'gif';
  if (dataUrl.startsWith('data:image/svg')) return 'svg';
  return 'png';
}

/**
 * Blob をファイルとして保存させます。
 * @param blob 中身
 * @param fileName ファイル名
 */
function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  // 即座に解放すると保存が始まる前に失効することがあるため、少し置いてから捨てます。
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * 手元で組み立てたレシピを PNG / GIF にして zip で保存します。
 *
 * 素材が切り替わるものは GIF、それ以外は PNG にします。描画も変換も zip 化もこの端末で完結するため、
 * 通信は一切発生しません。
 * @param recipes 手元で組み立てたレシピ
 * @param scale 拡大率
 * @param fileName 保存するファイル名
 * @param onProgress 進捗の通知
 */
export async function saveLocalZip(
  recipes: LocalRecipe[],
  scale: number,
  fileName: string,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  const zip = new JSZip();
  let added = 0;
  let done = 0;

  for (const recipe of recipes) {
    const animated = recipe.frames.length > 1;
    // 1件の失敗で全体を捨てず、変換できたものだけ詰めます。
    const bytes = animated
      ? await svgFramesToGif(recipe.frames, scale).catch(() => null)
      : await svgToPng(recipe.svg, scale).catch(() => null);

    if (bytes) {
      // `ns:id` の `:` はファイル名に使えないため、階層に開きます。
      zip.file(`${recipe.id.replace(':', '/')}.${animated ? 'gif' : 'png'}`, bytes);
      added++;
    }
    onProgress?.(++done, recipes.length);
  }
  if (added === 0) return;

  saveBlob(await zip.generateAsync({ type: 'blob' }), fileName);
}
