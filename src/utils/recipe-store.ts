/**
 * @fileoverview レシピデータのR2保存、D1キャッシュ破棄、およびインデックス（recipes.json）の管理を行うユーティリティ。
 */

import { Env, resultItemOf, isCraftingType } from './minecraft';
import { updateJson } from './r2-json';

const INDEX_KEY = 'index/recipes.json';

/** 公開インデックスのファイル形。`ids` は移行前の旧形式。 */
type IndexFile = { count?: number; generatedAt?: string; recipes?: IndexEntry[]; ids?: string[] };

/**
 * レシピJSONをR2に保存し、D1の古いキャッシュ行を破棄した上で、インデックスを更新します。
 * @param env 環境変数
 * @param namespace ネームスペース
 * @param id レシピID
 * @param body レシピJSON文字列
 * @param data レシピJSONデータ
 */
export async function storeRecipe(env: Env, namespace: string, id: string, body: string, data: any): Promise<void> {
  await putRecipeBody(env, namespace, id, body);
  await updateIndex(env, `${namespace}:${id}`, data);
}

/**
 * レシピの本体をR2に書き込み、D1の古いキャッシュ行を破棄します（インデックスは更新しません）。
 * @param env 環境変数
 * @param namespace ネームスペース
 * @param id レシピID
 * @param body レシピJSON文字列
 */
export async function putRecipeBody(env: Env, namespace: string, id: string, body: string): Promise<void> {
  await env.BUCKET.put(`data/${namespace}/recipe/${id}.json`, body, {
    httpMetadata: { contentType: 'application/json' },
  });
  await env.DB.prepare('DELETE FROM recipes WHERE id = ?').bind(`${namespace}:${id}`).run().catch(() => {});
}

/**
 * 1回の「読み取り-変更-書き込み」で、複数のレシピを index/recipes.json にインサートまたはアップデート（Upsert）します。
 * @param env 環境変数
 * @param entries アップサートするレシピのエントリ情報（IDとデータのペアの配列）
 */
export async function updateIndexMany(env: Env, entries: { fullId: string; data: any }[]): Promise<void> {
  const shaped: IndexEntry[] = [];
  for (const { fullId, data } of entries) {
    if (isCraftingType(data?.type)) shaped.push(indexEntryOf(fullId, data));
  }
  await upsertIndexEntries(env, entries.map((e) => e.fullId), shaped);
}

/** 公開インデックスに載る1レシピの形。 */
export type IndexEntry = { id: string; result: string | null; type: string };

/**
 * レシピデータから索引エントリを組み立てます。呼び出し側でクラフト系判定を済ませておくこと。
 * @param fullId 完全修飾レシピID
 * @param data レシピJSONデータ
 */
export function indexEntryOf(fullId: string, data: any): IndexEntry {
  return { id: fullId, result: resultItemOf(data), type: String(data.type).replace(/^minecraft:/, '') };
}

/**
 * 指定IDを差し替える形で、索引エントリ群を index/recipes.json にアップサートします（1回の read-modify-write）。
 * 取り込みセッションの commit と単発 bulk の両方から共有されます。
 * @param env 環境変数
 * @param removeIds いったん取り除く既存ID（再投入分。空可）
 * @param add 追加するエントリ（クラフト系のみを渡すこと）
 */
export async function upsertIndexEntries(env: Env, removeIds: string[], add: IndexEntry[]): Promise<void> {
  if (removeIds.length === 0 && add.length === 0) return;

  // 条件付き書き込みでやり直すため、複数の mod を同時に投入しても片方の追加分が消えません。
  await updateJson<IndexFile>(env, INDEX_KEY, (current) => {
    // 同一IDが `add` に複数入りうる（取り込みセッションで同じレシピを再送した場合など）。
    // 既存分の除去だけでは重複が残るため、ここで後勝ちに畳む。
    const deduped = new Map(add.map((entry) => [entry.id, entry]));

    const incoming = new Set(removeIds);
    const recipes = readEntries(current)
      .filter((r) => !incoming.has(r.id) && !deduped.has(r.id))
      .concat([...deduped.values()])
      .sort((a, b) => a.id.localeCompare(b.id));

    return { count: recipes.length, generatedAt: new Date().toISOString(), recipes };
  });
}

/**
 * 索引ファイルからエントリ配列を取り出します。旧 `ids` 形式も読めるようにしています。
 * @param file 読み出した索引ファイル（未作成なら null）
 */
function readEntries(file: IndexFile | null): IndexEntry[] {
  if (!file) return [];
  if (Array.isArray(file.recipes)) return file.recipes;
  if (Array.isArray(file.ids)) return file.ids.map((id) => ({ id, result: id, type: '' }));
  return [];
}

/**
 * 単一のレシピを index/recipes.json にインサートまたはアップデート（Upsert）します（CIビルドと同様に、クラフト関連のレシピのみを対象とします）。
 * @param env 環境変数
 * @param fullId 完全修飾レシピID
 * @param data レシピのJSONデータ
 */
export async function updateIndex(env: Env, fullId: string, data: any): Promise<void> {
  const add = isCraftingType(data?.type) ? [indexEntryOf(fullId, data)] : [];
  await upsertIndexEntries(env, [fullId], add);
}
