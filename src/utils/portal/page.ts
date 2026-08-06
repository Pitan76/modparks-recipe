/**
 * @fileoverview 投稿ポータルのHTML。
 *
 * 画面はクライアントバンドル（`src/client/portal`）が組み立てます。ここが返すのは
 * 器と、初期表示に必要な最小限（表示言語・ヘッダー・全体CSS）だけです。
 */

import { messagesFor, type Messages } from '../i18n/portal';
import { CLIENT_BUNDLES } from '../../generated/client-bundles';
import { PORTAL_STYLES } from './styles';

/**
 * 投稿ポータルのページを組み立てます。
 * @param locale 表示言語
 * @returns HTML文字列
 */
export function portalPage(locale: string): string {
  const t: Messages = messagesFor(locale);
  const toggle = locale === 'ja' ? { lang: 'en', label: 'English' } : { lang: 'ja', label: '日本語' };
  return /* html */ `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${t.siteTitle}</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap" />
<style>${PORTAL_STYLES}</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
<script src="/extractor.js"></script>
</head>
<body>
<header class="app-bar">
  <div class="app-bar-inner">
    <a class="app-brand" href="/">
      <img src="/icon.svg" alt="ModParks" width="32" height="32" />
      <span class="app-title">${t.siteTitle}</span>
    </a>
    <nav class="app-nav">
      <a href="/upload?lang=${toggle.lang}">${toggle.label}</a>
      <a href="/">${t.backToSearch}</a>
    </nav>
  </div>
</header>
<div id="root"></div>
<script>window.MPR_LOCALE = ${JSON.stringify(locale)};</script>
<script type="module" src="/app/${CLIENT_BUNDLES.portal}"></script>
</body>
</html>`;
}
