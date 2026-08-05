/**
 * @fileoverview "/" で配信される、レシピ検索ページ用のスタンドアロンHTML。
 *
 * リストは `/api/list.json` から1回だけ取得されます（CIパイプラインによって生成される静的インデックス。
 * クライアント側でフィルタリングされるため、サーバーに負荷はかかりません）。
 * レシピは完成品アイテムごとにグループ化されているため、複数のレシピを持つアイテムはすべて同時に表示されます。
 * `namespace:id` を直接入力して検索することも可能です（例: Modのアイテムなど）。
 *
 * 見た目は ModParks 本体に合わせつつ、単体のツールとして動くよう本体のサイドバーやフッターは持ちません。
 */

import { searchMessagesFor, type SearchMessages } from '../i18n/search';
import { SEARCH_STYLES } from './styles';
import { searchScript } from './script';

/**
 * レシピ検索ページを組み立てます。
 * @param locale 表示言語
 * @returns HTML文字列
 */
export function searchPage(locale: string): string {
  const t: SearchMessages = searchMessagesFor(locale);
  return /* html */ `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${t.title}</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap" />
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" />
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script crossorigin src="https://unpkg.com/@mui/material@5.15.20/umd/material-ui.production.min.js"></script>
<style>${SEARCH_STYLES}</style>
</head>
<body>
  <div id="root"></div>
<script>
window.MPR_SEARCH_MESSAGES = ${JSON.stringify(t)};
${searchScript(locale)}
</script>
</body>
</html>`;
}
