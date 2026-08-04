/**
 * @fileoverview 参照されなくなった build と blob の掃除。
 *
 * trust によって build を消すことはしません。対象は「どのチャネルからも別名表からも参照されなくなった」
 * ものだけです。modVersion の別名が残っている限り履歴は消えません。
 *
 * 差分マニフェストは親を辿って畳むため、**参照されている build の祖先も生存扱い**にする必要があります。
 * ここを落とすと、生きている build が畳めなくなって画像が出なくなります。
 */

import type { Env } from '../minecraft';
import { readChannels, readVersions } from './channels';
import { readManifest } from './manifest';

/** 掃除の結果。 */
export type SweepResult = { scanned: number; deleted: number };

/**
 * 取り込み中のオブジェクトを巻き込まないための猶予（ミリ秒）。
 *
 * blob は commit より前に書かれるため、猶予無しで掃除すると進行中の取り込みの材料を消せてしまいます。
 */
const GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * build が保持される最短期間（ミリ秒）。参照を失ってすぐ消さず、切り戻しの余地を残します。
 */
const BUILD_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** unverified なネームスペースが保持する modVersion 別名の上限。 */
export const UNVERIFIED_KEEP = 5;

/**
 * build を持つネームスペースを列挙します。
 * @param env 環境変数
 */
export async function listNamespaces(env: Env): Promise<string[]> {
  const out = new Set<string>();
  let cursor: string | undefined = undefined;
  do {
    const listed = await env.BUCKET.list({ prefix: 'builds/', delimiter: '/', cursor, limit: 1000 });
    for (const prefix of listed.delimitedPrefixes) {
      const ns = prefix.slice('builds/'.length).replace(/\/$/, '');
      if (ns) out.add(ns);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return [...out];
}

/**
 * ネームスペースで生存している build ID を集めます（祖先を含む）。
 * @param env 環境変数
 * @param ns ネームスペース
 * @returns 生存 build ID の集合
 */
export async function liveBuilds(env: Env, ns: string): Promise<Set<string>> {
  const roots = new Set<string>();
  for (const buildId of Object.values(await readChannels(env, ns))) roots.add(buildId);
  for (const entry of await readVersions(env, ns)) roots.add(entry.buildId);

  const live = new Set<string>();
  for (const root of roots) {
    await walkAncestors(env, ns, root, live);
  }
  return live;
}

/**
 * ネームスペースの、参照されていない build を削除します。
 * @param env 環境変数
 * @param ns ネームスペース
 * @returns 走査数と削除数
 */
export async function sweepBuilds(env: Env, ns: string): Promise<SweepResult> {
  const live = await liveBuilds(env, ns);
  const prefix = `builds/${ns}/`;

  let scanned = 0;
  let deleted = 0;
  let cursor: string | undefined = undefined;
  do {
    const listed = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
    const doomed: string[] = [];
    for (const object of listed.objects) {
      scanned++;
      const buildId = object.key.slice(prefix.length).replace(/\.json$/, '');
      if (live.has(buildId)) continue;
      if (Date.now() - object.uploaded.getTime() < BUILD_RETENTION_MS) continue;
      doomed.push(object.key);
    }
    if (doomed.length > 0) {
      await env.BUCKET.delete(doomed);
      deleted += doomed.length;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return { scanned, deleted };
}

/**
 * どの生存 build からも参照されていない blob を削除します。
 *
 * 全ネームスペースの生存 build を先に畳んでから走査します。1つでも取りこぼすと、生きている
 * マニフェストが指す実体を消してしまうためです。
 * @param env 環境変数
 * @returns 走査数と削除数
 */
export async function sweepBlobs(env: Env): Promise<SweepResult> {
  const referenced = await referencedHashes(env);

  let scanned = 0;
  let deleted = 0;
  let cursor: string | undefined = undefined;
  do {
    const listed = await env.BUCKET.list({ prefix: 'blobs/', cursor, limit: 1000 });
    const doomed: string[] = [];
    for (const object of listed.objects) {
      scanned++;
      const hash = object.key.slice('blobs/'.length);
      if (referenced.has(hash)) continue;
      // 取り込み中に書かれた直後の blob は、まだどの build からも参照されていない。
      if (Date.now() - object.uploaded.getTime() < GRACE_MS) continue;
      doomed.push(object.key);
    }
    if (doomed.length > 0) {
      await env.BUCKET.delete(doomed);
      deleted += doomed.length;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return { scanned, deleted };
}

/**
 * 生存している全 build が参照する内容ハッシュを集めます。
 * @param env 環境変数
 */
async function referencedHashes(env: Env): Promise<Set<string>> {
  const hashes = new Set<string>();
  for (const ns of await listNamespaces(env)) {
    for (const buildId of await liveBuilds(env, ns)) {
      const manifest = await readManifest(env, ns, buildId);
      if (!manifest) continue;
      for (const hash of Object.values(manifest.files)) hashes.add(hash);
    }
  }
  return hashes;
}

/**
 * build とその祖先を生存集合へ加えます。
 * @param env 環境変数
 * @param ns ネームスペース
 * @param buildId 起点の build ID
 * @param live 生存集合（破壊的に更新します）
 */
async function walkAncestors(env: Env, ns: string, buildId: string, live: Set<string>): Promise<void> {
  let current: string | null = buildId;
  while (current && !live.has(current)) {
    live.add(current);
    const manifest: Awaited<ReturnType<typeof readManifest>> = await readManifest(env, ns, current);
    current = manifest?.parent ?? null;
  }
}
