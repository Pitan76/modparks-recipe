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
import type { IndexEntry } from './recipe-store';

/**
 * ステージングされる1レシピ。
 *
 * `entry` が null なのは「投入されたが索引には載らない」レシピ（クラフト系以外）です。
 * IDだけは残しておかないと、クラフト系から他の型へ差し替えられたときに
 * 古い索引エントリを消せません。
 */
export type StagedEntry = { id: string; entry: IndexEntry | null };

const SESSION_PREFIX = 'meta/ingest';

/**
 * このセッションが確定する build の素性。
 *
 * commit 時に決めるのでは遅すぎます。どの build を作るかは投入側しか知らず、
 * 分割送信の途中でそれが変わることは無いため、セッション開始時に固定します。
 */
export type IngestBuildInfo = {
  mcChannels: string[];
  modVersion: string | null;
  loader: string | null;
  trust: 'verified' | 'unverified';
  source: string | null;
  /** jar 1本を丸ごと入れる取り込みなら true。親にあって今回来なかったものを削除として扱います。 */
  full: boolean;
};

/** セッションのメタ情報（存在確認と失効判定に使う）。 */
export type SessionMeta = { session: string; ns: string; startedAt: string; build?: IngestBuildInfo };

/** セッションが有効とみなされる最大経過時間（ミリ秒）。クラッシュしたセッションを放置しないため。 */
const SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * 新しい取り込みセッションを開始します。
 * @param env 環境変数
 * @param ns ネームスペース
 * @param build 確定する build の素性（省略時は build を作らない旧来の取り込み）
 * @returns 生成されたセッションID
 */
export async function beginIngest(env: Env, ns: string, build?: IngestBuildInfo): Promise<string> {
  const session = crypto.randomUUID();
  const meta: SessionMeta = { session, ns, startedAt: new Date().toISOString(), build };
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
  return (await readIngestMeta(env, ns, session)) !== null;
}

/**
 * 有効なセッションのメタ情報を読みます。失効・不在・破損はすべて null になります。
 * @param env 環境変数
 * @param ns ネームスペース
 * @param session セッションID
 */
export async function readIngestMeta(env: Env, ns: string, session: string): Promise<SessionMeta | null> {
  const obj = await env.BUCKET.get(metaKey(ns, session));
  if (!obj) return null;

  try {
    const meta = await obj.json<SessionMeta>();
    if (Date.now() - new Date(meta.startedAt).getTime() >= SESSION_TTL_MS) return null;
    return meta;
  } catch {
    return null;
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
  // 索引エントリと build 材料でプレフィックスが分かれているため、セッション配下をまとめて消します。
  const prefix = `${SESSION_PREFIX}/${ns}/${session}/`;
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
