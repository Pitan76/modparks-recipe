/**
 * @fileoverview 取り込みセッション。分割送信される bulk を1つの論理トランザクションとして扱います。
 *
 * modparks 経由の mod 投入は1 mod あたり 10〜30 回の bulk POST に分割されます。従来は各 bulk が
 * その都度アセットバージョンを上げ、さらに 118KB のインデックスを read-modify-write していました。
 * 前者は投入中ずっとキャッシュが定着せず、後者はロックが無いため同時投入で片方が消えます。
 *
 * セッション中の bulk はインデックスを触らず、ユニークキーへ「追加分」をステージングします
 * （read-modify-write が無いのでロック不要・取りこぼし無し）。commit 時にステージング分をまとめて
 * 1回だけインデックスへマージし、バージョンも1回だけ上げます。
 */

import type { Env } from './minecraft';

/** ステージングされる1レシピの索引エントリ（公開インデックスの形と同一）。 */
export type StagedEntry = { id: string; result: string | null; type: string };

const SESSION_PREFIX = 'meta/ingest';

/** セッションのメタ情報（存在確認と失効判定に使う）。 */
type SessionMeta = { session: string; ns: string; startedAt: string };

/** セッションが有効とみなされる最大経過時間（ミリ秒）。クラッシュしたセッションを放置しないため。 */
const SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * 新しい取り込みセッションを開始します。
 * @param env 環境変数
 * @param ns ネームスペース
 * @returns 生成されたセッションID
 */
export async function beginIngest(env: Env, ns: string): Promise<string> {
  const session = crypto.randomUUID();
  const meta: SessionMeta = { session, ns, startedAt: new Date().toISOString() };
  await env.BUCKET.put(metaKey(ns, session), JSON.stringify(meta), {
    httpMetadata: { contentType: 'application/json' },
  });
  return session;
}

/**
 * セッションが存在し、まだ失効していないことを検証します。
 * @param env 環境変数
 * @param ns ネームスペース
 * @param session セッションID
 */
export async function isIngestOpen(env: Env, ns: string, session: string): Promise<boolean> {
  const obj = await env.BUCKET.get(metaKey(ns, session));
  if (!obj) return false;
  try {
    const meta = await obj.json<SessionMeta>();
    return Date.now() - new Date(meta.startedAt).getTime() < SESSION_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * セッションへ索引エントリの一群をステージングします。ユニークキーへ書くため read-modify-write は不要です。
 * @param env 環境変数
 * @param ns ネームスペース
 * @param session セッションID
 * @param entries ステージングするエントリ
 */
export async function stageEntries(env: Env, ns: string, session: string, entries: StagedEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const key = `${dataPrefix(ns, session)}/${crypto.randomUUID()}.json`;
  await env.BUCKET.put(key, JSON.stringify(entries), {
    httpMetadata: { contentType: 'application/json' },
  });
}

/**
 * セッションにステージングされた全エントリを回収します。
 * @param env 環境変数
 * @param ns ネームスペース
 * @param session セッションID
 */
export async function collectStaged(env: Env, ns: string, session: string): Promise<StagedEntry[]> {
  const prefix = `${dataPrefix(ns, session)}/`;
  const out: StagedEntry[] = [];
  let cursor: string | undefined = undefined;
  do {
    const listed = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
    for (const o of listed.objects) {
      const obj = await env.BUCKET.get(o.key);
      if (!obj) continue;
      try {
        const part = await obj.json<StagedEntry[]>();
        if (Array.isArray(part)) out.push(...part);
      } catch {
        // 壊れた断片は無視する。
      }
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return out;
}

/**
 * セッションのステージングデータとメタ情報を破棄します。commit / abort の最後に呼びます。
 * @param env 環境変数
 * @param ns ネームスペース
 * @param session セッションID
 */
export async function cleanupIngest(env: Env, ns: string, session: string): Promise<void> {
  const prefix = `${dataPrefix(ns, session)}/`;
  let cursor: string | undefined = undefined;
  do {
    const listed = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
    const keys = listed.objects.map((o) => o.key);
    if (keys.length > 0) await env.BUCKET.delete(keys);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  await env.BUCKET.delete(metaKey(ns, session));
}

/**
 * 失効した（TTL 超過の）取り込みセッションのステージングとメタを一掃します。
 * commit/abort されずに放置された残骸を掃除するための管理用途です。
 * @param env 環境変数
 * @returns 破棄したセッション数
 */
export async function sweepStaleIngests(env: Env): Promise<number> {
  const now = Date.now();
  let swept = 0;
  let cursor: string | undefined = undefined;
  do {
    const listed = await env.BUCKET.list({ prefix: `${SESSION_PREFIX}/`, cursor, limit: 1000 });
    for (const o of listed.objects) {
      const m = o.key.match(/^meta\/ingest\/([^/]+)\/([^/]+)\/_meta\.json$/);
      if (!m) continue;
      if (now - o.uploaded.getTime() < SESSION_TTL_MS) continue;
      await cleanupIngest(env, m[1], m[2]);
      swept++;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return swept;
}

function metaKey(ns: string, session: string): string {
  return `${SESSION_PREFIX}/${ns}/${session}/_meta.json`;
}

function dataPrefix(ns: string, session: string): string {
  return `${SESSION_PREFIX}/${ns}/${session}/parts`;
}
