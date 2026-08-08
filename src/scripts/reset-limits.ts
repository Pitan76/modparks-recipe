/**
 * @fileoverview 投稿の上限（日次枠と namespace 所有）を確認・解除する実行スクリプト。
 *
 * Worker 側の `/admin/limits*` を叩きます。上限は投稿を止める側の仕組みなので、詰まったときに
 * 中身を見てから戻せないと、原因が日次枠なのか namespace 所有なのか判別できません。
 * まず状況を出し、指示があったときだけ解除します。
 *
 * 使い方:
 *   MP_RECIPE_URL=... ADMIN_SECRET=... tsx src/scripts/reset-limits.ts <identityId>
 *   ... tsx src/scripts/reset-limits.ts <identityId> --quota
 *   ... tsx src/scripts/reset-limits.ts <identityId> --namespaces
 *   ... tsx src/scripts/reset-limits.ts --ns techreborn
 */

import dotenv from 'dotenv';

// このリポジトリはシークレットを .dev.vars に置くため、そちらも読む。
// dotenv は既存の環境変数を上書きしないので、コマンドラインでの指定が常に優先される。
dotenv.config();
dotenv.config({ path: '.dev.vars' });

const API_URL = process.env.MP_RECIPE_URL?.replace(/\/$/, '');
const SECRET = process.env.ADMIN_SECRET;

/** 所有している namespace の1件。 */
type OwnedNamespace = { ns: string; trust: string; claimed_at: string };

/**
 * 管理APIを叩きます。
 * @param path `/admin/...` から始まるパス
 * @param params クエリ
 */
async function callAdmin(path: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${API_URL}${path}`);
  url.searchParams.set('secret', SECRET!);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * 必要な環境変数が揃っているかを確かめます。
 * @throws 欠けている変数がある場合
 */
function requireEnv(): void {
  const missing = [
    !API_URL && 'MP_RECIPE_URL (worker URL, e.g. http://localhost:8787)',
    !SECRET && 'ADMIN_SECRET (read from .dev.vars)',
  ].filter(Boolean);

  if (missing.length > 0) throw new Error(`Missing: ${missing.join(', ')}`);
}

/** コマンドラインの指定。 */
type Options = { identityId: string | null; ns: string | null; quota: boolean; namespaces: boolean };

/**
 * 引数を読み取ります。
 * @param argv `process.argv.slice(2)`
 */
function parseArgs(argv: string[]): Options {
  const nsAt = argv.indexOf('--ns');
  const ns = nsAt >= 0 ? argv[nsAt + 1] ?? null : null;
  // フラグと、`--ns` の値を除いた最初の位置引数が identity。
  const positional = argv.filter((a, i) => !a.startsWith('--') && i !== nsAt + 1);

  return {
    identityId: positional[0] ?? null,
    ns,
    quota: argv.includes('--quota'),
    namespaces: argv.includes('--namespaces'),
  };
}

/**
 * identity の上限の状況を表示します。
 * @param identityId 主体のID
 */
async function showLimits(identityId: string): Promise<void> {
  const limits = await callAdmin('/admin/limits', { identity: identityId });
  console.log(`identity: ${identityId}`);
  console.log(`  daily uploads used (${limits.day}): ${limits.used}`);
  console.log(`  namespaces owned: ${limits.namespaces.length}`);
  for (const owned of limits.namespaces as OwnedNamespace[]) {
    console.log(`    ${owned.ns} (${owned.trust}) ${owned.claimed_at}`);
  }
}

/**
 * エントリポイント。
 */
async function main(): Promise<void> {
  requireEnv();
  const opts = parseArgs(process.argv.slice(2));

  // ns 単位の解除は identity を知らなくても打てるようにする。
  // 「この namespace を空けたい」という用途では、持ち主が誰かは分からないことが多い。
  if (opts.ns) {
    const released = await callAdmin('/admin/limits/release', { ns: opts.ns });
    console.log(`released ${opts.ns}: ${released.released} row(s)`);
    return;
  }

  if (!opts.identityId) throw new Error('Usage: tsx src/scripts/reset-limits.ts <identityId> [--quota] [--namespaces]');
  await showLimits(opts.identityId);

  if (opts.quota) {
    const reset = await callAdmin('/admin/limits/reset-quota', { identity: opts.identityId });
    console.log(`reset daily quota: ${reset.deleted} row(s)`);
  }

  // verified は正規の作者が確認を通して得たものなので剥がさない。
  if (opts.namespaces) {
    const released = await callAdmin('/admin/limits/release', {
      identity: opts.identityId,
      trust: 'unverified',
    });
    console.log(`released unverified namespaces: ${released.released} row(s)`);
  }

  if (!opts.quota && !opts.namespaces) console.log('(nothing changed; pass --quota and/or --namespaces)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
