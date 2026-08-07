/**
 * @fileoverview ページ下端のフッターと、その文言。
 *
 * 検索ページと投稿ページで同じものを出します。中身は静的なので、どちらのページでも
 * サーバ側で描いて済ませます（検索ページの React は `#root` の中だけを受け持ちます）。
 *
 * 文言をここに置いているのは、検索用・投稿用の表に同じものを二重に持たせないためです。
 * フッターは両ページ共通の部品なので、文言も部品と一緒にあるのが素直です。
 */

import { FALLBACK_LOCALE } from './i18n/locale';

/** ModParks 本体。レシピ検索はその一部という位置づけを示します。 */
const MODPARKS_URL = 'https://modparks.pitan76.net';

/** このサイトのソース。 */
const REPOSITORY_URL = 'https://github.com/Pitan76/modparks-recipe';

/** ライセンス条文。リポジトリの LICENSE と同じものを指します。 */
const LICENSE_URL = `${REPOSITORY_URL}/blob/main/LICENSE`;

/** 著作権表示。LICENSE の Copyright 行と揃えています。 */
const COPYRIGHT = '© 2026 ModParks';

/** 1言語分の文言。 */
type FooterMessages = Record<keyof typeof JA, string>;

const JA = {
  modparks: 'ModParks',
  modparksNote: '',
  source: 'ソースコード',
  license: 'MIT License',
};

const EN: FooterMessages = {
  modparks: 'ModParks',
  modparksNote: '',
  source: 'Source code',
  license: 'MIT License',
};

const TABLES: Record<string, FooterMessages> = { ja: JA, en: EN };

/**
 * ページ下端のフッター。
 * @param locale 表示言語
 */
export function PageFooter({ locale }: { locale: string }) {
  const t = TABLES[locale] ?? TABLES[FALLBACK_LOCALE];

  return (
    <footer class="app-footer">
      <div class="app-footer-inner">
        <div class="app-footer-brand">
          <a href={MODPARKS_URL} target="_blank" rel="noreferrer">
            {t.modparks}
          </a>
          {t.modparksNote && <span class="app-footer-note">{t.modparksNote}</span>}
        </div>
        <nav class="app-footer-nav">
          <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
            <i class="fa-brands fa-github" aria-hidden="true" /> {t.source}
          </a>
          <a href={LICENSE_URL} target="_blank" rel="noreferrer">
            {t.license}
          </a>
          <span class="app-footer-note">{COPYRIGHT}</span>
        </nav>
      </div>
    </footer>
  );
}
