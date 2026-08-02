/**
 * @fileoverview 同時実行数を絞ってタスクを流すための共有ヘルパー。
 */

/**
 * 指定された同時実行数の範囲でタスクを実行します。
 *
 * 一括系の処理は1リクエストで数百件を扱います。直列にすると通信の往復待ちだけで
 * リクエストの制限時間を使い切り、逆に全件を同時に走らせるとレンダリングのCPUとメモリが
 * 一度に立ち上がってアイソレートごと落ちます。その中間を取るためのものです。
 * @param items 処理するアイテムの配列
 * @param limit 同時実行数の上限
 * @param worker 各アイテムを処理する非同期関数
 */
export async function runPool<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await worker(items[i], i);
      }
    })
  );
}
