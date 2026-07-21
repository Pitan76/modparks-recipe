// HTTP / encoding helpers shared across the write and image APIs.

/**
 * Bearer token (Authorization header) or ?secret= must match UPLOAD_SECRET or
 * ADMIN_SECRET. Either is accepted: ADMIN_SECRET already grants the destructive
 * admin routes, so honouring it here widens nothing, and it keeps maintenance
 * scripts working against a `wrangler dev --remote` session, where .dev.vars can
 * override one secret but not the other.
 */
export function authorized(c: any): boolean {
  const header = c.req.header('Authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '') || c.req.query('secret') || '';
  if (!token) return false;
  return token === c.env.UPLOAD_SECRET || token === c.env.ADMIN_SECRET;
}

export function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000; // avoid arg-count limits on fromCharCode
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function contentTypeForKey(key: string): string {
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.json')) return 'application/json';
  if (key.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
}
