/**
 * @fileoverview レシピ検索ページの表示文言。
 *
 * ページ側に文字列を直接書くと、言語を増やすたびにHTMLを触ることになります。
 * 文言は必ずこの表を経由させます。
 */

import { FALLBACK_LOCALE } from './locale';

/** 1言語分の文言。 */
export type SearchMessages = Record<SearchMessageKey, string>;

/** 文言のキー。既定言語の表がそのまま定義になります。 */
export type SearchMessageKey = keyof typeof JA;

const JA = {
  title: 'ModParks Recipe',
  lead: 'マイクラMODのレシピを検索、表示します。',
  search: '検索',
  namespace: '名前空間',
  format: '形式',
  formatAuto: '自動',
  size: '解像度',
  show: '表示',
  publish: 'アップロード',
  itemList: 'アイテム一覧',
  recipeCount: 'レシピ',
  cannotDisplay: 'を表示できません',
  listUnavailable: '一覧を取得できませんでした（索引が未生成の可能性があります）。',
  downloadZip: 'まとめてダウンロード',
  downloadZipProgress: '{done} / {total} 枚',
  downloadZipEmpty: 'ダウンロードできる画像がありませんでした',
  copySuccess: 'コピーしました',
  copyFailed: 'コピーに失敗しました',
  copyLink: 'リンクをコピー',
  copyImage: '画像URLをコピー',
  download: 'ダウンロード',
  showImages: 'すべてのレシピを表示',
  clear: '検索条件をクリア',
  noResults: '該当するアイテムがありません。',
  openImage: '画像を原寸で開く',
  viewSettings: '表示設定',
  tagNamespaces: 'タグに使う名前空間',
  tagNamespacesHelp: '空ならバニラのみ。カンマ区切りで追加、* ですべて',
  crop: '余白のクリップ',
  cropHelp: '上下左右から削る量',
} as const;

const EN: SearchMessages = {
  title: 'ModParks Recipe',
  lead: 'Search and display recipes for Minecraft mods.',
  search: 'Search',
  namespace: 'Namespace',
  format: 'Format',
  formatAuto: 'Auto',
  size: 'Size',
  show: 'Show',
  publish: 'Upload',
  itemList: 'Items',
  recipeCount: 'recipes',
  cannotDisplay: 'could not be displayed',
  listUnavailable: 'The list could not be loaded (the index may not have been generated yet).',
  downloadZip: 'Download all',
  downloadZipProgress: '{done} / {total}',
  downloadZipEmpty: 'No images could be downloaded',
  copySuccess: 'Copied!',
  copyFailed: 'Failed to copy',
  copyLink: 'Copy Link',
  copyImage: 'Copy image URL',
  download: 'Download',
  showImages: 'Show all recipes',
  clear: 'Clear search',
  noResults: 'No matching items.',
  openImage: 'Open the image at full size',
  viewSettings: 'Display settings',
  tagNamespaces: 'Namespaces for tags',
  tagNamespacesHelp: 'Empty means vanilla only. Comma-separated to add, * for all',
  crop: 'Crop margins',
  cropHelp: 'Trimmed from every side',
};

const TABLES: Record<string, SearchMessages> = { ja: JA, en: EN };

/** 文言表が存在する言語。 */
export const SEARCH_LOCALES = Object.keys(TABLES);

/**
 * 指定言語の文言表を返します。
 * @param locale 言語コード
 */
export function searchMessagesFor(locale: string): SearchMessages {
  return TABLES[locale] ?? TABLES[FALLBACK_LOCALE];
}
