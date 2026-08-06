/**
 * @fileoverview タグを書き込みAPI経由で投入するクライアント。
 *
 * R2 へ直接書くと、build に移行済みのネームスペースでは読まれません。描画時のアセット読み出しは
 * build を持つ ns では manifest 経由になり、フラットなキーへ落ちないためです（`AssetSource`）。
 * 書き込みAPIを通せば、移行済みなら build に畳まれ、未移行ならフラットに置かれます。
 */

import dotenv from 'dotenv';
import { runPool } from '../utils/pool';

dotenv.config();

const API_URL = process.env.MP_RECIPE_URL?.replace(/\/$/, '');
const SECRET = process.env.UPLOAD_SECRET || process.env.ADMIN_SECRET;

/**
 * 1回の一括リクエストに含めるタグ数。
 *
 * 1件につきサーバ側で数回のストレージ操作が走るため、Worker のサブリクエスト上限に対して
 * 余裕を残せる大きさにしています。
 */
const BATCH_SIZE = 50;

/** 同時に送るリクエスト数。ステージング断片はリクエストごとに別キーなので並行して問題ありません。 */
const CONCURRENCY = 6;

/** 投入する1件。 */
export type TagEntry = { path: string; body: string };

/**
 * 投入先の説明を返します。
 */
export function describeTarget(): string {
  return API_URL ? `write API at ${API_URL}` : '(MP_RECIPE_URL 未設定)';
}

/**
 * 設定を検証します。
 * @returns 使えない場合は理由
 */
export function targetProblem(): string | null {
  if (!API_URL) return 'MP_RECIPE_URL is not set.';
  if (!SECRET) return 'UPLOAD_SECRET / ADMIN_SECRET is not set.';
  return null;
}

/** 認証ヘッダ付きでAPIを叩きます。 */
async function call(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}`, ...init?.headers },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * ネームスペースが解決に使っているMCチャネルを読みます。
 * @param ns ネームスペース
 * @returns チャネル一覧。build 未使用なら空
 */
async function fetchChannels(ns: string): Promise<string[]> {
  const body = await call(`/api/${ns}/list.json`);
  return Array.isArray(body?.channels) ? body.channels : [];
}

/**
 * タグをまとめて送ります。
 * @param ns ネームスペース
 * @param entries 投入するタグ
 * @param session 取り込みセッション（build を作る場合）
 */
async function pushBatches(ns: string, entries: TagEntry[], session: string | null): Promise<void> {
  const query = session ? `?session=${encodeURIComponent(session)}` : '';

  const batches: TagEntry[][] = [];
  for (let i = 0; i < entries.length; i += BATCH_SIZE) batches.push(entries.slice(i, i + BATCH_SIZE));

  let done = 0;
  await runPool(batches, CONCURRENCY, async (batch) => {
    const tags: Record<string, string> = {};
    for (const e of batch) tags[e.path] = e.body;
    await call(`/api/${ns}/bulk${query}`, { method: 'POST', body: JSON.stringify({ tags }) });
    done += batch.length;
    console.log(`  ${done}/${entries.length}`);
  });
}

/**
 * タグを投入します。
 *
 * 既存チャネルがあるネームスペースでは、そのチャネルに build を重ねます。`full` を立てないのは、
 * 親 build に含まれる mod 由来のタグを消さないためです（`toBuildPatch` は full のとき
 * ステージングに無い親のファイルを削除対象にします）。
 * @param ns ネームスペース
 * @param entries 投入するタグ
 */
export async function pushTags(ns: string, entries: TagEntry[]): Promise<void> {
  const channels = await fetchChannels(ns);
  if (channels.length === 0) {
    console.log(`  ${ns}: build 未使用。そのまま投入します。`);
    await pushBatches(ns, entries, null);
    return;
  }

  console.log(`  ${ns}: チャネル ${channels.join(', ')} に重ねます。`);
  const begun = await call(`/api/${ns}/ingest/begin`, {
    method: 'POST',
    body: JSON.stringify({ mcVersions: channels, full: false, source: 'fetch-common-tags' }),
  });
  const session: string = begun.session;

  try {
    await pushBatches(ns, entries, session);
  } catch (e) {
    await call(`/api/${ns}/ingest/abort?session=${encodeURIComponent(session)}`, { method: 'POST' }).catch(() => {});
    throw e;
  }

  const done = await call(`/api/${ns}/ingest/commit?session=${encodeURIComponent(session)}`, { method: 'POST' });
  console.log(`  ${ns}: build ${String(done.build?.buildId ?? '(なし)').slice(0, 12)} に確定しました。`);
}
