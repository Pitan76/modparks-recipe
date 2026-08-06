/**
 * @fileoverview "/" で配信される、レシピ検索ページのHTMLシェル。
 *
 * 画面はクライアントバンドル（`src/client/search`）が組み立てます。ここが返すのは
 * 器と、初期表示に必要な最小限（表示言語・OGP・全体CSS）だけです。
 */

import { searchMessagesFor, type SearchMessages } from '../i18n/search';
import { SEARCH_STYLES } from './styles';
import { CLIENT_BUNDLES } from '../../generated/client-bundles';

/**
 * レシピ検索ページを組み立てます。
 * @param locale 表示言語
 * @param origin OGPの絶対URLに使うオリジン（例: `https://recipe.modparks.com`）
 * @returns HTML文字列
 */
export function searchPage(locale: string, origin: string): string {
  const t: SearchMessages = searchMessagesFor(locale);
  return /* html */ `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${t.title}</title>
<meta name="description" content="${t.lead}" />
${ogTags(locale, origin, t)}
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap" />
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" />
<style>${SEARCH_STYLES}</style>
</head>
<body>
  <div id="root"></div>
<script>window.MPR_LOCALE = ${JSON.stringify(locale)};</script>
<script type="module" src="/app/${CLIENT_BUNDLES.search}"></script>
</body>
</html>`;
}

/**
 * OGPとTwitterカードのメタタグ。画像は ModParks 本体と同じアイコンを使います。
 * @param locale 表示言語
 * @param origin 絶対URLに使うオリジン
 * @param t 表示文言
 * @returns HTML断片
 */
function ogTags(locale: string, origin: string, t: SearchMessages): string {
  const image = `${origin}/icon-512.png`;
  return /* html */ `<link rel="icon" href="/icon.svg" type="image/svg+xml" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${t.title}" />
<meta property="og:locale" content="${locale === 'ja' ? 'ja_JP' : 'en_US'}" />
<meta property="og:url" content="${origin}/" />
<meta property="og:title" content="${t.title}" />
<meta property="og:description" content="${t.lead}" />
<meta property="og:image" content="${image}" />
<meta property="og:image:width" content="512" />
<meta property="og:image:height" content="512" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="${t.title}" />
<meta name="twitter:description" content="${t.lead}" />
<meta name="twitter:image" content="${image}" />`;
}
