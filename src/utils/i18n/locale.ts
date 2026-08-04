/**
 * @fileoverview 表示言語の決定。文言表を持つページすべてが同じ規則で言語を選ぶようにします。
 */

/** 表に無い言語で要求されたときに使う言語。 */
export const FALLBACK_LOCALE = 'ja';

/**
 * 要求から表示言語を決めます。
 *
 * `?lang=` を最優先にするのは、共有されたURLで言語を固定できるようにするためです。
 * @param url リクエストURL
 * @param acceptLanguage `Accept-Language` ヘッダ
 * @param available 文言表が存在する言語
 * @returns 言語コード
 */
export function pickLocale(url: URL, acceptLanguage: string | null, available: readonly string[]): string {
  const requested = url.searchParams.get('lang');
  if (requested && available.includes(requested)) return requested;

  for (const part of (acceptLanguage ?? '').split(',')) {
    const tag = part.split(';')[0].trim().toLowerCase().split('-')[0];
    if (available.includes(tag)) return tag;
  }
  return FALLBACK_LOCALE;
}
