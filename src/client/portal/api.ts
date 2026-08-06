/**
 * @fileoverview 投稿ポータルが叩くAPIと、jar の取り込み。
 *
 * jar の展開はページに読み込まれた `jszip` と `/extractor.js` に依存します。
 * どちらもグローバルに生えるため、ここで型だけ宣言します。
 */

import type { Messages } from '../../utils/i18n/portal';

/** ログイン中の利用者。 */
export type Me = { displayName: string; remaining: number };

/** ログイン手段。 */
export type Provider = { id: string; name: string };

/** 投入結果。 */
export type UploadSummary = { count: number; namespaces: string[] };

/** 投入履歴の1件。 */
export type UploadRecord = {
  id: number;
  ns: string;
  source: string;
  items: number;
  createdAt: string;
};

/** namespace の所有状況。 */
export type Owner = { claimed?: boolean; trust?: string };

declare const JSZip: { loadAsync(data: ArrayBuffer): Promise<unknown> };
declare function analyzeJar(zip: unknown): Promise<{ namespaces: string[]; byNs: Record<string, unknown> }>;

/**
 * 認証ヘッダを組み立てます。
 * @param token 投稿者のトークン
 */
function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** ログイン手段の一覧を取得します。 */
export async function fetchProviders(): Promise<Provider[]> {
  const res = await fetch('/auth/providers.json');
  if (!res.ok) return [];
  const body = (await res.json()) as { providers?: Provider[] };
  return body.providers ?? [];
}

/**
 * ログイン中の利用者を取得します。
 * @param token 投稿者のトークン
 */
export async function fetchMe(token: string): Promise<Me> {
  const res = await fetch('/auth/me', { headers: auth(token) });
  if (!res.ok) throw new Error('unauthenticated');
  return (await res.json()) as Me;
}

/**
 * 本人の投入履歴を取得します。
 * @param token 投稿者のトークン
 */
export async function fetchHistory(token: string): Promise<UploadRecord[]> {
  const res = await fetch('/auth/me/uploads', { headers: auth(token) });
  if (!res.ok) return [];
  const body = (await res.json()) as { uploads?: UploadRecord[] };
  return body.uploads ?? [];
}

/**
 * namespace の所有状況を取得します。
 * @param ns ネームスペース
 */
export async function fetchOwner(ns: string): Promise<Owner> {
  const res = await fetch(`/api/${ns}/owner.json`);
  if (!res.ok) return {};
  return (await res.json()) as Owner;
}

/**
 * namespace の所有権を主張します。
 * @param ns ネームスペース
 * @param token 投稿者のトークン
 * @param t 文言表
 */
export async function claimNamespace(ns: string, token: string, t: Messages): Promise<{ trust: string }> {
  const res = await fetch(`/api/${ns}/claim`, { method: 'POST', headers: auth(token) });
  if (res.status === 409) throw new Error(t.errorOwned);
  if (!res.ok) throw new Error(t.errorGeneric);
  return (await res.json()) as { trust: string };
}

/**
 * jar をクライアント側で展開して投入します。
 * 展開に失敗したときだけサーバへ丸ごと送ります（jar 本体を送らずに済むほうが軽いため）。
 * @param file 選ばれた jar
 * @param token 投稿者のトークン
 * @param t 文言表
 */
export async function uploadJar(file: File, token: string, t: Messages): Promise<UploadSummary> {
  try {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const extracted = await analyzeJar(zip);
    if (extracted.namespaces.length === 0) throw new Error(t.errorGeneric);
    return await sendExtracted(extracted, token, t);
  } catch (err) {
    console.warn('Client extraction failed, falling back to server side:', err);
    return sendWholeJar(file, token, t);
  }
}

/**
 * 展開済みのアセットを namespace ごとに投入します。
 * @param extracted 展開結果
 * @param token 投稿者のトークン
 * @param t 文言表
 */
async function sendExtracted(
  extracted: { namespaces: string[]; byNs: Record<string, unknown> },
  token: string,
  t: Messages
): Promise<UploadSummary> {
  const bodies = await Promise.all(
    extracted.namespaces.map(async (ns) => {
      const res = await fetch(`/api/${ns}/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth(token) },
        body: JSON.stringify(extracted.byNs[ns]),
      });
      if (res.status === 429) throw new Error(t.errorLimit);
      if (!res.ok) throw new Error(t.errorGeneric);
      return (await res.json()) as Record<string, number>;
    })
  );

  const count = bodies.reduce(
    (sum, b) => sum + (b.recipes || 0) + (b.textures || 0) + (b.models || 0) + (b.tags || 0) + (b.langs || 0),
    0
  );
  return { count, namespaces: extracted.namespaces };
}

/**
 * jar をそのままサーバへ送ります。クライアント側の展開が失敗したときの退避経路です。
 * @param file 選ばれた jar
 * @param token 投稿者のトークン
 * @param t 文言表
 */
async function sendWholeJar(file: File, token: string, t: Messages): Promise<UploadSummary> {
  const body = new FormData();
  body.append('jar', file);
  const res = await fetch('/api/upload', { method: 'POST', headers: auth(token), body });
  if (res.status === 429) throw new Error(t.errorLimit);
  if (res.status === 400) throw new Error(t.errorTooLarge);
  if (!res.ok) throw new Error(t.errorGeneric);
  return (await res.json()) as UploadSummary;
}
