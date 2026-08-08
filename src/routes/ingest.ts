/**
 * @fileoverview 取り込みセッション（begin / commit / abort）のルート定義。
 *
 * 分割送信される bulk を1つの論理トランザクションとして扱うためのAPIです。
 * 実際のステージングと確定処理は utils/ingest.ts と utils/recipe-store.ts が持ちます。
 */

import { Hono } from 'hono';
import { Env } from '../utils/minecraft';
import { requireWrite } from '../utils/auth/guard';
import { upsertIndexEntries, type IndexEntry } from '../utils/recipe-store';
import { bumpAssetVersion } from '../utils/cache-version';
import { beginIngest, readIngestMeta, collectStaged, cleanupIngest, type IngestBuildInfo } from '../utils/ingest';
import { isValidNamespace } from '../utils/asset-path';
import { isSharedNamespace } from '../core/namespaces';
import { consumeUploadQuota } from '../utils/auth/quota';
import { toChannels } from '../utils/build/mc-version';
import { finalizeBuild } from '../utils/build/commit';
import { recordUpload } from '../utils/audit';

export const ingestRoutes = new Hono<{ Bindings: Env }>();


// 取り込みセッションを開始します。以降の bulk は ?session= を付けて送り、最後に commit します。
// ボディで対象MCバージョンなどを渡すと、commit 時に build として確定します（省略時は旧来の取り込み）。
ingestRoutes.post('/api/:namespace/ingest/begin', async (c) => {
  const { namespace } = c.req.param();
  if (!isValidNamespace(namespace)) return c.text('Invalid namespace', 400);

  const grant = await requireWrite(c, namespace);
  if (grant instanceof Response) return grant;

  // 枠はセッション単位で数えます。bulk 側はセッション中を数えないため、ここが唯一の消費点です。
  // 共有ネームスペースは投稿者の持ち物ではないので数えません（1つの jar で二重に引かれるため）。
  if (grant.identityId && !isSharedNamespace(namespace)) {
    if (!(await consumeUploadQuota(c.env, grant.identityId))) return c.text('Daily upload limit reached', 429);
  }

  const body = await c.req.json().catch(() => null);
  // trust は投入側の申告ではなく認証結果で決める。自己申告を信じると unverified が verified を名乗れる。
  //
  // 共有ネームスペースは build にしない。build は「この版の中身はこれで全部」という宣言なので、
  // 多数の mod とバニラが書き足し続ける ns に当てると、1本の jar が持っていた断片が全体を
  // 名乗ってしまう。実際 `minecraft` にタグ9件の build が作られ、バニラのテクスチャ約1500件が
  // 「無いもの」として読めなくなり、全 mod のレシピ画像が空になった。
  const build = isSharedNamespace(namespace) ? undefined : buildInfoOf(body, grant.trust);
  const session = await beginIngest(c.env, namespace, build);
  return c.json({ ok: true, namespace, session, build: build ?? null });
});

/**
 * begin のボディから build の素性を組み立てます。
 *
 * 解釈できるMCバージョンが1つも無ければ build を作りません。チャネルに載せられない build は
 * 誰からも解決されず、ストレージを消費するだけになるためです。
 * @param body リクエストボディ
 * @param trust 認証結果から決まる信頼度
 * @returns build の素性。作らない場合は undefined
 */
function buildInfoOf(body: any, trust: IngestBuildInfo['trust']): IngestBuildInfo | undefined {
  const mcChannels = toChannels(Array.isArray(body?.mcVersions) ? body.mcVersions.map(String) : []);
  if (mcChannels.length === 0) return undefined;

  return {
    mcChannels,
    modVersion: typeof body.modVersion === 'string' ? body.modVersion : null,
    loader: typeof body.loader === 'string' ? body.loader : null,
    trust,
    source: typeof body.source === 'string' ? body.source : null,
    full: body.full !== false,
  };
}

// 取り込みセッションを確定します。ステージング分をインデックスへ1回でマージし、バージョンを1回だけ上げます。
ingestRoutes.post('/api/:namespace/ingest/commit', async (c) => {
  const { namespace } = c.req.param();
  if (!isValidNamespace(namespace)) return c.text('Invalid namespace', 400);

  const grant = await requireWrite(c, namespace);
  if (grant instanceof Response) return grant;

  const session = c.req.query('session');
  if (!session) return c.text('Missing session', 400);

  const meta = await readIngestMeta(c.env, namespace, session);
  if (!meta) return c.text('Unknown or expired ingest session', 409);

  // build は索引より先に確定させる。索引だけ進んで build が失敗すると、
  // 一覧に出るのに描画できないレシピが残るため。
  const build = meta.build ? await finalizeBuild(c.env, namespace, session, meta.build) : null;

  const staged = await collectStaged(c.env, namespace, session);
  // `!!e` なのは、デプロイを跨いだセッションに旧形式の断片が残りうるため。
  // 形が違えば索引に載せず、IDだけ除去対象として扱う（次の取り込みで載り直す）。
  const indexed = staged.map((s) => s.entry).filter((e): e is IndexEntry => !!e);
  await upsertIndexEntries(c.env, staged.map((s) => s.id), indexed);
  await bumpAssetVersion(c.env, namespace);
  await cleanupIngest(c.env, namespace, session);
  await recordUpload(c.env, {
    identityId: grant.identityId, ns: namespace, source: 'commit',
    items: staged.length, buildId: build?.buildId ?? null,
  });

  return c.json({ ok: true, namespace, committed: staged.length, indexed: indexed.length, build });
});

// 取り込みセッションを破棄します（ステージング分を捨て、インデックスもバージョンも変更しません）。
ingestRoutes.post('/api/:namespace/ingest/abort', async (c) => {
  const { namespace } = c.req.param();
  if (!isValidNamespace(namespace)) return c.text('Invalid namespace', 400);

  const grant = await requireWrite(c, namespace);
  if (grant instanceof Response) return grant;

  const session = c.req.query('session');
  if (!session) return c.text('Missing session', 400);
  await cleanupIngest(c.env, namespace, session);
  return c.json({ ok: true, namespace, aborted: true });
});
