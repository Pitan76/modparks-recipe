/**
 * @fileoverview 表示中のレシピ画像を zip にまとめて渡す処理。
 *
 * 2段構えで集めます。まず R2 の直接配信から取り、取れなかったものだけ一括APIへ回します。
 * 直接配信は Worker を起こさず生バイトで受け取れるぶん軽く、生成済みの画像は大半がこちらで済みます。
 * 未生成の画像は直接配信では 404 になるため、そこだけ一括APIに作らせます。
 *
 * 直接配信は別オリジンなので、`fetch` で読むにはバケット側に CORS の許可が要ります。
 * 許可が無ければ全件が一括APIへ落ちるだけで、結果は変わりません。
 */

import { imageCdnPath, splitId, type Assets, type Versions } from './api';

/** JSZip はページに読み込まれたものを使います。 */
declare const JSZip: {
  new (): {
    file(name: string, data: ArrayBuffer | string, options?: { base64: true }): void;
    generateAsync(options: { type: 'blob' }): Promise<Blob>;
  };
};

/** 一括APIが1回で受け付けるID数の上限。サーバ側の制限に合わせています。 */
const BATCH_SIZE = 200;

/** 直接配信を同時に取りに行く本数。 */
const DIRECT_CONCURRENCY = 8;

/** 同時に投げる一括リクエスト数。 */
const BATCH_CONCURRENCY = 2;

/** 進捗の通知。 */
export type ZipProgress = (done: number, total: number) => void;

/** 集める先。zip への追加と進捗の更新をまとめて受け持ちます。 */
type Sink = {
  add(recipeId: string, data: ArrayBuffer | string, base64: boolean): void;
  step(): void;
};

/**
 * レシピ画像をまとめて取得し、zip の Blob を作ります。
 * @param recipeIds 対象のレシピID
 * @param fmt 静止画の形式
 * @param animated 素材が切り替わるレシピかどうかの判定。true のものは GIF にします
 * @param versions ネームスペースごとのバージョン
 * @param assets 配信情報
 * @param scale 拡大率
 * @param onProgress 進捗の通知
 * @returns zip の Blob。1枚も取れなければ null
 */
export async function buildRecipeZip(
  recipeIds: string[],
  fmt: string,
  animated: (recipeId: string) => boolean,
  versions: Versions | null,
  assets: Assets | null,
  scale: number,
  onProgress?: ZipProgress
): Promise<Blob | null> {
  const zip = new JSZip();
  let done = 0;
  let added = 0;

  // 素材が切り替わるものだけ GIF。静止画を GIF にすると色数が落ち、PNG より重くなります。
  const extOf = (recipeId: string) => (animated(recipeId) ? 'gif' : fmt);

  const sink: Sink = {
    add(recipeId, data, base64) {
      zip.file(`${splitId(recipeId).id}.${extOf(recipeId)}`, data, base64 ? { base64: true } : undefined);
      added++;
    },
    step() {
      onProgress?.(++done, recipeIds.length);
    },
  };

  const missing = await collectDirect(recipeIds, extOf, versions, assets, scale, sink);
  await collectBatched(missing, extOf, scale, sink);

  if (added === 0) return null;
  return zip.generateAsync({ type: 'blob' });
}

/**
 * R2 の直接配信から集めます。
 * @returns 取れなかったレシピID
 */
async function collectDirect(
  recipeIds: string[],
  extOf: (recipeId: string) => string,
  versions: Versions | null,
  assets: Assets | null,
  scale: number,
  sink: Sink
): Promise<string[]> {
  const missing: string[] = [];
  const queue = [...recipeIds];

  const workers = Array.from({ length: Math.min(DIRECT_CONCURRENCY, queue.length) }, async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      const url = imageCdnPath(id, extOf(id), versions, assets, scale);
      // 未生成なら404、CORS が未設定なら例外。どちらも一括APIへ回します。
      const bytes = url ? await fetchBytes(url) : null;
      if (!bytes) {
        missing.push(id);
        continue;
      }
      sink.add(id, bytes, false);
      sink.step();
    }
  });
  await Promise.all(workers);

  return missing;
}

/**
 * 一括APIから集めます。直接配信で取れなかった分の受け皿です。
 * @param recipeIds 対象のレシピID
 */
async function collectBatched(
  recipeIds: string[],
  extOf: (recipeId: string) => string,
  scale: number,
  sink: Sink
): Promise<void> {
  // 一括APIは1リクエストにつき1形式なので、形式ごとに分けて投げます。
  const queue = groupByNamespace(recipeIds).flatMap((batch) => splitByExt(batch, extOf));

  const workers = Array.from({ length: Math.min(BATCH_CONCURRENCY, queue.length) }, async () => {
    for (let batch = queue.shift(); batch !== undefined; batch = queue.shift()) {
      // 1バッチの失敗で全体を捨てると、数百枚のうち一部のためにやり直しになります。
      const images: Record<string, string | null> = await fetchBatch(batch.ns, batch.ids, batch.ext, scale).catch(() => ({}));
      for (const id of batch.ids) {
        const dataUrl = images[id];
        if (dataUrl) sink.add(`${batch.ns}:${id}`, dataUrl.slice(dataUrl.indexOf(',') + 1), true);
        sink.step();
      }
    }
  });
  await Promise.all(workers);
}

/**
 * URLの中身をバイト列で読みます。
 * @returns 取れなければ null
 */
async function fetchBytes(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url);
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/** 一括APIへ渡す単位。IDはネームスペースを除いた部分です。 */
type Batch = { ns: string; ids: string[]; ext: string };

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
    for (let i = 0; i < ids.length; i += BATCH_SIZE) batches.push({ ns, ids: ids.slice(i, i + BATCH_SIZE), ext: '' });
  }
  return batches;
}

/**
 * 1つの束を形式ごとに分けます。一括APIはリクエスト単位でしか形式を指定できません。
 * @param batch 分ける前の束
 * @param extOf レシピIDから形式を決める関数
 */
function splitByExt(batch: Batch, extOf: (recipeId: string) => string): Batch[] {
  const byExt = new Map<string, string[]>();
  for (const id of batch.ids) {
    const ext = extOf(`${batch.ns}:${id}`);
    const list = byExt.get(ext) ?? [];
    list.push(id);
    byExt.set(ext, list);
  }
  return [...byExt].map(([ext, ids]) => ({ ns: batch.ns, ids, ext }));
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
