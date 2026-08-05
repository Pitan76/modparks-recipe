/**
 * @fileoverview 検索ページの MUI テーマ定義（クライアントに埋め込むJS片）。
 *
 * 色は `styles.ts` のトークンと同じものを使い、ModParks 本体と同じ見た目にします。
 */

import { TOKENS } from './styles';

/** 影・グラデーション・過剰なアニメーションを持たない MUI テーマを作るJS片。 */
export const SEARCH_THEME = /* js */ `
  const theme = createTheme({
    palette: {
      mode: 'dark',
      primary: { main: '${TOKENS.primary}', dark: '${TOKENS.primaryDark}', contrastText: '#1f1f1f' },
      background: { default: '${TOKENS.bg}', paper: '${TOKENS.surface}' },
      text: { primary: '${TOKENS.text}', secondary: '${TOKENS.muted}' },
      divider: '${TOKENS.border}'
    },
    shape: { borderRadius: 4 },
    typography: { fontFamily: "'Roboto', -apple-system, 'Segoe UI', sans-serif" },
    shadows: Array(25).fill('none'),
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true, disableRipple: true },
        styleOverrides: { root: { textTransform: 'none', fontWeight: 500, whiteSpace: 'nowrap', boxShadow: 'none' } }
      },
      MuiIconButton: { defaultProps: { disableRipple: true } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none', boxShadow: 'none' } } }
    }
  });
`;
