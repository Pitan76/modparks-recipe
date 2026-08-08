/**
 * @fileoverview 1ネームスペース分のレシピを丸ごと取り下げます。
 *
 * 共有ネームスペースへ誤って流し込まれたレシピを消すためのものです。実体を残したまま索引だけ
 * 削ると `/admin/reindex` が拾い直して復活するため、R2の本体・D1のキャッシュ・公開索引の
 * 3つを同時に落とします。
 *
 * タグやテクスチャ、モデル、言語ファイルには触れません。共有ネームスペースのそれらは
 * 他のmodのレシピを描くのに要るためです。
 */

import type { Env } from './minecraft';
import { readIndexEntriesFor, upsertIndexEntries } from './recipe-store';

/** R2 の delete は1回1000キーまで。 */
const DELETE_BATCH = 1000;

/** 取り下げの結果。空打ちのときは「消す予定の件数」です。 */
export interface PurgeRecipesResult {
  namespace: string;
  /** R2 にあるレシピ本体の数 */
  objects: number;
  /** 公開索引に載っているエントリの数 */
  indexEntries: number;
  /** 実際に消したかどうか */
  deleted: boolean;
}

/**
 * ネームスペース配下のレシピを取り下げます。
 * @param env 環境変数
 * @param namespace 対象ネームスペース
 * @param deleteForReal 実際に消すなら true。false なら数えるだけ
 */
export async function purgeNamespaceRecipes(
  env: Env,
  namespace: string,
  deleteForReal: boolean
): Promise<PurgeRecipesResult> {
  const keys = await listRecipeKeys(env, namespace);
  const indexIds = (await readIndexEntriesFor(env, namespace)).map((e) => e.id);

  const result: PurgeRecipesResult = {
    namespace,
    objects: keys.length,
    indexEntries: indexIds.length,
    deleted: deleteForReal,
  };
  if (!deleteForReal) return result;

  for (let i = 0; i < keys.length; i += DELETE_BATCH) {
    await env.BUCKET.delete(keys.slice(i, i + DELETE_BATCH));
  }

  // 索引に残っていて実体が無いもの、実体はあって索引に無いものの両方がありうるので、
  // 消す対象は和集合で取る。
  const ids = new Set([...indexIds, ...keys.map((key) => idOfKey(namespace, key))]);
  await upsertIndexEntries(env, [...ids], []);
  await env.DB.prepare('DELETE FROM recipes WHERE id LIKE ?').bind(`${namespace}:%`).run().catch(() => {});

  return result;
}

/**
 * ネームスペース配下のレシピ本体のキーを全件集めます。
 * @param env 環境変数
 * @param namespace 対象ネームスペース
 */
async function listRecipeKeys(env: Env, namespace: string): Promise<string[]> {
  const prefix = `data/${namespace}/recipe/`;
  const keys: string[] = [];

  let cursor: string | undefined = undefined;
  do {
    const listed = await env.BUCKET.list({ prefix, cursor });
    for (const obj of listed.objects) keys.push(obj.key);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return keys;
}

/**
 * R2のキーを完全修飾レシピIDに戻します。
 * @param namespace ネームスペース
 * @param key R2のキー
 */
function idOfKey(namespace: string, key: string): string {
  const rel = key.slice(`data/${namespace}/recipe/`.length).replace(/\.json$/, '');
  return `${namespace}:${rel}`;
}
