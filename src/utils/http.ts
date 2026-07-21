/**
 * @fileoverview 書き込みAPIおよび画像API全体で共有される、HTTPおよびエンコーディングに関するヘルパー関数群。
 */

/**
 * リクエストが認証されているかどうかを検証します。
 * Bearerトークン（Authorizationヘッダー）またはクエリパラメータの `?secret=` が `UPLOAD_SECRET` または `ADMIN_SECRET` と一致する必要があります。
 * いずれのシークレットも受け入れられます。`ADMIN_SECRET` は既に破壊的な管理者ルートの権限を付与しているため、
 * ここで許可してもセキュリティホールの拡大には繋がりません。また、`.dev.vars` で片方のシークレットのみをオーバーライドしているような
 * `wrangler dev --remote` セッションにおいても、メンテナンススクリプトが正しく動作し続けるようになります。
 * @param c Honoのコンテキストオブジェクト
 * @returns 認証されていれば true、それ以外は false
 */
export function authorized(c: any): boolean {
  const header = c.req.header('Authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '') || c.req.query('secret') || '';
  if (!token) return false;
  return token === c.env.UPLOAD_SECRET || token === c.env.ADMIN_SECRET;
}

/**
 * base64文字列をバイナリデータ（Uint8Array）にデコードします。
 * データURLスキーム（例: "data:image/png;base64,"）が含まれている場合でも、自動的にプレフィックスを削除してデコードします。
 * @param b64 デコード対象のbase64文字列
 * @returns デコードされたバイナリデータ
 */
export function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * バイナリデータ（Uint8Array）をbase64文字列にエンコードします。
 * @param bytes エンコード対象のバイナリデータ
 * @returns エンコードされたbase64文字列
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000; // fromCharCode の引数上限（スタックオーバーフロー）を避けるためにチャンク分割します。
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * ファイルパスの拡張子に基づいて、Content-Typeヘッダーの値を判定します。
 * @param key ファイルパスまたはキー名
 * @returns Content-Typeの文字列
 */
export function contentTypeForKey(key: string): string {
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.json')) return 'application/json';
  if (key.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
}
