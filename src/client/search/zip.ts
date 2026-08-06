/**
 * @fileoverview 表示中のレシピ画像を zip にまとめて渡す処理。
 *
 * 1枚ずつのダウンロードは枚数が増えると現実的でないため、まとめて1ファイルにします。
 *
 * 取得には一括APIを使います。1枚ずつ引くと枚数分のリクエストになり、数百枚では現実的ではありません。
 * 一括APIは1回で最大200件を返すので、リクエスト数は枚数の200分の1に収まります。
 * R2 の直接配信を使わないのは、別オリジンで `fetch` に CORS の許可が要るためです。
 */

import { splitId } from './api';

/** JSZip はページに読み込まれたものを使います。 */
declare const JSZip: {
  new (): {
    file(name: string, data: string, options: { base64: true }): void;
    generateAsync(options: { type: 'blob' }): Promise<Blob>;
  };
};

/** 一括APIが1回で受け付けるID数の上限。サーバ側の制限に合わせています。 */
const BATCH_SIZE = 200;

/** 同時に投げる一括リクエスト数。 */
const CONCURRENCY = 2;

/** 進捗の通知。 */
export type ZipProgress = (done: number, total: number) => void;

/**
 * レシピ画像をまとめて取得し、zip の Blob を作ります。
 * @param recipeIds 対象のレシピID
 * @param fmt 画像形式
 * @param scale 拡大率
 * @param onProgress 進捗の通知
 * @returns zip の Blob。1枚も取れなければ null
 */
export async function buildRecipeZip(
  recipeIds: string[],
  fmt: string,
  scale: number,
  onProgress?: ZipProgress
): Promise<Blob | null> {
  const zip = new JSZip();
  let done = 0;
  let added = 0;

  const batches = groupByNamespace(recipeIds);
  const queue = [...batches];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let batch = queue.shift(); batch !== undefined; batch = queue.shift()) {
      // 1バッチの失敗で全体を捨てると、数百枚のうち一部のためにやり直しになります。
      const images: Record<string, string | null> = await fetchBatch(batch.ns, batch.ids, fmt, scale).catch(() => ({}));
      for (const id of batch.ids) {
        const dataUrl = images[id];
        const base64 = dataUrl ? dataUrl.slice(dataUrl.indexOf(',') + 1) : null;
        if (base64) {
          zip.file(`${id}.${fmt}`, base64, { base64: true });
          added++;
        }
        onProgress?.(++done, recipeIds.length);
      }
    }
  });
  await Promise.all(workers);

  if (added === 0) return null;
  return zip.generateAsync({ type: 'blob' });
}

/** 一括APIへ渡す単位。IDはネームスペースを除いた部分です。 */
type Batch = { ns: string; ids: string[] };

/**
 * レシピIDをネームスペースごとに分け、一括APIの上限で刻みます。
 * @param recipeIds 対象のレシピID
 */
function groupByNamespace(recipeIds: string[]): Batch[] {
  const byNs = new Map<string, string[]>();
  for (const full of recipeIds) {
    const { ns, id } = splitId(full);
    const list = byNs.get(ns) ?? [];
    list.push(id);
    byNs.set(ns, list);
  }

  const batches: Batch[] = [];
  for (const [ns, ids] of byNs) {
    for (let i = 0; i < ids.length; i += BATCH_SIZE) batches.push({ ns, ids: ids.slice(i, i + BATCH_SIZE) });
  }
  return batches;
}

/**
 * 一括APIで画像を取得します。
 * @param ns ネームスペース
 * @param ids ネームスペースを除いたレシピID
 * @param fmt 画像形式
 * @param scale 拡大率
 * @returns IDからデータURLへの対応
 */
async function fetchBatch(
  ns: string,
  ids: string[],
  fmt: string,
  scale: number
): Promise<Record<string, string | null>> {
  const res = await fetch(`/api/${encodeURIComponent(ns)}/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, ext: fmt, scale }),
  });
  if (!res.ok) return {};

  const body = (await res.json()) as { images?: Record<string, string | null> };
  return body.images ?? {};
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
