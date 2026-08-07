/**
 * @fileoverview 画面共通のデザイントークン。
 *
 * 検索ページとアップロードで同じ値を使うため、ここ1箇所に置きます。
 * 値は ModParks 本体（`lib/theme.ts` の new テーマ・ダーク）に合わせています。
 */

/** ModParks 本体と同じデザイントークン。MUI テーマ側からも参照します。 */
export const TOKENS = {
  bg: '#0b1329',
  surface: '#16223f',
  border: '#3c4043',
  text: '#f1f5f9',
  muted: '#94a3b8',
  primary: '#8ab4f8',
  primaryLight: '#adcbfa',
  primaryDark: '#669df6',
  hover: 'rgba(138, 180, 248, 0.08)',
} as const;
