/**
 * @fileoverview 取り込みセッション中に、送られてきたアセットを blob 化して build の材料をステージングします。
 *
 * bulk は1 mod あたり10〜30回に分割されて届くため、各回の結果をユニークキーへ積み、commit で畳みます
 * （read-modify-write が無いのでロック不要）。ここで扱うのは「論理パス -> 内容ハッシュ」だけで、
 * 実体は blob 側に入るため、分割数が増えてもステージングは軽いままです。
 */

import type { Env } from '../minecraft';
import type { IndexEntry } from '../recipe-store';
import { putBlob, putBlobText } from './blob';
import type { BuildPatch, FileMap, FoldedBuild } from './manifest';

/** 1回の bulk 分のステージング内容。 */
export type StagedPatch = { files: FileMap; recipes: IndexEntry[]; removedRecipes: string[] };

const PARTS_SUFFIX = 'bparts';

/**
 * 送られてきたアセットを blob へ書き、論理パスと索引エントリを集めます。
 *
 * ルート側は種類ごとの検証を済ませてから `addFile` / `addRecipe` を呼ぶだけでよく、
 * blob 化の詳細を持ち込まずに済みます。
 */
export class PatchCollector {
  private readonly files: FileMap = {};
  private readonly recipes: IndexEntry[] = [];
  private readonly removedRecipes: string[] = [];

  constructor(private readonly env: Env) {}

  /**
   * バイナリのアセット（テクスチャ等）を追加します。
   * @param path 論理パス（例: `textures/item/foo.png`）
   * @param bytes 実体
   * @param contentType 保存時に付ける Content-Type
   */
  async addBinary(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.files[path] = await putBlob(this.env, bytes, contentType);
  }

  /**
   * テキストのアセット（JSON等）を追加します。
   * @param path 論理パス（例: `models/item/foo.json`）
   * @param text 実体
   * @param contentType 保存時に付ける Content-Type
   */
  async addText(path: string, text: string, contentType = 'application/json'): Promise<void> {
    this.files[path] = await putBlobText(this.env, text, contentType);
  }

  /**
   * レシピの索引エントリを追加します。
   *
   * `entry` が null なのは「投入されたが索引には載らない」レシピ（クラフト系以外）です。
   * IDだけは残しておかないと、クラフト系から他の型へ差し替えられたときに古い索引を消せません。
   * @param fullId 完全修飾レシピID
   * @param entry 索引エントリ。索引に載せない場合は null
   */
  addRecipe(fullId: string, entry: IndexEntry | null): void {
    if (entry) this.recipes.push(entry);
    else this.removedRecipes.push(fullId);
  }

  /** 収集結果を取り出します。 */
  toPatch(): StagedPatch {
    return { files: this.files, recipes: this.recipes, removedRecipes: this.removedRecipes };
  }

  /** 収集したものが何も無ければ true。 */
  get isEmpty(): boolean {
    return Object.keys(this.files).length === 0 && this.recipes.length === 0 && this.removedRecipes.length === 0;
  }
}

/**
 * 1回分のステージングを保存します。ユニークキーへ書くため read-modify-write は不要です。
 * @param env 環境変数
 * @param ns ネームスペース
 * @param session セッションID
 * @param patch ステージング内容
 */
export async function stagePatch(env: Env, ns: string, session: string, patch: StagedPatch): Promise<void> {
  await env.BUCKET.put(`${partsPrefix(ns, session)}/${crypto.randomUUID()}.json`, JSON.stringify(patch), {
    httpMetadata: { contentType: 'application/json' },
  });
}

/**
 * セッションにステージングされた全断片を1つに畳みます。
 * @param env 環境変数
 * @param ns ネームスペース
 * @param session セッションID
 */
export async function collectPatches(env: Env, ns: string, session: string): Promise<StagedPatch> {
  const merged: StagedPatch = { files: {}, recipes: [], removedRecipes: [] };
  const prefix = `${partsPrefix(ns, session)}/`;

  let cursor: string | undefined = undefined;
  do {
    const listed = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
    for (const o of listed.objects) {
      const part = await readPart(env, o.key);
      if (!part) continue;
      Object.assign(merged.files, part.files);
      merged.recipes.push(...part.recipes);
      merged.removedRecipes.push(...part.removedRecipes);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return merged;
}

/**
 * ステージング結果を、親 build に対する差分へ変換します。
 *
 * jar 1本を丸ごと入れる取り込み（`full`）では、親にあって今回来なかったものは
 * 「その版で削除された」ことを意味します。単発の書き込み（`partial`）では追加・更新しか起きません。
 *
 * ただし「1件も来なかった」場合だけは、削除だと読み取りません。取り込みが途中でこけたのか、
 * 本当に空の版なのかを区別できないためです。実際、レシピが1件も抽出されなかった jar 取り込みが、
 * 親の31件すべてを削除扱いにして丸ごと見えなくしたことがあります。全消しは取り返しがつかない一方、
 * 消し損ねは次の取り込みで直せるので、疑わしいときは残す側に倒します。
 * @param staged ステージング結果
 * @param parent 親 build の畳み込み結果（初回は null）
 * @param full jar 全体の取り込みかどうか
 */
export function toBuildPatch(staged: StagedPatch, parent: FoldedBuild | null, full: boolean): BuildPatch {
  const removedRecipes = [...staged.removedRecipes];
  const patch: BuildPatch = { changedFiles: staged.files, changedRecipes: staged.recipes, removedRecipes };
  if (!full || !parent) return patch;

  // 空の取り込みからは何も読み取れません。種別ごとに独立して判断します（レシピだけ落ちて
  // アセットは揃っている、という今回のような偏った失敗があるためです）。
  if (Object.keys(staged.files).length > 0) {
    patch.removedFiles = Object.keys(parent.files).filter((p) => !(p in staged.files));
  }
  if (staged.recipes.length === 0) return patch;

  const present = new Set(staged.recipes.map((r) => r.id));
  for (const entry of parent.recipes) {
    if (!present.has(entry.id)) removedRecipes.push(entry.id);
  }
  return patch;
}

/**
 * 全量の取り込みなのに中身が欠けていて、削除の判断を見送った種別を返します。
 *
 * 取り込んだ側に黙って握りつぶさず伝えるためのものです。「更新したのに古いレシピが残っている」
 * という状態は、理由が分からないまま放置されると次の不具合の温床になります。
 * @param staged ステージング結果
 * @param parent 親 build の畳み込み結果
 * @param full jar 全体の取り込みかどうか
 */
export function incompleteKinds(staged: StagedPatch, parent: FoldedBuild | null, full: boolean): string[] {
  if (!full || !parent) return [];

  const kinds: string[] = [];
  if (Object.keys(staged.files).length === 0 && Object.keys(parent.files).length > 0) kinds.push('files');
  if (staged.recipes.length === 0 && parent.recipes.length > 0) kinds.push('recipes');
  return kinds;
}

/**
 * ステージング断片を読みます。壊れていれば無視します。
 * @param env 環境変数
 * @param key R2オブジェクトキー
 */
async function readPart(env: Env, key: string): Promise<StagedPatch | null> {
  const obj = await env.BUCKET.get(key);
  if (!obj) return null;

  try {
    const part = await obj.json<StagedPatch>();
    if (!part?.files) return null;
    return { files: part.files, recipes: part.recipes ?? [], removedRecipes: part.removedRecipes ?? [] };
  } catch {
    return null;
  }
}

/** ステージング断片を置くプレフィックス。セッション配下なので cleanup で一緒に消えます。 */
function partsPrefix(ns: string, session: string): string {
  return `meta/ingest/${ns}/${session}/${PARTS_SUFFIX}`;
}
