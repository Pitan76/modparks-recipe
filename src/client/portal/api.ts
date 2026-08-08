/**
 * @fileoverview アップロードが叩くAPIと、jar の取り込み。
 *
 * jar の展開はページに読み込まれた `jszip` と `/extractor.js` に依存します。どちらもグローバルに
 * 生えるため、ここでは型だけ宣言します。
 *
 * `/extractor.js` は外部にも配っている公開版です。ポータルがバンドルに取り込まず同じものを読むことで、
 * 配布物が壊れていればポータルでも壊れる（＝気づける）ようにしています。型は実装元から借ります。
 */

import type { ExtractedJar, ZipLike } from '../../core/jar-assets';
import type { Messages } from '../../utils/i18n/portal';
import { sendWithSession, type OnProgress } from './upload-flow';

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

declare const JSZip: { loadAsync(data: ArrayBuffer): Promise<ZipLike> };
declare function analyzeJar(zip: ZipLike): Promise<ExtractedJar>;

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
 * @param onProgress 進行の通知
 */
export async function uploadJar(
  file: File,
  token: string,
  t: Messages,
  onProgress: OnProgress
): Promise<UploadSummary> {
  const extracted = await extractLocally(file);
  // 丸ごと送る経路には刻みが無いので、進捗は出しません。
  if (!extracted) return sendWholeJar(file, token, t);

  // 送信の失敗はそのまま伝えます。ここで丸ごと送信へ逃がすと、途中まで入った投入の上に
  // 同じ jar をもう一度流し込むことになり、失敗した理由も進捗も消えます。
  return sendExtracted(extracted, token, t, onProgress);
}

/**
 * この端末で jar を展開します。
 * @param file 選ばれた jar
 * @returns 展開結果。展開できなければ null（サーバ側へ丸ごと送る）
 */
async function extractLocally(file: File): Promise<ExtractedJar | null> {
  try {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const extracted = await analyzeJar(zip);
    return extracted.namespaces.length > 0 ? extracted : null;
  } catch (err) {
    console.warn('Client extraction failed, falling back to server side:', err);
    return null;
  }
}

/**
 * 展開済みのアセットを namespace ごとに投入します。
 * @param extracted 展開結果
 * @param token 投稿者のトークン
 * @param t 文言表
 */
async function sendExtracted(
  extracted: ExtractedJar,
  token: string,
  t: Messages,
  onProgress: OnProgress
): Promise<UploadSummary> {
  const headers = { 'Content-Type': 'application/json', ...auth(token) };
  const count = await sendWithSession(extracted, headers, t, onProgress);
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

/** 保存せずに描画した結果。 */
export type PreviewResult = {
  /** 描画できたレシピID順の一覧 */
  ids: string[];
  /** レシピIDからデータURLへの対応。描画できなかったものは null */
  images: Record<string, string | null>;
};

/** 1回のリクエストで取りに行く枚数。サーバ側の上限に合わせています。 */
const PREVIEW_CHUNK = 40;

/**
 * jar を保存せずに描画します。
 *
 * 描画はサーバのCPUを使うため1回のリクエストで返る枚数に上限があります。`offset` を進めながら
 * 全件揃うまで繰り返します。投稿ではないので枠は消費しません。
 * @param file 選ばれた jar
 * @param token 投稿者のトークン
 * @param t 文言表
 * @param onProgress 進捗の通知
 */
export async function previewJar(
  file: File,
  token: string,
  t: Messages,
  onProgress?: (done: number, total: number) => void
): Promise<PreviewResult> {
  const images: Record<string, string | null> = {};
  let ids: string[] = [];
  let offset = 0;

  do {
    const body = new FormData();
    body.append('jar', file);
    const res = await fetch(`/api/preview?offset=${offset}&limit=${PREVIEW_CHUNK}`, {
      method: 'POST',
      headers: auth(token),
      body,
    });
    if (!res.ok) throw new Error(t.errorGeneric);

    const page = (await res.json()) as { total: number; count: number; ids: string[]; images: Record<string, string | null> };
    ids = page.ids;
    Object.assign(images, page.images);
    offset += page.count;
    onProgress?.(offset, page.total);

    // 進まなくなったら打ち切ります。無いはずですが、無限に往復させないためです。
    if (page.count === 0) break;
  } while (offset < ids.length);

  return { ids, images };
}
