/**
 * @fileoverview 参照されなくなった build と blob を掃除する実行スクリプト。
 *
 * Worker 側の `/admin/gc/*` を、ネームスペース分回してから blob 掃除を1回だけ走らせます。
 * blob は全ネームスペースの生存 build を見るため、必ず最後に回す必要があります。
 *
 * 使い方:
 *   MP_RECIPE_URL=... ADMIN_SECRET=... tsx src/scripts/gc-builds.ts [ns...]
 */

import dotenv from 'dotenv';

// このリポジトリはシークレットを .dev.vars に置くため、そちらも読む。
// dotenv は既存の環境変数を上書きしないので、コマンドラインでの指定が常に優先される。
dotenv.config();
dotenv.config({ path: '.dev.vars' });

const API_URL = process.env.MP_RECIPE_URL?.replace(/\/$/, '');
const SECRET = process.env.ADMIN_SECRET;

/**
 * 管理APIを叩きます。
 * @param path `/admin/...` から始まるパス
 * @param method HTTPメソッド
 */
async function callAdmin(path: string, method: 'GET' | 'POST'): Promise<any> {
  const url = new URL(`${API_URL}${path}`);
  url.searchParams.set('secret', SECRET!);

  const res = await fetch(url, { method });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
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

  const requested = process.argv.slice(2);
  const namespaces = requested.length > 0 ? requested : (await callAdmin('/admin/gc/namespaces', 'GET')).namespaces;
  console.log(`Sweeping ${namespaces.length} namespace(s)`);

  for (const ns of namespaces) {
    const result = await callAdmin(`/admin/gc/${ns}`, 'POST');
    console.log(`  ${ns}: builds ${result.builds.deleted}/${result.builds.scanned} deleted, versions pruned ${result.prunedVersions}`);
  }

  // ネームスペース単位の掃除で参照が外れた分も、この1回で回収される。
  const blobs = await callAdmin('/admin/gc/blobs', 'POST');
  console.log(`  blobs: ${blobs.blobs.deleted}/${blobs.blobs.scanned} deleted`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
