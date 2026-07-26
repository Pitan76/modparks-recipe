/**
 * @fileoverview アイテム名（言語ファイル）のR2保存と、アイテムIDから表示名への解決を行うユーティリティ。
 *
 * 言語ファイルは jar / リソースパック由来の素の Minecraft lang JSON をそのまま
 * `assets/<ns>/lang/<locale>.json` に置きます。加工しないのは、テクスチャやモデルと同じ
 * 「jar から抜いて置くだけ」の取り込み経路に乗せられるためです。
 *
 * 表示名の解決はテクスチャ解決と同じくネームスペース単位なので、キャッシュ無効化は
 * 既存の `bumpAssetVersion` にそのまま相乗りします。
 */

import type { Env } from './minecraft';
import { parseNamespacedId } from './minecraft';

/**
 * 取り込みスクリプトが既定で抜くロケール。
 * APIはこれ以外のロケールも受け付けるため、対応言語を増やすときはスクリプトの引数で指定すれば足ります。
 */
export const DEFAULT_LOCALES = ['ja_jp', 'en_us'];

/** ロケールごとの翻訳表（翻訳キー -> 表示名）。 */
export type LangMap = Record<string, string>;

/** Minecraftのロケール名の形。`lzh` のような地域なしや `pt_br` のような表記も通ります。 */
const LOCALE_PATTERN = /^[a-z]{2,8}(_[a-z0-9]{2,8})?$/;

/**
 * ロケール名がR2キーとして安全な形かどうかを判定します。
 * 対応言語を絞る意図はなく、パス区切りなど想定外の文字を弾くための検証です。
 * @param locale ロケール名（例: "ja_jp"）
 */
export function isValidLocale(locale: string): boolean {
  return LOCALE_PATTERN.test(locale);
}

/**
 * 言語ファイルのR2オブジェクトキーを組み立てます。
 * @param namespace ネームスペース
 * @param locale ロケール名
 */
export function langKey(namespace: string, locale: string): string {
  return `assets/${namespace}/lang/${locale}.json`;
}

/**
 * 言語ファイルの本文が「翻訳キー -> 表示名」のJSONオブジェクトかどうかを検証します。
 * @param body 言語JSON文字列
 * @returns 妥当なら true
 */
export function isValidLangBody(body: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed);
}

/**
 * 言語ファイルをR2に保存します。本文の検証は呼び出し側で `isValidLangBody` により済ませてください。
 * @param env 環境変数
 * @param namespace ネームスペース
 * @param locale ロケール名
 * @param body 言語JSON文字列
 */
export async function putLang(env: Env, namespace: string, locale: string, body: string): Promise<void> {
  await env.BUCKET.put(langKey(namespace, locale), body, {
    httpMetadata: { contentType: 'application/json' },
  });
}

/**
 * 言語ファイルをR2から読み出します。
 * @param env 環境変数
 * @param namespace ネームスペース
 * @param locale ロケール名
 * @returns 翻訳表。未登録なら null
 */
export async function readLang(env: Env, namespace: string, locale: string): Promise<LangMap | null> {
  const obj = await env.BUCKET.get(langKey(namespace, locale));
  if (!obj) return null;

  try {
    return await obj.json<LangMap>();
  } catch {
    // 壊れたオブジェクトは未登録と同じ扱いにする。次の取り込みで置き換わる。
    return null;
  }
}

/**
 * アイテムIDに対応しうる翻訳キーを、優先度順に返します。
 * Minecraftはアイテムとブロックで接頭辞が分かれており、IDだけではどちらか分からないため両方試します。
 * @param namespace ネームスペース
 * @param path ネームスペースを除いたID
 */
function translationKeysOf(namespace: string, path: string): string[] {
  const flat = path.replace(/\//g, '.');
  return [`item.${namespace}.${flat}`, `block.${namespace}.${flat}`];
}

/**
 * 翻訳表からアイテムIDの表示名を引きます。
 * @param lang 翻訳表
 * @param namespace ネームスペース
 * @param path ネームスペースを除いたID
 * @returns 表示名。見つからなければ null
 */
export function lookupName(lang: LangMap, namespace: string, path: string): string | null {
  for (const key of translationKeysOf(namespace, path)) {
    const name = lang[key];
    if (typeof name === 'string') return name;
  }
  return null;
}

/**
 * 複数のアイテムIDをまとめて表示名に解決します。
 * IDをネームスペースごとに束ねることで、言語ファイルの読み出しをネームスペース数に抑えます。
 *
 * 未翻訳のIDは結果に含めません。ロケール間のフォールバックは行わないため、
 * 呼び出し側は欠けたIDを自身の方針で扱えます。
 * @param env 環境変数
 * @param ids アイテムID一覧（例: ["minecraft:stone", "mymod:gadget"]）
 * @param locale ロケール名
 * @returns アイテムID -> 表示名
 */
export async function resolveNames(env: Env, ids: string[], locale: string): Promise<Record<string, string>> {
  const byNamespace = new Map<string, { id: string; path: string }[]>();
  for (const id of ids) {
    const { namespace, path } = parseNamespacedId(id);
    const bucket = byNamespace.get(namespace);
    if (bucket) bucket.push({ id, path });
    else byNamespace.set(namespace, [{ id, path }]);
  }

  const names: Record<string, string> = {};
  await Promise.all(
    Array.from(byNamespace, async ([namespace, entries]) => {
      const lang = await readLang(env, namespace, locale);
      if (!lang) return;
      for (const { id, path } of entries) {
        const name = lookupName(lang, namespace, path);
        if (name) names[id] = name;
      }
    })
  );
  return names;
}
