/**
 * @fileoverview チャネル（MCメジャー系 -> build）、modVersion の別名表、および解決スナップショット。
 *
 * 画像1枚は複数のネームスペースの build に依存します（modのレシピが `minecraft:` を参照するため）。
 * よってキャッシュキーになれるのは build ID 単体ではなく、MCチャネルごとの解決結果全体です。
 * その解決結果に `rid` を振り、クライアントは画像URLの `?v=` にそれを載せます。
 */

import type { Env } from '../minecraft';
import { updateJson } from '../r2-json';
import { syncContentId } from './hash';
import { resolveChannel } from './mc-version';

/** MCチャネル -> build ID。 */
export type ChannelMap = Record<string, string>;

/** 1つの mod バージョンと、それが指す build。 */
export type VersionEntry = { modVersion: string; buildId: string; at: string };

/**
 * modVersion の別名表。
 *
 * 連想配列ではなく配列なのは、保持数の上限（unverified は直近5版）を適用するのに
 * 登録順が要るためです。同じ build を複数の版が指しうります（内容が同じなら1本に畳まれるため）。
 */
export type VersionList = { entries: VersionEntry[] };

/** あるMCチャネルにおける、全ネームスペースの解決結果。 */
export type ResolveSnapshot = { rid: string; builds: Record<string, string> };

/**
 * ネームスペースのチャネル表を読みます。
 * @param env 環境変数
 * @param ns ネームスペース
 */
export async function readChannels(env: Env, ns: string): Promise<ChannelMap> {
  return readJson<ChannelMap>(env, channelsKey(ns));
}

/**
 * ネームスペースの modVersion 別名表を読みます。
 * @param env 環境変数
 * @param ns ネームスペース
 */
export async function readVersions(env: Env, ns: string): Promise<VersionEntry[]> {
  const stored = await readJson<VersionList>(env, versionsKey(ns));
  return Array.isArray(stored.entries) ? stored.entries : [];
}

/**
 * modVersion から build への別名を登録します。
 * @param env 環境変数
 * @param ns ネームスペース
 * @param modVersion mod のバージョン文字列
 * @param buildId build ID
 */
export async function registerVersion(env: Env, ns: string, modVersion: string, buildId: string): Promise<void> {
  await updateJson<VersionList>(env, versionsKey(ns), (current) => {
    const entries = (current?.entries ?? []).filter((e) => e.modVersion !== modVersion);
    entries.push({ modVersion, buildId, at: new Date().toISOString() });
    return { entries };
  });
}

/**
 * 別名表を直近 `keep` 件へ切り詰めます。
 *
 * 溢れた別名を落とすと、その build がどこからも参照されなくなり GC の対象になります。
 * build を直接消すのではなく参照を外すだけなので、チャネルが指している版は絶対に消えません。
 * @param env 環境変数
 * @param ns ネームスペース
 * @param keep 残す件数
 * @returns 落とした件数
 */
export async function pruneVersions(env: Env, ns: string, keep: number): Promise<number> {
  let dropped = 0;
  await updateJson<VersionList>(env, versionsKey(ns), (current) => {
    const entries = current?.entries ?? [];
    dropped = Math.max(0, entries.length - keep);
    return { entries: dropped > 0 ? entries.slice(entries.length - keep) : entries };
  });
  return dropped;
}

/**
 * 指定チャネル群の指す先を build へ切り替え、解決スナップショットを更新します。
 * @param env 環境変数
 * @param ns ネームスペース
 * @param channels 対象のMCチャネル
 * @param buildId 切り替え先の build ID
 */
export async function setChannels(env: Env, ns: string, channels: readonly string[], buildId: string): Promise<void> {
  if (channels.length === 0) return;

  await updateJson<ChannelMap>(env, channelsKey(ns), (current) => {
    const next = { ...(current ?? {}) };
    for (const channel of channels) next[channel] = buildId;
    return next;
  });

  for (const channel of channels) {
    await touchSnapshot(env, channel, ns, buildId);
  }
}

/**
 * 要求されたMCチャネルを、そのネームスペースに存在する build へ解決します。
 * @param env 環境変数
 * @param ns ネームスペース
 * @param wanted 要求チャネル（未指定なら最新）
 * @returns 解決結果。候補が無ければ null
 */
export async function resolveBuild(
  env: Env,
  ns: string,
  wanted: string | null
): Promise<{ channel: string; buildId: string } | null> {
  const channels = await readChannels(env, ns);
  const channel = resolveChannel(wanted, Object.keys(channels));
  if (!channel) return null;
  return { channel, buildId: channels[channel] };
}

/**
 * MCチャネルの解決スナップショットを読みます。
 * @param env 環境変数
 * @param channel MCチャネル
 */
export async function readSnapshot(env: Env, channel: string): Promise<ResolveSnapshot> {
  const stored = await readJson<ResolveSnapshot>(env, snapshotKey(channel));
  if (stored.rid && stored.builds) return stored;
  return { rid: '0', builds: {} };
}

/**
 * 解決スナップショットに1ネームスペース分を反映し、`rid` を振り直します。
 * @param env 環境変数
 * @param channel MCチャネル
 * @param ns ネームスペース
 * @param buildId build ID
 */
async function touchSnapshot(env: Env, channel: string, ns: string, buildId: string): Promise<void> {
  await updateJson<ResolveSnapshot>(env, snapshotKey(channel), (current) => {
    const builds = { ...(current?.builds ?? {}), [ns]: buildId };
    return { rid: syncContentId(builds), builds };
  });
}

/**
 * R2上のJSONを読みます。未作成や破損は空オブジェクトとして扱います。
 * @param env 環境変数
 * @param key R2オブジェクトキー
 */
async function readJson<T extends object>(env: Env, key: string): Promise<T> {
  const obj = await env.BUCKET.get(key);
  if (!obj) return {} as T;

  try {
    const parsed = await obj.json<T>();
    return parsed && typeof parsed === 'object' ? parsed : ({} as T);
  } catch {
    return {} as T;
  }
}

/** チャネル表のR2キー。 */
function channelsKey(ns: string): string {
  return `meta/${ns}/channels.json`;
}

/** 別名表のR2キー。 */
function versionsKey(ns: string): string {
  return `meta/${ns}/versions.json`;
}

/** 解決スナップショットのR2キー。 */
function snapshotKey(channel: string): string {
  return `meta/resolve/${channel}.json`;
}
