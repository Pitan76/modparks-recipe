/**
 * @fileoverview 内容ハッシュ。blob のキー、build ID、解決スナップショットの rid を同じ規則で作ります。
 */

/**
 * バイト列の SHA-256 を16進文字列で返します。
 * @param bytes 対象のバイト列
 */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const source = bytes instanceof Uint8Array ? toArrayBuffer(bytes) : bytes;
  const digest = await crypto.subtle.digest('SHA-256', source);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 文字列の SHA-256 を16進文字列で返します。
 * @param text 対象の文字列
 */
export async function sha256Text(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text));
}

/**
 * キー順に依存しないJSON文字列を作ります。
 *
 * 素の `JSON.stringify` はキーの挿入順をそのまま出すため、同じ内容でも取り込み順が違うだけで
 * ハッシュが変わり、重複排除が効かなくなります。
 * @param value 対象の値
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/**
 * 内容から一意なIDを作ります（build ID と rid の共通実装）。
 * @param value ハッシュ対象の内容
 */
export async function contentId(value: unknown): Promise<string> {
  return sha256Text(canonicalJson(value));
}

/**
 * 内容から短いトークンを同期的に作ります（解決スナップショットの `rid` 用）。
 *
 * `crypto.subtle` は非同期のため、read-modify-write の `mutate` の中では使えません。
 * `rid` はキャッシュを切り替えるためのトークンでしかなく秘匿性を要求しないので、
 * 衝突しにくい同期ハッシュで十分です。
 * @param value ハッシュ対象の内容
 */
export function syncContentId(value: unknown): string {
  const text = canonicalJson(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

/**
 * `Uint8Array` を、その要素だけを指す `ArrayBuffer` に変換します。
 *
 * サブアレイをそのまま `buffer` として渡すと元の領域全体がハッシュされます。
 * @param bytes 対象のバイト列
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
