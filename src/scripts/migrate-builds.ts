/**
 * @fileoverview 既存のフラットなアセットを build へ移行する実行スクリプト。
 *
 * Worker 側の `/admin/migrate/:ns/{begin,step,finish}` を、対象ネームスペース分だけ回します。
 * step はCPU時間の都合で刻む必要があり、その繰り返しをここが受け持ちます。
 *
 * 使い方:
 *   MP_RECIPE_URL=... ADMIN_SECRET=... tsx src/scripts/migrate-builds.ts <mcVersion> [ns...]
 * ネームスペースを省略すると `/api/list.json` が返す全ネームスペースが対象になります。
 */

import dotenv from 'dotenv';

// このリポジトリはシークレットを .dev.vars に置くため、そちらも読む。
// dotenv は既存の環境変数を上書きしないので、コマンドラインでの指定が常に優先される。
dotenv.config();
dotenv.config({ path: '.dev.vars' });

const API_URL = process.env.MP_RECIPE_URL?.replace(/\/$/, '');
const SECRET = process.env.ADMIN_SECRET;

/** 1 step あたりに処理させるオブジェクト数。多すぎるとWorker側のCPU時間に当たります。 */
const STEP_LIMIT = 200;

/**
 * 管理APIを叩きます。
 * @param path `/admin/...` から始まるパス
 * @param params 追加のクエリパラメータ
 */
async function callAdmin(path: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${API_URL}${path}`);
  url.searchParams.set('secret', SECRET!);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * 移行対象のネームスペース一覧を取得します。
 */
async function listNamespaces(): Promise<string[]> {
  const res = await fetch(`${API_URL}/api/list.json`);
  if (!res.ok) throw new Error(`list.json failed: ${res.status}`);

  const body = (await res.json()) as { versions?: Record<string, string> };
  return Object.keys(body.versions ?? {}).sort();
}

/**
 * 1ネームスペースを移行します。
 * @param ns ネームスペース
 * @param mc 移行先のMCバージョン
 */
async function migrateNamespace(ns: string, mc: string): Promise<void> {
  const { session } = await callAdmin(`/admin/migrate/${ns}/begin`, { mc });

  let cursor: string | null = null;
  let total = 0;
  do {
    const step: { processed: number; cursor: string | null } = await callAdmin(`/admin/migrate/${ns}/step`, {
      session,
      limit: String(STEP_LIMIT),
      ...(cursor ? { cursor } : {}),
    });
    total += step.processed;
    cursor = step.cursor;
    process.stdout.write(`\r  ${ns}: ${total} objects`);
  } while (cursor);

  const done = await callAdmin(`/admin/migrate/${ns}/finish`, { session });
  console.log(`\r  ${ns}: ${total} objects -> build ${done.build.buildId.slice(0, 12)} (${done.stagedRecipes} recipes)`);
}

/**
 * エントリポイント。
 */
async function main(): Promise<void> {
  if (!API_URL || !SECRET) {
    throw new Error(
      'MP_RECIPE_URL and ADMIN_SECRET are required. ' +
        'ADMIN_SECRET is read from .dev.vars; set MP_RECIPE_URL to the deployed worker URL.'
    );
  }

  const [mc, ...rest] = process.argv.slice(2);
  if (!mc) throw new Error('Usage: migrate-builds.ts <mcVersion> [ns...]');

  const namespaces = rest.length > 0 ? rest : await listNamespaces();
  console.log(`Migrating ${namespaces.length} namespace(s) to MC ${mc}`);

  for (const ns of namespaces) {
    await migrateNamespace(ns, mc);
  }
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
