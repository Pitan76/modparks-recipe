// Where a pipeline script sends its output.
//
// By default it talks to R2 directly over S3, which needs the R2 access keys.
// Setting MP_RECIPE_URL switches to the Worker's authenticated bulk write API
// instead, which only needs the upload secret — useful for running a pipeline
// from a machine that has no R2 credentials.

import dotenv from 'dotenv';
import { uploadToR2, runPool } from './r2';

dotenv.config();

const API_URL = process.env.MP_RECIPE_URL?.replace(/\/$/, '');
const SECRET = process.env.UPLOAD_SECRET || process.env.ADMIN_SECRET;

/** How many objects go in one bulk request when uploading over HTTP. */
const BATCH_SIZE = 50;

export function describeTarget(): string {
  return API_URL ? `write API at ${API_URL}` : 'R2 (S3 credentials)';
}

/** `assets/<ns>/textures/<path>` -> the parts the bulk API expects. */
function splitTextureKey(key: string): { ns: string; path: string } | null {
  const m = /^assets\/([^/]+)\/textures\/(.+)$/.exec(key);
  return m ? { ns: m[1], path: m[2] } : null;
}

async function uploadViaApi(items: { key: string; body: Buffer }[], onProgress?: (done: number) => void): Promise<void> {
  // The bulk endpoint is per namespace, so group first.
  const byNs = new Map<string, Record<string, string>>();
  for (const { key, body } of items) {
    const parts = splitTextureKey(key);
    if (!parts) throw new Error(`Not a texture key, cannot upload over HTTP: ${key}`);
    const bucket = byNs.get(parts.ns) || {};
    bucket[parts.path] = body.toString('base64');
    byNs.set(parts.ns, bucket);
  }

  let done = 0;
  for (const [ns, textures] of byNs) {
    const paths = Object.keys(textures);
    for (let i = 0; i < paths.length; i += BATCH_SIZE) {
      const batch: Record<string, string> = {};
      for (const p of paths.slice(i, i + BATCH_SIZE)) batch[p] = textures[p];
      const res = await fetch(`${API_URL}/api/${ns}/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
        body: JSON.stringify({ textures: batch }),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      done += Object.keys(batch).length;
      onProgress?.(done);
    }
  }
}

/** Upload every item, using whichever target is configured. */
export async function uploadAll(
  items: { key: string; body: Buffer }[],
  onProgress?: (done: number) => void
): Promise<void> {
  if (API_URL) {
    if (!SECRET) throw new Error('MP_RECIPE_URL is set but UPLOAD_SECRET/ADMIN_SECRET is not.');
    return uploadViaApi(items, onProgress);
  }

  let done = 0;
  await runPool(items, 20, async ({ key, body }) => {
    await uploadToR2(key, body);
    onProgress?.(++done);
  });
}
