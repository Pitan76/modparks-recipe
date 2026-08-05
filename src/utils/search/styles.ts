/**
 * @fileoverview 検索ページのスタイル。
 *
 * 配色と角丸は ModParks 本体（`lib/theme.ts` の new テーマ・ダーク）に合わせています。
 * カード・影・グラデーションは使わず、面の区切りは 1px の境界線だけで表現します。
 */

/** ModParks 本体と同じデザイントークン。MUI テーマ側からも参照します。 */
export const TOKENS = {
  bg: '#0b1329',
  surface: '#16223f',
  border: '#3c4043',
  text: '#f1f5f9',
  muted: '#94a3b8',
  primary: '#8ab4f8',
  primaryDark: '#669df6',
  hover: 'rgba(138, 180, 248, 0.08)',
} as const;

/** ページ全体のCSS。 */
export const SEARCH_STYLES = /* css */ `
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

  .app-bar {
    position: sticky; top: 0; z-index: 10;
    background: ${TOKENS.bg};
    border-bottom: 1px solid ${TOKENS.border};
  }
  .app-bar-inner {
    max-width: 1200px; margin: 0 auto; padding: 12px 24px;
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
  }
  .app-title { font-size: 18px; font-weight: 500; color: ${TOKENS.text}; }
  .app-nav { display: flex; align-items: center; gap: 20px; font-size: 14px; color: ${TOKENS.muted}; }
  .app-nav a { color: ${TOKENS.muted}; text-decoration: none; }
  .app-nav a:hover { color: ${TOKENS.primary}; }

  .app-layout { display: flex; gap: 24px; align-items: flex-start; }
  @media (max-width: 900px) { .app-layout { flex-direction: column; } }
  .side-panel { width: 320px; flex-shrink: 0; }
  @media (max-width: 900px) { .side-panel { width: 100%; } }
  .main-panel { flex-grow: 1; min-width: 0; }

  .list-box { max-height: 560px; overflow-y: auto; border-top: 1px solid ${TOKENS.border}; }
  .item-row {
    position: relative; padding: 10px 84px 10px 12px;
    border-bottom: 1px solid ${TOKENS.border}; cursor: pointer;
  }
  .item-row:hover { background: ${TOKENS.hover}; }
  .item-row.selected { background: ${TOKENS.hover}; box-shadow: inset 2px 0 0 ${TOKENS.primary}; }
  .item-actions { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); display: flex; gap: 2px; }

  .recipe-grid { display: flex; flex-wrap: wrap; gap: 16px; }
  .recipe-item {
    width: calc(50% - 8px); min-width: 140px; text-align: center;
    border: 1px solid ${TOKENS.border}; padding: 12px;
  }
  @media (max-width: 600px) { .recipe-item { width: 100%; } }
  .recipe-img { image-rendering: pixelated; max-width: 100%; height: auto; cursor: pointer; display: block; margin: 0 auto 8px; }
  .recipe-label { font-size: 11px; color: ${TOKENS.muted}; font-family: monospace; }

  .section-head {
    display: flex; align-items: center; gap: 8px;
    padding-bottom: 8px; border-bottom: 1px solid ${TOKENS.border}; margin-bottom: 16px;
  }
  .empty-state { display: flex; align-items: center; justify-content: center; min-height: 360px; color: ${TOKENS.muted}; }
`;
