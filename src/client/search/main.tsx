/**
 * @fileoverview 検索ページのエントリ。表示言語だけをサーバから受け取ります。
 */

import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import { appTheme } from '../shared/theme';
import { App } from './App';

declare global {
  interface Window {
    MPR_LOCALE?: string;
  }
}

const locale = window.MPR_LOCALE ?? 'en';
const root = document.getElementById('root');
if (root) createRoot(root).render(<ThemeProvider theme={appTheme}><App locale={locale} /></ThemeProvider>);
