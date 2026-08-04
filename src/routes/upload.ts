/**
 * @fileoverview 外部 jar の投稿ポータル。
 *
 * jar の解析は modparks-jar Worker に委ねます（jszip を本体に載せないため）。ここは
 * 受け取り・上限・一時保管・委譲だけを持ちます。
 *
 * 投稿された jar 本体は保存しません。取り出したアセットさえあれば描画できる一方、
 * jar を持ち続けると無料枠の 10GB がすぐ埋まるためです。
 */

import { Hono } from 'hono';
import { Env } from '../utils/minecraft';
import { verifyToken } from '../utils/auth/tokens';
import { consumeUploadQuota, remainingUploads } from '../utils/auth/quota';
import { portalPage } from '../utils/portal/page';
import { pickLocale } from '../utils/i18n/locale';
import { PORTAL_LOCALES } from '../utils/i18n/portal';

export const uploadRoutes = new Hono<{ Bindings: Env }>();

/** 受け付ける jar の最大サイズ。Workers のボディ上限より手前で切り、CPU時間とR2の両方を守ります。 */
const MAX_JAR_BYTES = 32 * 1024 * 1024;

/** 一時保管した jar を jar Worker が取りに来るまでの猶予（ミリ秒）。 */
const PICKUP_TTL_MS = 10 * 60 * 1000;

/** 投稿ポータルのページ。表示言語は `?lang=` か `Accept-Language` で決まります。 */
uploadRoutes.get('/upload', (c) => {
  const locale = pickLocale(new URL(c.req.url), c.req.header('Accept-Language') ?? null, PORTAL_LOCALES);
  return c.html(portalPage(locale), 200, { 'Cache-Control': 'public, max-age=300' });
});

// jar を受け取り、解析と取り込みを jar Worker に委ねます。
uploadRoutes.post('/api/upload', async (c) => {
  if (!c.env.JAR_WORKER_URL) return c.text('Upload portal is not configured', 503);

  const token = bearerOf(c);
  const grant = token ? await verifyToken(c.env, token) : null;
  if (!grant) return c.text('Unauthorized', 401);
  if (!(await consumeUploadQuota(c.env, grant.identityId))) return c.text('Daily upload limit reached', 429);

  const jar = await readJar(c);
  if (!jar) return c.text('Missing or oversized jar', 400);

  const pickup = await stash(c.env, jar);
  const result = await delegate(c.env, c.req.url, pickup, token!);
  await c.env.BUCKET.delete(pickupKey(pickup.id));

  if (!result) return c.text('Extraction failed', 502);
  return c.json({ ok: true, ...result, remaining: await remainingUploads(c.env, grant.identityId) });
});

// jar Worker が一時保管された jar を取りに来る口。鍵を知っている1回だけ有効です。
uploadRoutes.get('/api/upload/pickup/:id', async (c) => {
  const obj = await c.env.BUCKET.get(pickupKey(c.req.param('id')));
  if (!obj) return c.text('Not found', 404);
  if (obj.customMetadata?.key !== c.req.query('key')) return c.text('Not found', 404);
  if (Date.parse(obj.customMetadata?.expiresAt ?? '') < Date.now()) return c.text('Expired', 410);

  return new Response(obj.body, { headers: { 'Content-Type': 'application/java-archive' } });
});

/**
 * リクエストから jar のバイト列を取り出します。
 * @param c Honoのコンテキストオブジェクト
 * @returns バイト列。無い/大きすぎる場合は null
 */
async function readJar(c: any): Promise<Uint8Array | null> {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('jar');
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_JAR_BYTES) return null;

  return new Uint8Array(await file.arrayBuffer());
}

/** 一時保管した jar の在り処。 */
type Pickup = { id: string; key: string };

/**
 * jar を一時保管します。
 *
 * 直接バイト列を Worker 間で渡さないのは、jar Worker の入力が「取得先」で統一されているためです。
 * @param env 環境変数
 * @param bytes jar のバイト列
 */
async function stash(env: Env, bytes: Uint8Array): Promise<Pickup> {
  const id = crypto.randomUUID();
  const key = crypto.randomUUID().replace(/-/g, '');

  await env.BUCKET.put(pickupKey(id), bytes, {
    httpMetadata: { contentType: 'application/java-archive' },
    customMetadata: { key, expiresAt: new Date(Date.now() + PICKUP_TTL_MS).toISOString() },
  });
  return { id, key };
}

/**
 * jar Worker に解析と取り込みを依頼します。
 *
 * 投稿者のトークンをそのまま渡すため、書き込み先は投稿者が所有する（あるいはこれから先着で
 * 確保する）namespace に限られます。
 * @param env 環境変数
 * @param requestUrl 受け取ったリクエストのURL（自身の公開URLを組み立てるため）
 * @param pickup 一時保管した jar の在り処
 * @param token 投稿者のトークン
 * @returns 取り込み結果。失敗なら null
 */
async function delegate(
  env: Env,
  requestUrl: string,
  pickup: Pickup,
  token: string
): Promise<{ count: number; namespaces: string[] } | null> {
  const origin = new URL(requestUrl).origin;
  const res = await fetch(`${env.JAR_WORKER_URL!.replace(/\/$/, '')}/extract-recipes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(env.JAR_WORKER_SECRET ? { Authorization: `Bearer ${env.JAR_WORKER_SECRET}` } : {}),
    },
    body: JSON.stringify({
      source: { kind: 'url', url: `${origin}/api/upload/pickup/${pickup.id}?key=${pickup.key}` },
      cdnUrl: origin,
      useCdnApi: true,
      token,
    }),
  });
  if (!res.ok) return null;

  return res.json();
}

/** 一時保管のR2キー。 */
function pickupKey(id: string): string {
  return `tmp/upload/${id}.jar`;
}

/**
 * Authorization ヘッダから生トークンを取り出します。
 * @param c Honoのコンテキストオブジェクト
 */
function bearerOf(c: any): string | null {
  const header = c.req.header('Authorization') || '';
  return header.replace(/^Bearer\s+/i, '') || null;
}
