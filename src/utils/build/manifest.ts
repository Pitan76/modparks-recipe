/**
 * @fileoverview build マニフェストの読み書きと畳み込み。
 *
 * マニフェストは原則「親との差分」で持ちます。テクスチャが数千あるmodでは全量マニフェストが
 * 数百KBになり、レシピを1個直しただけの build でも同じだけ増えて blob 側の重複排除を打ち消すためです。
 * 差分の連鎖は深くなるほど読み取り回数が増えるので、既定の深さを超えたら全量へ戻します。
 */

import type { Env } from '../minecraft';
import type { IndexEntry } from '../recipe-store';
import { contentId } from './hash';

/** 論理パス（`textures/item/x.png` など）-> 内容ハッシュ。 */
export type FileMap = Record<string, string>;

/** build の出所と対象。内容ハッシュには含めません（同一内容を1本に畳むため）。 */
export type BuildMeta = {
  ns: string;
  mcChannels: string[];
  modVersion: string | null;
  loader: string | null;
  trust: 'verified' | 'unverified';
  source: string | null;
  committedAt: string;
};

/** R2 に保存される build マニフェスト。`parent` が無ければ全量。 */
export type BuildManifest = {
  meta: BuildMeta;
  parent?: string;
  /** 親からの差分の深さ。全量は 0。連鎖を辿らずに再スナップショットを判断するために持ちます。 */
  depth: number;
  files: FileMap;
  removedFiles?: string[];
  recipes: IndexEntry[];
  removedRecipes?: string[];
};

/** 畳み込み済みの build。画像描画と索引生成はこれだけを見ます。 */
export type FoldedBuild = { files: FileMap; recipes: IndexEntry[] };

/** 新しい build に載せる変更分。 */
export type BuildPatch = {
  changedFiles: FileMap;
  removedFiles?: string[];
  changedRecipes: IndexEntry[];
  removedRecipes?: string[];
};

/** 差分連鎖の最大の深さ。超えたら全量マニフェストを書き直します。 */
const MAX_DEPTH = 10;

/** 畳み込み結果のキャッシュ。buildId は内容そのものなので不変で、失効を考える必要がありません。 */
const foldCache = new Map<string, FoldedBuild>();

/** アイソレート内に置く畳み込み結果の上限。メモリを無制限に食わないための単純な上限です。 */
const FOLD_CACHE_MAX = 32;

/**
 * build マニフェストのR2キーを返します。
 * @param ns ネームスペース
 * @param buildId build ID
 */
export function buildKey(ns: string, buildId: string): string {
  return `builds/${ns}/${buildId}.json`;
}

/**
 * build マニフェストを1件読みます。
 * @param env 環境変数
 * @param ns ネームスペース
 * @param buildId build ID
 * @returns 見つからなければ null
 */
export async function readManifest(env: Env, ns: string, buildId: string): Promise<BuildManifest | null> {
  const obj = await env.BUCKET.get(buildKey(ns, buildId));
  if (!obj) return null;

  try {
    return await obj.json<BuildManifest>();
  } catch {
    return null;
  }
}

/**
 * 親を辿って build を畳み込みます。
 * @param env 環境変数
 * @param ns ネームスペース
 * @param buildId build ID
 * @returns 畳み込み結果。build が見つからなければ null
 * @throws 連鎖が壊れている（親が欠けている）場合
 */
export async function foldBuild(env: Env, ns: string, buildId: string): Promise<FoldedBuild | null> {
  const cacheKey = `${ns}/${buildId}`;
  const cached = foldCache.get(cacheKey);
  if (cached) return cached;

  const chain = await collectChain(env, ns, buildId);
  if (!chain) return null;

  const folded = applyChain(chain);
  rememberFold(cacheKey, folded);
  return folded;
}

/**
 * 新しい build を確定します。
 *
 * 畳み込み後の内容から build ID を作るため、mod のバージョンだけが違って中身が同じ jar は
 * 既存の build に吸収され、新しいマニフェストは書かれません。
 * @param env 環境変数
 * @param ns ネームスペース
 * @param parentId 親 build（初回は null）
 * @param patch 変更分
 * @param meta 出所と対象
 * @returns 確定した build ID と、既存に吸収されたかどうか
 */
export async function commitBuild(
  env: Env,
  ns: string,
  parentId: string | null,
  patch: BuildPatch,
  meta: Omit<BuildMeta, 'ns' | 'committedAt'>
): Promise<{ buildId: string; deduped: boolean }> {
  const parent = parentId ? await readManifest(env, ns, parentId) : null;
  if (parentId && !parent) throw new Error(`Parent build not found: ${ns}/${parentId}`);

  const base = parentId ? await foldBuild(env, ns, parentId) : { files: {}, recipes: [] };
  if (!base) throw new Error(`Parent build not foldable: ${ns}/${parentId}`);

  const folded = applyPatch(base, patch);
  const buildId = await contentId(folded);
  if (await env.BUCKET.head(buildKey(ns, buildId))) return { buildId, deduped: true };

  const depth = parent ? parent.depth + 1 : 0;
  const manifest = depth > MAX_DEPTH || !parentId
    ? snapshotManifest(ns, folded, meta)
    : deltaManifest(ns, parentId, depth, patch, meta);

  await env.BUCKET.put(buildKey(ns, buildId), JSON.stringify(manifest), {
    httpMetadata: { contentType: 'application/json' },
  });
  rememberFold(`${ns}/${buildId}`, folded);
  return { buildId, deduped: false };
}

/**
 * 畳み込み結果に変更分を適用します。
 * @param base 適用前の畳み込み結果
 * @param patch 変更分
 */
export function applyPatch(base: FoldedBuild, patch: BuildPatch): FoldedBuild {
  const files = { ...base.files, ...patch.changedFiles };
  for (const path of patch.removedFiles ?? []) delete files[path];

  const recipes = new Map(base.recipes.map((r) => [r.id, r]));
  for (const entry of patch.changedRecipes) recipes.set(entry.id, entry);
  for (const id of patch.removedRecipes ?? []) recipes.delete(id);

  return { files, recipes: [...recipes.values()] };
}

/**
 * 親方向に辿って、全量マニフェストを起点とする連鎖を古い順で返します。
 * @param env 環境変数
 * @param ns ネームスペース
 * @param buildId 起点の build ID
 * @returns 古い順の連鎖。起点が見つからなければ null
 * @throws 途中の親が欠けている場合
 */
async function collectChain(env: Env, ns: string, buildId: string): Promise<BuildManifest[] | null> {
  const chain: BuildManifest[] = [];
  let current: string | null = buildId;

  while (current) {
    const manifest: BuildManifest | null = await readManifest(env, ns, current);
    if (!manifest) {
      if (chain.length === 0) return null;
      throw new Error(`Broken build chain at ${ns}/${current}`);
    }
    chain.unshift(manifest);
    current = manifest.parent ?? null;
  }
  return chain;
}

/**
 * 古い順の連鎖を畳み込みます。
 * @param chain 全量マニフェストから始まる連鎖
 */
function applyChain(chain: BuildManifest[]): FoldedBuild {
  let folded: FoldedBuild = { files: {}, recipes: [] };
  for (const manifest of chain) {
    folded = applyPatch(folded, {
      changedFiles: manifest.files,
      removedFiles: manifest.removedFiles,
      changedRecipes: manifest.recipes,
      removedRecipes: manifest.removedRecipes,
    });
  }
  return folded;
}

/**
 * 全量マニフェストを組み立てます。
 * @param ns ネームスペース
 * @param folded 畳み込み済みの内容
 * @param meta 出所と対象
 */
function snapshotManifest(ns: string, folded: FoldedBuild, meta: Omit<BuildMeta, 'ns' | 'committedAt'>): BuildManifest {
  return { meta: fullMeta(ns, meta), depth: 0, files: folded.files, recipes: folded.recipes };
}

/**
 * 差分マニフェストを組み立てます。
 * @param ns ネームスペース
 * @param parentId 親 build ID
 * @param depth 親からの深さ
 * @param patch 変更分
 * @param meta 出所と対象
 */
function deltaManifest(
  ns: string,
  parentId: string,
  depth: number,
  patch: BuildPatch,
  meta: Omit<BuildMeta, 'ns' | 'committedAt'>
): BuildManifest {
  return {
    meta: fullMeta(ns, meta),
    parent: parentId,
    depth,
    files: patch.changedFiles,
    removedFiles: patch.removedFiles?.length ? patch.removedFiles : undefined,
    recipes: patch.changedRecipes,
    removedRecipes: patch.removedRecipes?.length ? patch.removedRecipes : undefined,
  };
}

/**
 * 保存用のメタ情報を組み立てます。
 * @param ns ネームスペース
 * @param meta 呼び出し側が持つメタ情報
 */
function fullMeta(ns: string, meta: Omit<BuildMeta, 'ns' | 'committedAt'>): BuildMeta {
  return { ...meta, ns, committedAt: new Date().toISOString() };
}

/**
 * 畳み込み結果をアイソレート内に覚えます。上限を超えたら最も古いものから捨てます。
 * @param key キャッシュキー
 * @param folded 畳み込み結果
 */
function rememberFold(key: string, folded: FoldedBuild): void {
  foldCache.set(key, folded);
  while (foldCache.size > FOLD_CACHE_MAX) {
    const oldest = foldCache.keys().next().value;
    if (oldest === undefined) return;
    foldCache.delete(oldest);
  }
}
