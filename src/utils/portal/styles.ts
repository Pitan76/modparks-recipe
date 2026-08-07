/**
 * @fileoverview アップロードのスタイル。
 *
 * 本文は MUI が組み立てるため、ここに置くのは素のHTMLで書くヘッダーと全体のリセットだけです。
 * 色は検索ページと同じトークンを使います。
 */

import { TOKENS } from '../ui/tokens';

/** ページ全体のCSS。 */
export const PORTAL_STYLES = /* css */ `
  :root { color-scheme: dark; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    background: ${TOKENS.bg};
    color: ${TOKENS.text};
    font-family: 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
    overflow-wrap: anywhere;
  }
  ::selection { background: rgba(138, 180, 248, 0.25); color: ${TOKENS.text}; }

  .app-bar { border-bottom: 1px solid ${TOKENS.border}; }
  .app-bar-inner {
    max-width: 900px; margin: 0 auto; padding: 12px 24px;
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
  }
  .app-brand { display: flex; align-items: center; gap: 8px; text-decoration: none; min-width: 0; }
  .app-brand img { width: 32px; height: 32px; border-radius: 8px; object-fit: cover; flex-shrink: 0; }
  .app-title { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; color: ${TOKENS.text}; }
  .app-nav { display: flex; align-items: center; gap: 20px; font-size: 14px; flex-shrink: 0; }
  .app-nav a { display: flex; align-items: center; height: 32px; line-height: 1; color: ${TOKENS.muted}; text-decoration: none; }
  .app-nav a:hover { color: ${TOKENS.primary}; }
  @media (max-width: 600px) {
    .app-bar-inner { padding: 8px 12px; gap: 8px; }
    .app-brand img { width: 26px; height: 26px; }
    .app-title { font-size: 16px; }
    .app-nav { gap: 14px; font-size: 13px; }
  }

`;
