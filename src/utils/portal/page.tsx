/**
 * @fileoverview アップロードのHTML。
 *
 * 画面はクライアントバンドル（`src/client/portal`）が組み立てます。ここが返すのは
 * 器と、初期表示に必要な最小限（表示言語・ヘッダー・全体CSS）だけです。
 */

import { raw } from 'hono/html';
import { messagesFor, type Messages } from '../i18n/portal';
import { PageFooter } from '../page-footer';
import { PORTAL_STYLES } from './styles';

/** 言語切替リンクの行き先。 */
type Toggle = { lang: string; label: string };

/**
 * アップロードのページを組み立てます。
 * @param locale 表示言語
 * @returns HTML文字列
 */
export function portalPage(locale: string): string {
  const t = messagesFor(locale);
  const toggle: Toggle = locale === 'ja' ? { lang: 'en', label: 'English' } : { lang: 'ja', label: '日本語' };
  return `<!DOCTYPE html>${(<Shell locale={locale} t={t} toggle={toggle} />).toString()}`;
}

/** ページ全体の器。 */
function Shell({ locale, t, toggle }: { locale: string; t: Messages; toggle: Toggle }) {
  return (
    <html lang={locale}>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{t.siteTitle}</title>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap" />
        {/* CSSは実体をそのまま出す必要がある。エスケープすると `>` を含むセレクタが壊れる。 */}
        <style>{raw(PORTAL_STYLES)}</style>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js" />
        <script src="/extractor.js" />
      </head>
      <body>
        <header class="app-bar">
          <div class="app-bar-inner">
            <a class="app-brand" href="/">
              <img src="/icon.svg" alt="ModParks" width="32" height="32" />
              <span class="app-title">{t.siteTitle}</span>
            </a>
            <nav class="app-nav">
              <a href={`/upload?lang=${toggle.lang}`}>{toggle.label}</a>
              <a href="/">{t.backToSearch}</a>
            </nav>
          </div>
        </header>
        <div id="root" />
        <PageFooter locale={locale} />
        <script>{raw(`window.MPR_LOCALE = ${JSON.stringify(locale)};`)}</script>
        <script type="module" src="/app/portal.js" />
      </body>
    </html>
  );
}
