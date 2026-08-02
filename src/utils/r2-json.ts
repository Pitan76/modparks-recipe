/**
 * @fileoverview R2 上のJSONオブジェクトを、取りこぼしなく読み書きするためのユーティリティ。
 *
 * バージョン表とレシピ索引は「読んで、直して、書き戻す」形で更新します。素の put では
 * 読んでから書くまでの間に入った他リクエストの更新が上書きで消えます。実際、複数の mod を
 * 同時に投入すると片方の索引エントリが消えていました。
 *
 * R2 の条件付き書き込み（etag 一致時のみ置き換え）を使い、割り込まれたら読み直して
 * やり直します。ロックを持たないので、失敗しても他のリクエストを止めません。
 */

import type { Env } from './minecraft';

/** 競合したときに読み直してやり直す回数。 */
const MAX_ATTEMPTS = 5;

/** やり直し前に待つ基準時間（ミリ秒）。回数に応じて伸ばします。 */
const RETRY_BASE_MS = 25;

/**
 * JSONオブジェクトを read-modify-write で更新します。
 *
 * `mutate` は競合のたびに最新の内容で呼び直されるため、副作用を持たせないでください。
 * @param env 環境変数
 * @param key R2オブジェクトキー
 * @param mutate 現在の内容（未作成なら null）から新しい内容を作る関数
 * @returns 書き込んだ内容
 * @throws 競合が続いて上限回数まで書き込めなかった場合
 */
export async function updateJson<T>(env: Env, key: string, mutate: (current: T | null) => T): Promise<T> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const existing = await env.BUCKET.get(key);
    const next = mutate(await parseOrNull<T>(existing));

    const written = await env.BUCKET.put(key, JSON.stringify(next), {
      httpMetadata: { contentType: 'application/json' },
      // 未作成なら「存在しないときだけ作る」、既存なら「読んだ版のままなら置き換える」。
      onlyIf: existing ? { etagMatches: existing.etag } : new Headers({ 'If-None-Match': '*' }),
    });
    if (written) return next;

    await sleep(RETRY_BASE_MS * (attempt + 1));
  }
  throw new Error(`R2 update conflicted ${MAX_ATTEMPTS} times: ${key}`);
}

/**
 * R2オブジェクトをJSONとして読みます。壊れていれば未作成と同じ扱いにします。
 * @param obj 読み出したR2オブジェクト
 */
async function parseOrNull<T>(obj: R2ObjectBody | null): Promise<T | null> {
  if (!obj) return null;

  try {
    return await obj.json<T>();
  } catch {
    return null;
  }
}

/**
 * 指定ミリ秒だけ待ちます。
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
