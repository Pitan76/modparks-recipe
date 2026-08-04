/**
 * @fileoverview 既存のフラットな `assets/<ns>/...` `data/<ns>/...` を build へ移行します。
 *
 * build が1つも無いネームスペースは解決できないため、読み取り経路を切り替える前に必ず通します。
 * 取り込みセッションをそのまま使い回すので、移行専用の確定処理は持ちません。
 *
 * オブジェクトを1件ずつ読んでハッシュする都合上、1リクエストで終わらせようとすると
 * CPU時間に引っかかります。カーソルを返して呼び出し側が刻めるようにしています。
 */

import type { Env } from '../minecraft';
import { contentTypeForKey } from '../http';
import { readIndexEntriesFor } from '../recipe-store';
import { PatchCollector, stagePatch } from './staging';

/** 移行1回分の結果。`cursor` が null なら走査完了。 */
export type MigrateStep = { processed: number; cursor: string | null };

/** R2上のプレフィックスと、build 内での論理パスの対応。 */
const MAPPINGS: { prefix: (ns: string) => string; logical: string }[] = [
  { prefix: (ns) => `assets/${ns}/textures/`, logical: 'textures' },
  { prefix: (ns) => `assets/${ns}/models/`, logical: 'models' },
  { prefix: (ns) => `assets/${ns}/lang/`, logical: 'lang' },
  { prefix: (ns) => `data/${ns}/recipe/`, logical: 'recipe' },
  { prefix: (ns) => `data/${ns}/tags/`, logical: 'tags' },
];

/**
 * 走査対象を1バッチ分だけ blob 化してステージングします。
 *
 * `cursor` は「何番目のマッピングの、どこまで進んだか」を1つの文字列に畳んだものです。
 * 呼び出し側は前回の戻り値をそのまま渡すだけで再開できます。
 * @param env 環境変数
 * @param ns ネームスペース
 * @param session 取り込みセッションID
 * @param cursor 前回の続き（初回は null）
 * @param limit 1回で処理するオブジェクト数
 * @returns 処理件数と次のカーソル
 */
export async function migrateStep(
  env: Env,
  ns: string,
  session: string,
  cursor: string | null,
  limit = 200
): Promise<MigrateStep> {
  const { index, inner } = parseCursor(cursor);
  if (index >= MAPPINGS.length) return { processed: 0, cursor: null };

  const mapping = MAPPINGS[index];
  const prefix = mapping.prefix(ns);
  const listed = await env.BUCKET.list({ prefix, cursor: inner ?? undefined, limit });

  const collector = new PatchCollector(env);
  for (const object of listed.objects) {
    await copyObject(env, collector, object.key, `${mapping.logical}/${object.key.slice(prefix.length)}`);
  }
  if (!collector.isEmpty) await stagePatch(env, ns, session, collector.toPatch());

  const next = listed.truncated ? formatCursor(index, listed.cursor) : formatCursor(index + 1, null);
  return { processed: listed.objects.length, cursor: index + 1 >= MAPPINGS.length && !listed.truncated ? null : next };
}

/**
 * 既存の公開索引から、移行対象ネームスペースのレシピエントリをステージングします。
 *
 * 走査の最後に1度だけ呼びます。レシピJSONを全件読み直して型を判定するより安いためです。
 * @param env 環境変数
 * @param ns ネームスペース
 * @param session 取り込みセッションID
 * @returns ステージングしたエントリ数
 */
export async function stageLegacyIndex(env: Env, ns: string, session: string): Promise<number> {
  const entries = await readIndexEntriesFor(env, ns);
  if (entries.length === 0) return 0;

  await stagePatch(env, ns, session, { files: {}, recipes: entries, removedRecipes: [] });
  return entries.length;
}

/**
 * R2上の1オブジェクトを blob へ写し、論理パスとして登録します。
 * @param env 環境変数
 * @param collector 収集先
 * @param key 元のR2キー
 * @param logicalPath build 内での論理パス
 */
async function copyObject(env: Env, collector: PatchCollector, key: string, logicalPath: string): Promise<void> {
  const object = await env.BUCKET.get(key);
  if (!object) return;

  const bytes = new Uint8Array(await object.arrayBuffer());
  await collector.addBinary(logicalPath, bytes, contentTypeForKey(key));
}

/**
 * カーソル文字列を分解します。
 * @param cursor `<マッピング番号>:<R2カーソル>` 形式（初回は null）
 */
function parseCursor(cursor: string | null): { index: number; inner: string | null } {
  if (!cursor) return { index: 0, inner: null };

  const sep = cursor.indexOf(':');
  if (sep < 0) return { index: 0, inner: null };

  const index = Number(cursor.slice(0, sep));
  const inner = cursor.slice(sep + 1);
  return { index: Number.isFinite(index) ? index : 0, inner: inner || null };
}

/**
 * カーソル文字列を組み立てます。
 * @param index マッピング番号
 * @param inner R2のカーソル
 */
function formatCursor(index: number, inner: string | null): string {
  return `${index}:${inner ?? ''}`;
}
