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
  return secretEquals(token, c.env.UPLOAD_SECRET) || secretEquals(token, c.env.ADMIN_SECRET);
}

/**
 * シークレットを一定時間で比較します。
 * `===` は最初に食い違ったバイトで抜けるため、応答時間の差から先頭から1文字ずつ
 * 突き止められます。長さの違いは秘匿しません（長さ自体は秘密ではないため）。
 * @param given リクエストが提示した値
 * @param expected 期待するシークレット（未設定なら常に不一致）
 */
function secretEquals(given: string, expected: string | undefined): boolean {
  if (!expected || given.length !== expected.length) return false;

  let diff = 0;
  for (let i = 0; i < given.length; i++) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * リクエストボディの一部を「キー -> 値」のマップとして取り出します。
 *
 * 素の `Object.entries` に文字列を渡すと1文字ずつ回り、配列を渡すと添字がキーになります。
 * 送信側の型ミスがそのままR2への奇妙な書き込みに化けるため、素直なオブジェクト以外は空にします。
 * @param value 検証対象の値
 * @returns [キー, 値] の配列。オブジェクトでなければ空配列
 */
export function plainEntries(value: unknown): [string, unknown][] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>);
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
