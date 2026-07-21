import type { Env } from './minecraft';

// Per-namespace asset version, used to invalidate rendered images.
//
// Deleting cache entries on write can't work here: one texture upload can change
// dozens of recipe images, and each image has a cache entry per query variant
// (`?scale=`, `?tagOffset=`). Instead the version is folded into the cache key,
// so bumping it makes every old entry unreachable at once and they age out on
// their own.

const KEY = (ns: string) => `meta/version/${ns}`;

/** How long a read version is trusted inside one isolate, in ms. */
const MEMO_TTL = 10_000;

const memo = new Map<string, { value: string; readAt: number }>();

/** Current version token for a namespace ('0' when never written). */
export async function getAssetVersion(env: Env, ns: string): Promise<string> {
  const hit = memo.get(ns);
  if (hit && Date.now() - hit.readAt < MEMO_TTL) return hit.value;

  const obj = await env.BUCKET.get(KEY(ns));
  const value = obj ? (await obj.text()).trim() || '0' : '0';
  memo.set(ns, { value, readAt: Date.now() });
  return value;
}

/**
 * Mark a namespace's assets as changed. Call after any write that can alter a
 * rendered image (recipe, texture, model or tag). Takes effect for every client
 * within MEMO_TTL.
 */
export async function bumpAssetVersion(env: Env, ns: string): Promise<void> {
  const value = Date.now().toString(36);
  memo.set(ns, { value, readAt: Date.now() });
  await env.BUCKET.put(KEY(ns), value, {
    httpMetadata: { contentType: 'text/plain' },
  }).catch(() => {});
}
