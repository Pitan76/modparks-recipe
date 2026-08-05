/**
 * @fileoverview アイテム名（言語ファイル）の読み取りAPIのルート定義。
 *
 * 画像APIと同じく `?v=`（アセットバージョン）が付いていれば `immutable` で返します。
 * バージョンは `/api/list.json` の `versions` から取れるため、クライアントは追加の往復なしで付けられます。
 */

import { Hono } from 'hono';
import type { Env } from '../utils/minecraft';
import { readLang, resolveNames, isValidLocale } from '../utils/lang-store';
import { nameIndexKey } from '../utils/name-index';

export const langRoutes = new Hono<{ Bindings: Env }>();

/** `?v=` 付きは内容が一意に定まるため、恒久キャッシュにできます。 */
const IMMUTABLE = 'public, max-age=31536000, immutable';

/** `?v=` 無しのフォールバック経路。取り込み後の反映が1日以内に収まるようにします。 */
const VERSIONLESS = 'public, max-age=86400';

/**
 * 1リクエストで解決できるID数の上限。
 * ネームスペース数だけR2を読むため件数自体は重くありませんが、URL長と応答サイズを抑えます。
 */
const MAX_IDS = 500;

/**
 * リクエストの `?v=` の有無からCache-Controlを決めます。
 * @param c Honoのコンテキストオブジェクト
 */
function cacheControlOf(c: any): string {
  return c.req.query('v') ? IMMUTABLE : VERSIONLESS;
}

/**
 * ネームスペースに登録済みのロケール一覧を返します。
 * 対応言語はAPI側で固定していないため、クライアントは実際に存在するものをここで知ります。
 */
langRoutes.get('/api/:namespace/lang.json', async (c) => {
  const { namespace } = c.req.param();
  const prefix = `assets/${namespace}/lang/`;

  const locales: string[] = [];
  let cursor: string | undefined = undefined;
  do {
    const listed = await c.env.BUCKET.list({ prefix, cursor });
    for (const o of listed.objects) {
      const locale = o.key.slice(prefix.length).replace(/\.json$/, '');
      if (locale.length > 0) locales.push(locale);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return c.json({ namespace, locales: locales.sort() }, 200, { 'Cache-Control': cacheControlOf(c) });
});

/**
 * 言語ファイルをそのまま返します（翻訳キー -> 表示名）。
 * 全件を1オブジェクトで返すため、多数のアイテム名を扱うクライアントはこちらを1回引いて手元で解決できます。
 */
langRoutes.get('/api/:namespace/lang/:locale{[^/]+\\.json}', async (c) => {
  const { namespace } = c.req.param();
  const locale = c.req.param('locale').replace(/\.json$/, '');
  if (!isValidLocale(locale)) return c.text('Invalid locale', 400);

  const lang = await readLang(c.env, namespace, locale);
  if (!lang) return c.text('Not found', 404);

  return c.json(lang, 200, { 'Cache-Control': cacheControlOf(c) });
});

/**
 * 表示名の静的索引を丸ごと返します。索引はレシピ索引の再構築時に作られます。
 *
 * 一覧の表示名をこれ1回で賄えるため、`/api/names` をページ送りのたびに叩かずに済みます。
 * 索引が未生成のときは空を返し、呼び出し側は `/api/names` にフォールバックできます。
 *
 * 例: GET /api/names.json?lang=ja_jp
 */
langRoutes.get('/api/names.json', async (c) => {
  const locale = c.req.query('lang');
  if (!locale) return c.text('Missing lang', 400);
  if (!isValidLocale(locale)) return c.text('Invalid locale', 400);

  const cacheControl = { 'Cache-Control': cacheControlOf(c) };
  const obj = await c.env.BUCKET.get(nameIndexKey(locale));
  if (!obj) return c.json({ lang: locale, names: {} }, 200, cacheControl);

  return new Response(obj.body, {
    headers: { 'Content-Type': 'application/json', ...cacheControl },
  });
});

/**
 * アイテムIDをまとめて表示名に解決します。
 * 未翻訳のIDはレスポンスに含まれないため、呼び出し側は欠けたIDを自身の方針で表示できます。
 *
 * 例: GET /api/names?ids=minecraft:stone,mymod:gadget&lang=ja_jp
 */
langRoutes.get('/api/names', async (c) => {
  const locale = c.req.query('lang');
  if (!locale) return c.text('Missing lang', 400);
  if (!isValidLocale(locale)) return c.text('Invalid locale', 400);

  const ids = (c.req.query('ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return c.json({ lang: locale, names: {} });
  if (ids.length > MAX_IDS) return c.text(`Too many ids (max ${MAX_IDS})`, 400);

  const names = await resolveNames(c.env, ids, locale);
  return c.json({ lang: locale, names }, 200, { 'Cache-Control': cacheControlOf(c) });
});
