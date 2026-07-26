/**
 * @fileoverview Mojangのアセットインデックスから、バニラの言語ファイルを取得するモジュール。
 *
 * client.jar に同梱されているのは en_us のみで、それ以外の言語はアセットインデックス経由で
 * 配信されています。日本語のアイテム名はこの経路でしか取れません。
 */

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';
const RESOURCE_BASE = 'https://resources.download.minecraft.net';

/**
 * JSONを取得します。
 * @param url 取得先URL
 */
async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/**
 * 最新リリースのアセットインデックスURLを取得します。
 * @returns アセットインデックスのURLと、対応するバージョンID
 */
async function fetchAssetIndexUrl(): Promise<{ url: string; version: string }> {
  const manifest = await fetchJson<any>(MANIFEST_URL);
  const version = manifest.latest.release;

  const entry = manifest.versions.find((v: any) => v.id === version);
  if (!entry) throw new Error(`Could not find version ${version} in manifest`);

  const detail = await fetchJson<any>(entry.url);
  return { url: detail.assetIndex.url, version };
}

/**
 * バニラの言語ファイルをアセットインデックス経由で取得します。
 * インデックスに存在しないロケールは結果に含めません。
 * @param locales 取得したいロケール名の一覧
 * @returns ロケール名 -> 言語JSON文字列
 */
export async function fetchVanillaLangs(locales: string[]): Promise<Record<string, string>> {
  const { url, version } = await fetchAssetIndexUrl();
  console.log(`Using asset index of ${version}`);

  const index = await fetchJson<{ objects: Record<string, { hash: string }> }>(url);

  const result: Record<string, string> = {};
  await Promise.all(
    locales.map(async (locale) => {
      const object = index.objects[`minecraft/lang/${locale}.json`];
      if (!object) return;

      const res = await fetch(`${RESOURCE_BASE}/${object.hash.slice(0, 2)}/${object.hash}`);
      if (!res.ok) throw new Error(`Failed to fetch lang ${locale}: ${res.status}`);
      result[locale] = await res.text();
    })
  );
  return result;
}
