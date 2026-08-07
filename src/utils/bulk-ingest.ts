/**
 * @fileoverview 1回分の bulk ボディを取り込み、種別ごとの件数を返します。
 *
 * ルート側は認証・枠・セッションの解決とレスポンスの組み立てに専念できます。取り込みそのものは
 * 「誰が呼んだか」に依らないため、ここに閉じています。
 *
 * 安全でないパスや型違いは書かずに数えるだけにします。1件のミスで残り全部を落とすと、投入側は
 * 数百件を再送する羽目になるためです。
 */

import type { Env } from './minecraft';
import { decodeBase64, contentTypeForKey, plainEntries } from './http';
import { putRecipeBody, updateIndexMany, indexEntryOf } from './recipe-store';
import { isCraftingType } from './minecraft';
import { putLang, isValidLocale, isValidLangBody } from './lang-store';
import { putTagBody } from './tag-store';
import { stageEntries, type StagedEntry } from './ingest';
import { PatchCollector } from './build/staging';
import { runPool } from './pool';
import { isSafePath } from './asset-path';
import { assetKind, type AssetKind } from '../core/paths';

/** 取り込みの文脈。 */
export interface BulkContext {
  env: Env;
  namespace: string;
  /** 取り込みセッション。指定時は索引を触らず、追加分をステージングします。 */
  session: string | null;
  /** build を作るセッションでのみ渡します。同じ内容を blob にも積みます。 */
  collector: PatchCollector | null;
}

/** 種別ごとの取り込み件数。レスポンスのJSON形状と一致させています。 */
export interface BulkCounts {
  recipes: number;
  tags: number;
  textures: number;
  models: number;
  items: number;
  langs: number;
  skipped: number;
}

/** 同時に流す本数。保存先が別なので衝突しません。 */
const CONCURRENCY = 20;

/**
 * bulk ボディを取り込みます。
 * @param ctx 取り込みの文脈
 * @param payload リクエストボディ
 * @returns 種別ごとの件数
 */
export async function ingestBulk(ctx: BulkContext, payload: any): Promise<BulkCounts> {
  const counts: BulkCounts = { recipes: 0, tags: 0, textures: 0, models: 0, items: 0, langs: 0, skipped: 0 };

  await ingestRecipes(ctx, payload.recipes, counts);
  await ingestTags(ctx, payload.tags, counts);
  await ingestTextures(ctx, payload.textures, counts);
  await ingestJsonAssets(ctx, payload, counts);
  await ingestLangs(ctx, payload.langs, counts);

  return counts;
}

/** 取り込んだ総数。監査に残す件数です。 */
export function totalOf(counts: BulkCounts): number {
  return counts.recipes + counts.tags + counts.textures + counts.models + counts.items + counts.langs;
}

/**
 * レシピを取り込み、索引へ反映します。
 *
 * セッション中は索引を触らず、commit でまとめて畳みます。投入の途中経過が一覧に出ると、
 * 半分だけ入ったmodが検索に現れます。
 * @param ctx 取り込みの文脈
 * @param entries レシピID -> 中身
 * @param counts 件数の積み先
 */
async function ingestRecipes(ctx: BulkContext, entries: unknown, counts: BulkCounts): Promise<void> {
  const { env, namespace, session, collector } = ctx;
  const indexEntries: { fullId: string; data: any }[] = [];
  const staged: StagedEntry[] = [];

  // 本体の書き込みは他の種別と同じく同時実行で流します。直列だと1件ずつR2の往復を待つことになり、
  // 数十件で呼び出し側の待ち時間を超えます。実際、48件のレシピを送った取り込みが応答を返せず、
  // 送信側からは失敗と見なされたまま commit まで進み、既存のレシピが全部消えたことがあります。
  await runPool(plainEntries(entries), CONCURRENCY, async ([id, val]) => {
    if (!isSafePath(id)) {
      counts.skipped++;
      return;
    }
    const body = typeof val === 'string' ? val : JSON.stringify(val);
    let data: any;
    try { data = JSON.parse(body); } catch { counts.skipped++; return; }

    await putRecipeBody(env, namespace, id, body);
    const fullId = `${namespace}:${id}`;
    const entry = isCraftingType(data?.type) ? indexEntryOf(fullId, data) : null;
    if (collector) {
      await collector.addText(`recipe/${id}.json`, body);
      collector.addRecipe(fullId, entry);
    }
    if (session) staged.push({ id: fullId, entry });
    else indexEntries.push({ fullId, data });
    counts.recipes++;
  });

  // 同時実行なので積まれる順が実行ごとに変わります。並べ直して、同じ入力からは同じ build が
  // 出来るようにします（build ID は内容のハッシュなので、順序が揺れると別物になります）。
  staged.sort((a, b) => a.id.localeCompare(b.id));
  indexEntries.sort((a, b) => a.fullId.localeCompare(b.fullId));

  if (session) await stageEntries(env, namespace, session, staged);
  else await updateIndexMany(env, indexEntries);
}

/**
 * タグを取り込みます。
 *
 * 共有ネームスペースでは1件ごとに既存を読んで統合するため、直列だと往復が積み上がります。
 * @param ctx 取り込みの文脈
 * @param entries タグパス -> 中身
 * @param counts 件数の積み先
 */
async function ingestTags(ctx: BulkContext, entries: unknown, counts: BulkCounts): Promise<void> {
  await runPool(plainEntries(entries), CONCURRENCY, async ([path, val]) => {
    if (!isSafePath(path)) {
      counts.skipped++;
      return;
    }
    const body = typeof val === 'string' ? val : JSON.stringify(val);
    try { JSON.parse(body); } catch { counts.skipped++; return; }

    const id = path.replace(/\.json$/, '');
    const stored = await putTagBody(ctx.env, ctx.namespace, id, body);
    if (ctx.collector) await ctx.collector.addText(`tags/${id}.json`, stored);
    counts.tags++;
  });
}

/**
 * テクスチャを取り込みます。中身は base64 で届きます。
 * @param ctx 取り込みの文脈
 * @param entries テクスチャパス -> base64
 * @param counts 件数の積み先
 */
async function ingestTextures(ctx: BulkContext, entries: unknown, counts: BulkCounts): Promise<void> {
  await runPool(plainEntries(entries), CONCURRENCY, async ([path, b64]) => {
    if (!isSafePath(path) || typeof b64 !== 'string') {
      counts.skipped++;
      return;
    }
    const key = `assets/${ctx.namespace}/textures/${path}`;
    const bytes = decodeBase64(b64);
    const contentType = contentTypeForKey(key);
    await ctx.env.BUCKET.put(key, bytes, { httpMetadata: { contentType } });
    if (ctx.collector) await ctx.collector.addBinary(`textures/${path}`, bytes, contentType);
    counts.textures++;
  });
}

/**
 * JSON をそのまま論理パスへ落とすだけの種別を取り込みます。
 *
 * 増えても書き方は変わらないので種別表を回します。`items`（1.21.4+ のアイテム定義）は
 * `models/item/<id>.json` を持たないアイテム（時計・コンパス・ベッド・頭部）にとって唯一の
 * 見た目の起点で、モデルとは別に保存する必要があります。
 * @param ctx 取り込みの文脈
 * @param payload リクエストボディ
 * @param counts 件数の積み先
 */
async function ingestJsonAssets(ctx: BulkContext, payload: any, counts: BulkCounts): Promise<void> {
  const kinds: AssetKind[] = ['models', 'items'];

  for (const kind of kinds) {
    const root = assetKind(kind).root;
    await runPool(plainEntries(payload[kind]), CONCURRENCY, async ([path, val]) => {
      if (!isSafePath(path)) {
        counts.skipped++;
        return;
      }
      const rel = `${root}/${path.replace(/\.json$/, '')}.json`;
      const json = typeof val === 'string' ? val : JSON.stringify(val);
      await ctx.env.BUCKET.put(`assets/${ctx.namespace}/${rel}`, json, {
        httpMetadata: { contentType: 'application/json' },
      });
      if (ctx.collector) await ctx.collector.addText(rel, json);
      counts[kind]++;
    });
  }
}

/**
 * 言語ファイルを取り込みます。
 * @param ctx 取り込みの文脈
 * @param entries ロケール -> 中身
 * @param counts 件数の積み先
 */
async function ingestLangs(ctx: BulkContext, entries: unknown, counts: BulkCounts): Promise<void> {
  for (const [locale, val] of plainEntries(entries)) {
    const body = typeof val === 'string' ? val : JSON.stringify(val);
    if (!isValidLocale(locale) || !isValidLangBody(body)) {
      counts.skipped++;
      continue;
    }
    await putLang(ctx.env, ctx.namespace, locale, body);
    if (ctx.collector) await ctx.collector.addText(`lang/${locale}.json`, body);
    counts.langs++;
  }
}
