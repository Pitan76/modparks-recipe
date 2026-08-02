/**
 * @fileoverview R2 上のレシピJSONから公開インデックスを再構築する処理。
 *
 * 全件を1リクエストで舐めるとレシピ1件につき R2 GET が1回走り、Worker のサブリクエスト
 * 上限（1リクエストあたり1000）に当たって途中で失敗します。件数が増えるほど確実に落ちるため、
 * 1回の呼び出しで扱う件数を区切り、途中経過を R2 に置いて次の呼び出しへ引き継ぎます。
 *
 * 途中経過は作業用キーに貯め、最後の呼び出しで初めて公開インデックスへ差し替えます。
 * こうしないと、再構築の途中で一覧が虫食いの状態で見えてしまいます。
 */

import type { Env } from './minecraft';
import { resultItemOf, isCraftingType } from './minecraft';
import type { IndexEntry } from './recipe-store';

const INDEX_KEY = 'index/recipes.json';

/** 再構築中の途中経過を置くキー。完了時に削除します。 */
const BUILDING_KEY = 'index/recipes.building.json';

/** 1回の呼び出しで読むレシピ数の既定値。サブリクエスト上限に対して余裕を取っています。 */
const DEFAULT_BATCH = 500;

/** 1回の呼び出しで読むレシピ数の上限。 */
const MAX_BATCH = 900;

/** レシピ本文を並列に読む本数。 */
const CONCURRENCY = 30;

/** 再構築1ステップの結果。`done` が false の間、呼び出し側は `cursor` を渡して呼び直します。 */
export type ReindexStep = { done: boolean; cursor?: string; scanned: number; count: number };

/**
 * 1回の呼び出しで扱う件数を正規化します。
 * @param value クエリで指定された件数
 */
export function normalizeBatch(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_BATCH;
  return Math.min(n, MAX_BATCH);
}

/**
 * レシピJSONのキーを、上限に達するまで列挙します。
 * @param env 環境変数
 * @param cursor 前回の続きから読むためのカーソル
 * @param limit 収集するキー数の上限
 */
async function listRecipeKeys(
  env: Env,
  cursor: string | undefined,
  limit: number
): Promise<{ keys: { fullId: string; key: string }[]; next?: string }> {
  const keys: { fullId: string; key: string }[] = [];

  let at = cursor;
  do {
    const listed = await env.BUCKET.list({ prefix: 'data/', cursor: at, limit: 1000 });
    for (const o of listed.objects) {
      const m = o.key.match(/^data\/([^/]+)\/recipes?\/(.+)\.json$/);
      if (m) keys.push({ fullId: `${m[1]}:${m[2]}`, key: o.key });
    }
    at = listed.truncated ? listed.cursor : undefined;
  } while (at && keys.length < limit);

  return { keys, next: at };
}

/**
 * レシピJSONを並列に読み、公開インデックス用のエントリを組み立てます。
 * クラフト系のみを対象とし、読めなかった/JSONでないものはスキップします。
 * @param env 環境変数
 * @param keys 列挙済みの { fullId, key } の配列
 */
async function buildRecipeEntries(env: Env, keys: { fullId: string; key: string }[]): Promise<IndexEntry[]> {
  const out: IndexEntry[] = [];
  let i = 0;

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, keys.length) }, async () => {
      while (i < keys.length) {
        const { fullId, key } = keys[i++];
        const entry = await readEntry(env, fullId, key);
        if (entry) out.push(entry);
      }
    })
  );
  return out;
}

/**
 * レシピJSONを1件読み、索引エントリにします。読めない/対象外なら null。
 * @param env 環境変数
 * @param fullId 完全修飾レシピID
 * @param key R2オブジェクトキー
 */
async function readEntry(env: Env, fullId: string, key: string): Promise<IndexEntry | null> {
  const obj = await env.BUCKET.get(key);
  if (!obj) return null;

  let data: any;
  try {
    data = JSON.parse(await obj.text());
  } catch {
    return null;
  }
  if (!isCraftingType(data?.type)) return null;
  return { id: fullId, result: resultItemOf(data), type: String(data.type).replace(/^minecraft:/, '') };
}

/**
 * インデックス再構築を1ステップ進めます。
 * @param env 環境変数
 * @param cursor 前回の続きから読むためのカーソル（初回は undefined）
 * @param batch 1回で読むレシピ数
 */
export async function reindexStep(env: Env, cursor: string | undefined, batch: number): Promise<ReindexStep> {
  const { keys, next } = await listRecipeKeys(env, cursor, batch);
  const carried = cursor ? await readBuilding(env) : [];
  const recipes = carried.concat(await buildRecipeEntries(env, keys));

  if (next) {
    await putJson(env, BUILDING_KEY, recipes);
    return { done: false, cursor: next, scanned: keys.length, count: recipes.length };
  }

  recipes.sort((a, b) => a.id.localeCompare(b.id));
  await putJson(env, INDEX_KEY, { count: recipes.length, generatedAt: new Date().toISOString(), recipes });
  await env.BUCKET.delete(BUILDING_KEY);
  return { done: true, scanned: keys.length, count: recipes.length };
}

/**
 * 途中経過を読み出します。壊れていれば最初からやり直す扱いにします。
 * @param env 環境変数
 */
async function readBuilding(env: Env): Promise<IndexEntry[]> {
  const obj = await env.BUCKET.get(BUILDING_KEY);
  if (!obj) return [];

  try {
    const parsed = await obj.json<IndexEntry[]>();
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * JSONをR2へ書き込みます。
 */
async function putJson(env: Env, key: string, value: unknown): Promise<void> {
  await env.BUCKET.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: 'application/json' },
  });
}
