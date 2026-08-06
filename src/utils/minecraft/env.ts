/**
 * @fileoverview Minecraft環境定義。
 */

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ADMIN_SECRET: string;
  // 書き込み/アップロードAPIに必要なシークレット。設定されていない場合は ADMIN_SECRET が使用されます。
  UPLOAD_SECRET?: string;
  // レンダラー版の上書き（CI がレンダリング系ソースのハッシュを注入する運用に備えたもの）。
  RENDERER_VERSION?: string;
  // R2バケットに割り当てた公開ドメイン（例: `https://img.recipe.modparks.pitan76.net`）。
  // 設定するとクライアントはレンダリング済み画像をWorkerを介さずR2から直接取得します。
  // 未設定なら従来どおり全リクエストがWorkerを通ります。
  PUBLIC_IMAGE_BASE?: string;
  // ModParks アカウントでログインさせる場合のみ設定します。3つ揃わなければプロバイダごと無効になります。
  MODPARKS_URL?: string;
  MODPARKS_CLIENT_ID?: string;
  MODPARKS_CLIENT_SECRET?: string;
  // jar 解析 Worker への Service Binding。外部 jar の投稿ポータルを開く場合のみ設定します。
  // 未設定なら投稿口は 503 を返します。公開URLではなくバインディングなのは、jar Worker が
  // 自前の認証を持たず（`workers_dev = false` で公開していない）ためです。
  JAR_WORKER?: Fetcher;
}
