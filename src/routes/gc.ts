/**
 * @fileoverview 参照されなくなった build と blob を掃除する管理ルート。
 *
 * 1リクエストで全部やろうとするとCPU時間に当たるため、ネームスペース単位と blob 全体で分けています。
 * blob の掃除は全ネームスペースの生存 build を畳んでから走るので、最も重い操作です。
 */

import { Hono } from 'hono';
import { Env } from '../utils/minecraft';
import { isValidNamespace } from '../utils/asset-path';
import { pruneVersions } from '../utils/build/channels';
import { listNamespaces, sweepBlobs, sweepBuilds, UNVERIFIED_KEEP } from '../utils/build/gc';
import { getOwnership } from '../utils/auth/ownership';

export const gcRoutes = new Hono<{ Bindings: Env }>();

/**
 * 管理者シークレットを検証します。
 * @param c Honoのコンテキスト
 */
function isAdmin(c: any): boolean {
  return !!c.env.ADMIN_SECRET && c.req.query('secret') === c.env.ADMIN_SECRET;
}

/** build を持つネームスペースの一覧。掃除の対象を外から回すために公開します。 */
gcRoutes.get('/admin/gc/namespaces', async (c) => {
  if (!isAdmin(c)) return c.text('Unauthorized', 401);
  return c.json({ namespaces: await listNamespaces(c.env) });
});

// 1ネームスペース分の掃除。unverified は別名表を直近5版へ切り詰めてから走らせます。
gcRoutes.post('/admin/gc/:namespace', async (c) => {
  if (!isAdmin(c)) return c.text('Unauthorized', 401);
  const { namespace } = c.req.param();
  if (!isValidNamespace(namespace)) return c.text('Invalid namespace', 400);

  const ownership = await getOwnership(c.env, namespace);
  const pruned = ownership?.trust === 'unverified' ? await pruneVersions(c.env, namespace, UNVERIFIED_KEEP) : 0;
  const builds = await sweepBuilds(c.env, namespace);

  return c.json({ ok: true, namespace, prunedVersions: pruned, builds });
});

// 参照されない blob の掃除。全ネームスペースを見るため、ネームスペース単位の掃除の後に1回だけ回します。
gcRoutes.post('/admin/gc/blobs', async (c) => {
  if (!isAdmin(c)) return c.text('Unauthorized', 401);
  return c.json({ ok: true, blobs: await sweepBlobs(c.env) });
});
