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
import { recordUpload } from '../utils/audit';
import { pickLocale } from '../utils/i18n/locale';
import { PORTAL_LOCALES } from '../utils/i18n/portal';

export const uploadRoutes = new Hono<{ Bindings: Env }>();

/** 受け付ける jar の最大サイズ。Workers のボディ上限より手前で切り、CPU時間とR2の両方を守ります。 */
const MAX_JAR_BYTES = 32 * 1024 * 1024;

/** 投稿ポータルのページ。表示言語は `?lang=` か `Accept-Language` で決まります。 */
uploadRoutes.get('/upload', (c) => {
  const locale = pickLocale(new URL(c.req.url), c.req.header('Accept-Language') ?? null, PORTAL_LOCALES);
  return c.html(portalPage(locale), 200, { 'Cache-Control': 'public, max-age=300' });
});

// jar を受け取り、解析と取り込みを jar Worker に委ねます。
uploadRoutes.post('/api/upload', async (c) => {
  if (!c.env.JAR_WORKER) return c.text('Upload portal is not configured', 503);

  const token = bearerOf(c);
  const grant = token ? await verifyToken(c.env, token) : null;
  if (!grant) return c.text('Unauthorized', 401);
  if (!(await consumeUploadQuota(c.env, grant.identityId))) return c.text('Daily upload limit reached', 429);

  const jar = await readJar(c);
  if (!jar) return c.text('Missing or oversized jar', 400);

  const result = await delegate(c.env, c.req.url, jar, token!);

  if (!result) return c.text('Extraction failed', 502);
  // jar は namespace を跨ぐことがあるので、namespace ごとに1行残す
  for (const ns of result.namespaces) {
    await recordUpload(c.env, { identityId: grant.identityId, ns, source: 'jar', items: result.count });
  }
  return c.json({ ok: true, ...result, remaining: await remainingUploads(c.env, grant.identityId) });
});

/**
 * @param c Honoのコンテキストオブジェクト
 * @returns バイト列。無い/大きすぎる場合は null
 */
async function readJar(c: any): Promise<Uint8Array | null> {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('jar');
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_JAR_BYTES) return null;

  return new Uint8Array(await file.arrayBuffer());
}

/**
 * @param env 環境変数
 * @param requestUrl 受け取ったリクエストのURL
 * @param jar jar のバイト列
 * @param token 投稿者のトークン
 * @returns 取り込み結果。失敗なら null
 */
async function delegate(
  env: Env,
  requestUrl: string,
  jar: Uint8Array,
  token: string
): Promise<{ count: number; namespaces: string[] } | null> {
  const origin = new URL(requestUrl).origin;
  const res = await env.JAR_WORKER!.fetch('https://modparks-jar/extract-recipes-binary', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/java-archive',
      'X-CDN-Url': origin,
      'X-Use-CDN-Api': 'true',
      'X-Token': token,
    },
    body: jar,
  });
  if (!res.ok) return null;

  return res.json();
}

/**
 * @param c Honoのコンテキストオブジェクト
 * @returns トークン
 */
function bearerOf(c: any): string | null {
  const header = c.req.header('Authorization') || '';
  return header.replace(/^Bearer\s+/i, '') || null;
}
