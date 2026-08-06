/**
 * @fileoverview 保存を伴わないレシピ描画のルート定義。
 *
 * jar を受け取ってその場で画像を返すだけで、R2 にもインデックスにも何も書きません。
 * 投稿前の確認や、公開するつもりのない jar の確認に使えるため、投稿枠も消費しません。
 *
 * 描画は CPU を使うので、1回のリクエストで扱うレシピ数を区切ります。呼び出し側は
 * `offset` を進めて必要な分だけ取ってください。
 */

import { Hono } from 'hono';
import JSZip from 'jszip';
import { Env } from '../utils/minecraft';
import { verifyToken } from '../utils/auth/tokens';
import { AssetSource } from '../utils/build/asset-source';
import { JarAssetReader } from '../utils/preview/jar-reader';
import { isCraftingType } from '../core/recipe';
import { RECIPE_PATH } from '../core/paths';
import { renderRecipePng, renderRecipeGif, normalizeScale } from '../utils/image-generator';
import { bytesToBase64 } from '../utils/http';
import { runPool } from '../utils/pool';

export const previewRoutes = new Hono<{ Bindings: Env }>();

/** 受け付ける jar の最大サイズ。投稿経路と揃えています。 */
const MAX_JAR_BYTES = 32 * 1024 * 1024;

/** 1回のリクエストで描画するレシピ数の上限。 */
const MAX_PER_REQUEST = 40;

/** 同時に描画する枚数。 */
const RENDER_CONCURRENCY = 4;

/** jar から取り出した1レシピ。 */
type PreviewRecipe = { id: string; data: any };

// jar を受け取り、その場でレシピ画像を返します（保存しません）。
// 例: POST /api/preview?offset=0&limit=40&ext=png&scale=2  （ボディは jar のバイナリ）
previewRoutes.post('/api/preview', async (c) => {
  const token = bearerOf(c);
  const grant = token ? await verifyToken(c.env, token) : null;
  // 保存しない代わりに枠は消費しませんが、描画は CPU を使うため素性は要求します。
  if (!grant) return c.text('Unauthorized', 401);

  const jar = await readJar(c);
  if (!jar) return c.text('Missing or oversized jar', 400);

  const zip = await JSZip.loadAsync(jar).catch(() => null);
  if (!zip) return c.text('Broken jar', 400);

  const all = await collectRecipes(zip);
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0);
  const limit = Math.min(MAX_PER_REQUEST, Math.max(1, parseInt(c.req.query('limit') || '0', 10) || MAX_PER_REQUEST));
  const slice = all.slice(offset, offset + limit);

  const images = await renderAll(c, zip, slice);
  return c.json({
    ok: true,
    total: all.length,
    offset,
    count: slice.length,
    ids: all.map((r) => r.id),
    images,
  });
});

/**
 * 受け取った一群のレシピを描画します。
 * @param c Honoのコンテキストオブジェクト
 * @param zip 展開済みの jar
 * @param recipes 描画するレシピ
 * @returns レシピIDからデータURLへの対応。描画できなかったものは null
 */
async function renderAll(c: any, zip: JSZip, recipes: PreviewRecipe[]): Promise<Record<string, string | null>> {
  const ext = String(c.req.query('ext') || 'png').toLowerCase() === 'gif' ? 'gif' : 'png';
  const scale = normalizeScale(c.req.query('scale'));
  // 保存済みアセットへの落とし先。バニラ素材はここから解決されます。
  const reader = new JarAssetReader(zip, new AssetSource(c.env, null), crypto.randomUUID());

  const images: Record<string, string | null> = {};
  await runPool(recipes, RENDER_CONCURRENCY, async ({ id, data }) => {
    // 1枚の失敗で全体を落とさない。壊れた1レシピのために残りを捨てる方が高くつきます。
    const bytes = await renderOne(data, c.env, ext, scale, reader).catch(() => null);
    const mime = ext === 'gif' ? 'image/gif' : 'image/png';
    images[id] = bytes ? `data:${mime};base64,${bytesToBase64(bytes)}` : null;
  });
  return images;
}

/**
 * 1レシピを描画します。
 * @param data レシピJSON
 * @param env 環境変数
 * @param ext 画像形式
 * @param scale 拡大率
 * @param reader アセット読み出し口
 */
function renderOne(data: any, env: Env, ext: string, scale: number, reader: JarAssetReader): Promise<Uint8Array> {
  if (ext === 'gif') return renderRecipeGif(data, env, 5, scale, reader);
  return renderRecipePng(data, env, 0, scale, reader);
}

/**
 * jar からクラフト系のレシピを取り出します。
 * @param zip 展開済みの jar
 */
async function collectRecipes(zip: JSZip): Promise<PreviewRecipe[]> {
  const found: PreviewRecipe[] = [];

  for (const path of Object.keys(zip.files)) {
    const entry = zip.files[path];
    if (entry.dir) continue;

    const match = path.match(RECIPE_PATH);
    if (!match) continue;

    // 壊れたJSONは飛ばします。1件のために jar 全体を弾く必要はありません。
    const data = await entry.async('string').then((t) => JSON.parse(t)).catch(() => null);
    if (!data || !isCraftingType(data.type)) continue;
    found.push({ id: `${match[1]}:${match[2]}`, data });
  }

  return found.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * リクエストから jar のバイト列を取り出します。
 * @param c Honoのコンテキストオブジェクト
 * @returns バイト列。無い/大きすぎる場合は null
 */
async function readJar(c: any): Promise<Uint8Array | null> {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('jar');
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_JAR_BYTES) return null;
  return new Uint8Array(await file.arrayBuffer());
}

/**
 * 認証ヘッダからトークンを取り出します。
 * @param c Honoのコンテキストオブジェクト
 */
function bearerOf(c: any): string | null {
  const header = c.req.header('Authorization') || '';
  return header.replace(/^Bearer\s+/i, '') || null;
}
