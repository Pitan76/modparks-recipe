/**
 * @fileoverview フッターのスタイル。検索ページと投稿ページで同じものを使います。
 *
 * ヘッダーと同じく、面の区切りは 1px の境界線だけで表現します。
 */

import { TOKENS } from './tokens';

/** フッターのCSS。各ページのスタイルへ差し込みます。 */
export const FOOTER_STYLES = /* css */ `
  .app-footer {
    margin-top: 48px;
    border-top: 1px solid ${TOKENS.border};
    font-size: 13px;
    color: ${TOKENS.muted};
  }
  .app-footer-inner {
    padding: 20px 24px;
    display: flex; align-items: center; justify-content: space-between;
    flex-wrap: wrap; gap: 8px 20px;
  }
  .app-footer-brand { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .app-footer-brand a { font-weight: 700; color: ${TOKENS.text}; text-decoration: none; }
  .app-footer-nav { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 20px; }
  .app-footer a { color: ${TOKENS.muted}; text-decoration: none; }
  .app-footer a:hover { color: ${TOKENS.primary}; }
  .app-footer-brand a:hover { color: ${TOKENS.primary}; }
  .app-footer-note { color: ${TOKENS.muted}; opacity: 0.75; }
  @media (max-width: 600px) {
    .app-footer-inner { padding: 16px 12px; flex-direction: column; align-items: flex-start; gap: 10px; }
  }
`;
