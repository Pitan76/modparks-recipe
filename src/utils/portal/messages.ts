/**
 * @fileoverview 投稿ポータルの表示文言。
 *
 * ページ側に文字列を直接書くと、言語を増やすたびにHTMLを触ることになります。
 * ここだけを増やせば済むよう、文言は必ずこの表を経由させます。
 */

/** 1言語分の文言。 */
export type Messages = Record<MessageKey, string>;

/** 文言のキー。既定言語の表がそのまま定義になります。 */
export type MessageKey = keyof typeof JA;

const JA = {
  title: 'ModParks Recipe への投稿',
  lead: 'jar をアップロードすると、レシピとテクスチャを取り出して公開します。jar 自体は保存しません。',
  signIn: 'ログイン',
  signInLead: '投稿にはアカウントが必要です。',
  signOut: 'ログアウト',
  noProviders: 'ログイン手段が設定されていません。',
  signedInAs: 'ログイン中',
  remaining: '本日の残り投稿数',
  chooseFile: 'jar ファイルを選択',
  upload: 'アップロード',
  uploading: 'アップロード中…',
  resultTitle: '取り込み結果',
  extracted: '取り込んだファイル数',
  namespaces: 'ネームスペース',
  claim: 'このネームスペースを取得',
  claiming: '処理中…',
  claimed: '取得しました',
  trustVerified: '確認済み',
  trustUnverified: '未確認',
  errorTooLarge: 'ファイルが大きすぎます（上限 32MB）。',
  errorLimit: '本日の投稿上限に達しました。',
  errorOwned: 'このネームスペースは他の人が所有しています。',
  errorGeneric: '処理に失敗しました。',
} as const;

const EN: Messages = {
  title: 'Publish to ModParks Recipe',
  lead: 'Upload a jar to extract and publish its recipes and textures. The jar itself is not stored.',
  signIn: 'Sign in',
  signInLead: 'An account is required to publish.',
  signOut: 'Sign out',
  noProviders: 'No sign-in method is configured.',
  signedInAs: 'Signed in as',
  remaining: 'Uploads left today',
  chooseFile: 'Choose a jar file',
  upload: 'Upload',
  uploading: 'Uploading…',
  resultTitle: 'Ingest result',
  extracted: 'Files ingested',
  namespaces: 'Namespaces',
  claim: 'Claim this namespace',
  claiming: 'Working…',
  claimed: 'Claimed',
  trustVerified: 'Verified',
  trustUnverified: 'Unverified',
  errorTooLarge: 'The file is too large (32MB max).',
  errorLimit: 'Daily upload limit reached.',
  errorOwned: 'This namespace is owned by someone else.',
  errorGeneric: 'The request failed.',
};

const TABLES: Record<string, Messages> = { ja: JA, en: EN };

/** 表に無い言語で要求されたときに使う言語。 */
const FALLBACK = 'ja';

/**
 * 要求から表示言語を決めます。
 *
 * `?lang=` を最優先にするのは、共有されたURLで言語を固定できるようにするためです。
 * @param url リクエストURL
 * @param acceptLanguage `Accept-Language` ヘッダ
 * @returns 言語コード
 */
export function pickLocale(url: URL, acceptLanguage: string | null): string {
  const requested = url.searchParams.get('lang');
  if (requested && TABLES[requested]) return requested;

  for (const part of (acceptLanguage ?? '').split(',')) {
    const tag = part.split(';')[0].trim().toLowerCase().split('-')[0];
    if (TABLES[tag]) return tag;
  }
  return FALLBACK;
}

/**
 * 指定言語の文言表を返します。
 * @param locale 言語コード
 */
export function messagesFor(locale: string): Messages {
  return TABLES[locale] ?? TABLES[FALLBACK];
}
