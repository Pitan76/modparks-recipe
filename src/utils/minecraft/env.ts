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
}
