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
    padding: 6px 12px;
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
  }
  .app-title { font-size: 18px; font-weight: 500; color: ${TOKENS.text}; }
  .app-nav { display: flex; align-items: center; gap: 16px; font-size: 14px; color: ${TOKENS.muted}; }
  .app-nav a { color: ${TOKENS.muted}; text-decoration: none; }
  .app-nav a:hover { color: ${TOKENS.primary}; }

  .app-layout { display: flex; gap: 12px; align-items: flex-start; }
  @media (max-width: 900px) { .app-layout { flex-direction: column; } }
  .side-panel { width: 300px; flex-shrink: 0; }
  @media (max-width: 900px) { .side-panel { width: 100%; } }
  .main-panel { flex-grow: 1; min-width: 0; }

  .list-box { max-height: 64vh; overflow-y: auto; border-top: 1px solid ${TOKENS.border}; }
  .item-row {
    position: relative; padding: 3px 72px 3px 8px;
    border-bottom: 1px solid ${TOKENS.border}; cursor: pointer;
  }
  .item-row:hover { background: ${TOKENS.hover}; }
  .item-row.selected { background: ${TOKENS.hover}; box-shadow: inset 2px 0 0 ${TOKENS.primary}; }
  .item-row .MuiTypography-root { line-height: 1.3; }
  .item-actions { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); display: flex; gap: 2px; }

  .recipe-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
  .recipe-item { text-align: center; padding: 4px; min-width: 0; }
  .recipe-img { image-rendering: pixelated; max-width: 100%; height: auto; cursor: pointer; display: block; margin: 0 auto 4px; }
  .recipe-name { font-size: 13px; color: ${TOKENS.text}; line-height: 1.3; }
  .recipe-label { font-size: 11px; color: ${TOKENS.muted}; font-family: monospace; }

  .section-head {
    display: flex; align-items: center; gap: 6px;
    padding-bottom: 4px; border-bottom: 1px solid ${TOKENS.border}; margin-bottom: 6px;
  }
  .empty-state { display: flex; align-items: center; justify-content: center; min-height: 240px; color: ${TOKENS.muted}; }
`;
