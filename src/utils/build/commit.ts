/**
 * @fileoverview 取り込みセッションの確定を build に落とし込みます。
 *
 * ルート側は「セッションを閉じる」ことだけを知っていればよく、親の決定・差分化・チャネル切り替えの
 * 順序はここに閉じます。
 */

import type { Env } from '../minecraft';
import type { IngestBuildInfo } from '../ingest';
import { readChannels, registerVersion, setChannels } from './channels';
import { commitBuild, foldBuild, type FoldedBuild } from './manifest';
import { collectPatches, toBuildPatch } from './staging';
import { compareChannels } from './mc-version';

/** 確定結果。 */
export type CommitResult = {
  buildId: string;
  /** 内容が既存 build と同じで、マニフェストを書かずに済んだ場合に true。 */
  deduped: boolean;
  channels: string[];
  files: number;
  recipes: number;
};

/**
 * セッションにステージングされた内容を build として確定し、対象チャネルを切り替えます。
 * @param env 環境変数
 * @param ns ネームスペース
 * @param session セッションID
 * @param info セッション開始時に固定した build の素性
 * @returns 確定結果
 */
export async function finalizeBuild(
  env: Env,
  ns: string,
  session: string,
  info: IngestBuildInfo
): Promise<CommitResult> {
  const channels = await readChannels(env, ns);
  const parentId = pickParent(channels, info.mcChannels);
  const parent = parentId ? await foldBuild(env, ns, parentId) : null;

  const staged = await collectPatches(env, ns, session);
  const patch = toBuildPatch(staged, parent, info.full);

  const { buildId, deduped } = await commitBuild(env, ns, parentId, patch, {
    mcChannels: info.mcChannels,
    modVersion: info.modVersion,
    loader: info.loader,
    trust: info.trust,
    source: info.source,
  });

  if (info.modVersion) await registerVersion(env, ns, info.modVersion, buildId);
  await setChannels(env, ns, info.mcChannels, buildId);

  return {
    buildId,
    deduped,
    channels: info.mcChannels,
    files: Object.keys(staged.files).length,
    recipes: staged.recipes.length,
  };
}

/**
 * 差分の親にする build を選びます。
 *
 * 対象チャネルに既存 build があればそれを親にします（同じMC系の連続した版なので差分が最小になる）。
 * 複数チャネルを同時に更新する場合は最も新しいチャネルの build を選びます。どのチャネルにも
 * まだ build が無ければ全量マニフェストから始めます。
 * @param channels 現在のチャネル表
 * @param targets 今回更新するチャネル
 * @returns 親 build ID。無ければ null
 */
function pickParent(channels: Record<string, string>, targets: readonly string[]): string | null {
  const owned = targets.filter((c) => channels[c]).sort(compareChannels);
  if (owned.length > 0) return channels[owned[owned.length - 1]];

  const existing = Object.keys(channels).sort(compareChannels);
  return existing.length > 0 ? channels[existing[existing.length - 1]] : null;
}

/** 型の再輸出。ルート側が manifest の内部型を直接読み込まずに済ませるため。 */
export type { FoldedBuild };
