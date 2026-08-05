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
  lead: 'レシピIDを入力してレシピを表示します。',
  search: '検索',
  format: '形式',
  show: '表示',
  publish: '投稿する',
  itemList: 'アイテム一覧',
  recipeCount: 'レシピ',
  cannotDisplay: 'を表示できません',
  listUnavailable: '一覧を取得できませんでした（索引が未生成の可能性があります）。',
  copySuccess: 'コピーしました',
  copyFailed: 'コピーに失敗しました',
  copyLink: 'リンクをコピー',
  download: 'ダウンロード',
  showImages: 'すべてのレシピを表示',
  clear: '検索条件をクリア',
  noResults: '該当するアイテムがありません。',
  openImage: '画像を原寸で開く',
} as const;

const EN: SearchMessages = {
  title: 'ModParks Recipe',
  lead: 'Enter a recipe ID to view the recipe.',
  search: 'Search',
  format: 'Format',
  show: 'Show',
  publish: 'Publish',
  itemList: 'Items',
  recipeCount: 'recipes',
  cannotDisplay: 'could not be displayed',
  listUnavailable: 'The list could not be loaded (the index may not have been generated yet).',
  copySuccess: 'Copied!',
  copyFailed: 'Failed to copy',
  copyLink: 'Copy Link',
  download: 'Download',
  showImages: 'Show all recipes',
  clear: 'Clear search',
  noResults: 'No matching items.',
  openImage: 'Open the image at full size',
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
