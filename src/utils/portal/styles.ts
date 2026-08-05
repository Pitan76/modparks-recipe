/**
 * @fileoverview 投稿ポータルのスタイル。
 *
 * 検索ページと同じトークンを使い、見た目を揃えます。
 * カード・影・グラデーションは使わず、区切りは 1px の境界線だけで表現します。
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
    padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; gap: 12px;
  }
  .app-brand { display: flex; align-items: center; gap: 8px; text-decoration: none; }
  .app-brand img { width: 32px; height: 32px; border-radius: 8px; object-fit: cover; }
  .app-title { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; color: ${TOKENS.text}; }
  .app-nav { display: flex; align-items: center; gap: 20px; font-size: 14px; }
  .app-nav a { display: flex; align-items: center; height: 32px; line-height: 1; color: ${TOKENS.muted}; text-decoration: none; }
  .app-nav a:hover { color: ${TOKENS.primary}; }

  main { max-width: 720px; margin: 0 auto; padding: 24px; }
  .lead { color: ${TOKENS.muted}; font-size: 14px; margin-bottom: 20px; }

  .section { margin-top: 24px; }
  .section-head {
    display: flex; align-items: center; gap: 8px;
    padding-bottom: 6px; border-bottom: 1px solid ${TOKENS.border}; margin-bottom: 10px;
    font-size: 14px; font-weight: 500;
  }
  .row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .muted { color: ${TOKENS.muted}; font-size: 13px; }
  .mono { font-family: monospace; }
  .error { color: #f28b82; font-size: 13px; }
  .status { color: ${TOKENS.muted}; font-size: 13px; min-height: 20px; }

  .btn {
    height: 36px; padding: 0 16px; border: 1px solid ${TOKENS.border}; border-radius: 4px;
    background: transparent; color: ${TOKENS.text}; font: inherit; font-size: 14px; cursor: pointer;
  }
  .btn:hover { background: ${TOKENS.hover}; }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn-primary { background: ${TOKENS.primary}; border-color: ${TOKENS.primary}; color: #1f1f1f; font-weight: 500; }
  .btn-primary:hover { background: ${TOKENS.primaryDark}; }
  .btn-sm { height: 28px; padding: 0 10px; font-size: 13px; }

  input[type='file'] { display: none; }

  .list { list-style: none; }
  .list li {
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    padding: 8px 0; border-bottom: 1px solid ${TOKENS.border};
  }
  .list li .grow { flex-grow: 1; min-width: 0; }
  .badge {
    display: inline-flex; align-items: center; height: 20px; padding: 0 6px;
    border: 1px solid ${TOKENS.border}; border-radius: 4px; font-size: 11px; color: ${TOKENS.muted};
  }
`;
