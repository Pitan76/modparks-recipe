/**
 * @fileoverview 投稿ポータルの表示文言。
 *
 * ページ側に文字列を直接書くと、言語を増やすたびにHTMLを触ることになります。
 * ここだけを増やせば済むよう、文言は必ずこの表を経由させます。
 */

import { FALLBACK_LOCALE } from '../i18n/locale';

/** 1言語分の文言。 */
export type Messages = Record<MessageKey, string>;

/** 文言のキー。既定言語の表がそのまま定義になります。 */
export type MessageKey = keyof typeof JA;

const JA = {
  title: 'レシピ抽出',
  lead: 'jarファイルからレシピを組み立てるためのアセットやデータを抽出します。',
  signInWith: '{provider}でログイン',
  signInLead: '',
  signOut: 'ログアウト',
  noProviders: 'ログイン手段がありません。',
  signedInAs: '',
  remaining: '残り{remaining}回',
  chooseFile: '',
  upload: '',
  uploading: '処理中…',
  preview: '保存せずにプレビュー',
  previewLead: 'アップロードせずに画像だけを作ります。投稿枠は消費しません。',
  previewing: 'プレビューを作成中… {done} / {total}',
  previewTitle: 'プレビュー',
  previewEmpty: 'クラフトレシピが見つかりませんでした。',
  previewDownload: 'zipでダウンロード',
  resultTitle: '結果',
  extracted: 'ファイル数',
  namespaces: 'ネームスペース',
  claim: '所有権を取得',
  claiming: '処理中…',
  claimed: '取得済み',
  trustVerified: '確認済み',
  trustUnverified: '未確認',
  errorTooLarge: '32MB上限を超えています。',
  errorLimit: '本日の上限に達しました。',
  errorOwned: '他のユーザーが所有しています。',
  errorGeneric: 'エラーが発生しました。',
  siteTitle: 'ModParks Recipe',
  backToSearch: 'レシピ検索',
  signedIn: 'ログイン中',
  chooseJar: 'jarファイルを選択',
  historyTitle: '投稿履歴',
  historyEmpty: 'まだ投稿はありません。',
  historyItems: '{count}件',
  sourceJar: 'jar',
  sourceBulk: '一括API',
  sourceCommit: '取り込み確定',
} as const;

const EN: Messages = {
  title: 'Submit Recipe',
  lead: 'Extract data from the jar file to create recipes.',
  signInWith: 'Sign in with {provider}',
  signInLead: '',
  signOut: 'Sign out',
  noProviders: 'No sign-in methods.',
  signedInAs: '',
  remaining: '{remaining} left',
  chooseFile: '',
  upload: '',
  uploading: 'Uploading…',
  preview: 'Preview without uploading',
  previewLead: 'Renders images without uploading. This does not use your daily quota.',
  previewing: 'Rendering… {done} / {total}',
  previewTitle: 'Preview',
  previewEmpty: 'No crafting recipes were found.',
  previewDownload: 'Download as zip',
  resultTitle: 'Result',
  extracted: 'Files',
  namespaces: 'Namespaces',
  claim: 'Claim',
  claiming: 'Claiming…',
  claimed: 'Claimed',
  trustVerified: 'Verified',
  trustUnverified: 'Unverified',
  errorTooLarge: 'Too large (max 32MB).',
  errorLimit: 'Limit reached.',
  errorOwned: 'Owned by someone else.',
  errorGeneric: 'An error occurred.',
  siteTitle: 'ModParks Recipe',
  backToSearch: 'Recipe search',
  signedIn: 'Signed in',
  chooseJar: 'Choose a jar file',
  historyTitle: 'Your uploads',
  historyEmpty: 'No uploads yet.',
  historyItems: '{count} items',
  sourceJar: 'jar',
  sourceBulk: 'Bulk API',
  sourceCommit: 'Ingest commit',
};

const TABLES: Record<string, Messages> = { ja: JA, en: EN };

/** 文言表が存在する言語。 */
export const PORTAL_LOCALES = Object.keys(TABLES);

/**
 * 指定言語の文言表を返します。
 * @param locale 言語コード
 */
export function messagesFor(locale: string): Messages {
  return TABLES[locale] ?? TABLES[FALLBACK_LOCALE];
}
