/**
 * @fileoverview レシピデータのR2保存、D1キャッシュ破棄、およびインデックス（recipes.json）の管理を行うユーティリティ。
 */

import { Env, resultItemOf, isCraftingType } from './minecraft';

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

  const obj = await env.BUCKET.get('index/recipes.json');
  const idx: any = obj ? await obj.json() : {};
  let recipes: IndexEntry[] = Array.isArray(idx.recipes)
    ? idx.recipes
    : Array.isArray(idx.ids)
      ? idx.ids.map((i: string) => ({ id: i, result: i, type: '' }))
      : [];

  const incoming = new Set(removeIds);
  recipes = recipes.filter((r) => !incoming.has(r.id));
  recipes.push(...add);
  recipes.sort((a, b) => a.id.localeCompare(b.id));

  await env.BUCKET.put(
    'index/recipes.json',
    JSON.stringify({ count: recipes.length, generatedAt: new Date().toISOString(), recipes }),
    { httpMetadata: { contentType: 'application/json' } }
  );
}

/**
 * 単一のレシピを index/recipes.json にインサートまたはアップデート（Upsert）します（CIビルドと同様に、クラフト関連のレシピのみを対象とします）。
 * @param env 環境変数
 * @param fullId 完全修飾レシピID
 * @param data レシピのJSONデータ
 */
export async function updateIndex(env: Env, fullId: string, data: any): Promise<void> {
  const obj = await env.BUCKET.get('index/recipes.json');
  const idx: any = obj ? await obj.json() : {};
  let recipes: any[] = Array.isArray(idx.recipes)
    ? idx.recipes
    : Array.isArray(idx.ids)
      ? idx.ids.map((i: string) => ({ id: i, result: i }))
      : [];
  recipes = recipes.filter((r) => r.id !== fullId);
  if (isCraftingType(data?.type)) {
    recipes.push({ id: fullId, result: resultItemOf(data), type: String(data.type).replace(/^minecraft:/, '') });
  }
  recipes.sort((a, b) => a.id.localeCompare(b.id));
  await env.BUCKET.put(
    'index/recipes.json',
    JSON.stringify({ count: recipes.length, generatedAt: new Date().toISOString(), recipes }),
    { httpMetadata: { contentType: 'application/json' } }
  );
}
