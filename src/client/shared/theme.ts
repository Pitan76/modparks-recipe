import { createTheme } from '@mui/material/styles';
import { TOKENS } from '../../utils/ui/tokens';

/**
 * ModParks 本体の `getAppTheme(mode, isNewTheme: true)` に合わせたテーマ。
 * 影・グラデーション・過剰なアニメーションは持たせません。
 */
export const appTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: TOKENS.primary, light: TOKENS.primaryLight, dark: TOKENS.primaryDark, contrastText: '#1f1f1f' },
    background: { default: TOKENS.bg, paper: TOKENS.surface },
    text: { primary: TOKENS.text, secondary: TOKENS.muted },
    divider: TOKENS.border,
  },
  shape: { borderRadius: 4 },
  typography: { fontFamily: "'Roboto', -apple-system, 'Segoe UI', sans-serif" },
  shadows: Array(25).fill('none') as never,
  components: {
    MuiButton: {
      defaultProps: { size: 'medium', disableElevation: true, disableRipple: true },
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 600, whiteSpace: 'nowrap', boxShadow: 'none', borderRadius: 4 },
        sizeSmall: { height: '32px', padding: '4px 12px', fontSize: '0.8125rem' },
        sizeMedium: { height: '40px', padding: '8px 16px', fontSize: '0.875rem' },
        sizeLarge: { height: '48px', padding: '10px 22px', fontSize: '0.9375rem' },
      },
    },
    MuiChip: { styleOverrides: { root: { borderRadius: 4, borderWidth: '1px', fontWeight: 400 } } },
    MuiLink: {
      defaultProps: { color: 'primary.light' },
      styleOverrides: { root: { textDecoration: 'none', '&:hover': { textDecoration: 'underline' } } },
    },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiFormControl: { defaultProps: { size: 'small' } },
    MuiSelect: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: { defaultProps: { size: 'small' } },
    MuiIconButton: { defaultProps: { disableRipple: true } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none', boxShadow: 'none' } } },
  },
});
