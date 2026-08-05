/**
 * @fileoverview 投入履歴の記録と照会。
 *
 * 所有権テーブルは現在の持ち主しか持たないため、乗っ取り・放棄のあとでは
 * 問題のあるデータを入れた主体が辿れません。投入のたびに1行残します。
 */

import type { Env } from './minecraft';

/** 投入経路。`jar` はポータル、`bulk` は一括API、`commit` は取り込みセッションの確定。 */
export type UploadSource = 'jar' | 'bulk' | 'commit';

/** 記録する1件の投入。 */
export type UploadEvent = {
  /** 投入した主体。共有シークレット経由（ModParks 側の取り込み）では null */
  identityId: string | null;
  ns: string;
  source: UploadSource;
  /** 投入された要素数。レシピ・テクスチャなどの合計 */
  items: number;
  buildId?: string | null;
};

/** 照会結果の1行。 */
export type UploadRecord = UploadEvent & { id: number; displayName: string | null; createdAt: string };

/**
 * 投入を1件記録します。
 * @param env 環境変数
 * @param event 記録する投入
 */
export async function recordUpload(env: Env, event: UploadEvent): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO upload_events (identity_id, ns, source, items, build_id) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(event.identityId, event.ns, event.source, event.items, event.buildId ?? null)
    .run();
}

/** 照会の絞り込み条件。 */
export type UploadQuery = { ns?: string; identityId?: string; limit: number };

/**
 * 投入履歴を新しい順に返します。
 * @param env 環境変数
 * @param query 絞り込み条件
 */
export async function listUploads(env: Env, query: UploadQuery): Promise<UploadRecord[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (query.ns) { where.push('e.ns = ?'); binds.push(query.ns); }
  if (query.identityId) { where.push('e.identity_id = ?'); binds.push(query.identityId); }

  const sql =
    `SELECT e.id, e.identity_id, e.ns, e.source, e.items, e.build_id, e.created_at, i.display_name
     FROM upload_events e LEFT JOIN identities i ON i.id = e.identity_id
     ${where.length > 0 ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY e.id DESC LIMIT ?`;

  const { results } = await env.DB.prepare(sql).bind(...binds, query.limit).all<Row>();
  return (results ?? []).map(toRecord);
}

/** D1 から返る生の行。 */
type Row = {
  id: number;
  identity_id: string | null;
  ns: string;
  source: string;
  items: number;
  build_id: string | null;
  created_at: string;
  display_name: string | null;
};

/**
 * D1 の行を照会結果に変換します。
 * @param row 生の行
 */
function toRecord(row: Row): UploadRecord {
  return {
    id: row.id,
    identityId: row.identity_id,
    ns: row.ns,
    source: row.source as UploadSource,
    items: row.items,
    buildId: row.build_id,
    createdAt: row.created_at,
    displayName: row.display_name,
  };
}
