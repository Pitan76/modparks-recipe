/**
 * @fileoverview 表示中のレシピ画像を zip にまとめて渡す処理。
 *
 * 1枚ずつのダウンロードは枚数が増えると現実的でないため、まとめて1ファイルにします。
 * 画像は同一オリジンの画像APIから取ります。R2 の直接配信は別オリジンで、`<img>` では読めても
 * `fetch` は CORS の許可が要るため、まとめ取りの経路としては当てにできません。
 */

import { imagePath, splitId, type Assets, type Versions } from './api';

/** JSZip はページに読み込まれたものを使います。 */
declare const JSZip: {
  new (): {
    file(name: string, data: ArrayBuffer): void;
    generateAsync(options: { type: 'blob' }): Promise<Blob>;
  };
};

/** 同時に取りに行く枚数。 */
const CONCURRENCY = 6;

/** 進捗の通知。 */
export type ZipProgress = (done: number, total: number) => void;

/**
 * レシピ画像をまとめて取得し、zip の Blob を作ります。
 * @param recipeIds 対象のレシピID
 * @param fmt 画像形式
 * @param versions ネームスペースごとのバージョン
 * @param assets 配信情報
 * @param scale 拡大率
 * @param onProgress 進捗の通知
 * @returns zip の Blob。1枚も取れなければ null
 */
export async function buildRecipeZip(
  recipeIds: string[],
  fmt: string,
  versions: Versions | null,
  assets: Assets | null,
  scale: number,
  onProgress?: ZipProgress
): Promise<Blob | null> {
  const zip = new JSZip();
  let done = 0;
  let added = 0;

  const queue = [...recipeIds];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      // 1枚の失敗で全体を捨てると、数百枚のうち1枚のためにやり直しになります。
      const bytes = await fetchImage(id, fmt, versions, assets, scale).catch(() => null);
      if (bytes) {
        zip.file(`${splitId(id).id}.${fmt}`, bytes);
        added++;
      }
      onProgress?.(++done, recipeIds.length);
    }
  });
  await Promise.all(workers);

  if (added === 0) return null;
  return zip.generateAsync({ type: 'blob' });
}

/**
 * 画像1枚を取得します。
 * @param recipeId レシピID
 * @param fmt 画像形式
 * @param versions ネームスペースごとのバージョン
 * @param assets 配信情報
 * @param scale 拡大率
 */
async function fetchImage(
  recipeId: string,
  fmt: string,
  versions: Versions | null,
  assets: Assets | null,
  scale: number
): Promise<ArrayBuffer | null> {
  const res = await fetch(imagePath(recipeId, fmt, versions, assets, scale));
  if (!res.ok) return null;
  return res.arrayBuffer();
}

/**
 * Blob をファイルとして保存させます。
 * @param blob 中身
 * @param fileName ファイル名
 */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  // 即座に解放すると保存が始まる前に失効することがあるため、少し置いてから捨てます。
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
