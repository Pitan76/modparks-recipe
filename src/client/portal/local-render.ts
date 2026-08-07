/**
 * @fileoverview ブラウザだけでレシピ画像を組み立てる処理。
 *
 * jar は手元にあるので、その中身をそのまま読み出し口にします。jar に無いもの（`minecraft:` の
 * テクスチャやモデル、`c:` のタグ）だけを外から取ります。
 *
 * 取得は「描いて不足を集め、まとめて取る」の繰り返しです。素材の依存は多段で、タグを読むまで
 * どのアイテムが要るか分からず、そのアイテムのテクスチャはさらにその先にあります。1周で止めると
 * 入力スロットのように段数の多いものが埋まりません。新しい不足が出なくなるまで回します。
 *
 * 描画に何が要るかは実際に描いてみないと分からないうえ、一覧をまるごと配らせると要らないものまで
 * 運ぶことになるため、都度必要な分だけを問い合わせます。R2 直取りなので Worker も起きません。
 *
 * レシピのSVGは文字列として組み立てられるため、ラスタライザ（wasm）は要りません。
 * ブラウザにそのまま渡せば描画されます。
 */

import type { AssetBody, AssetReader } from '../../core/asset-reader';
import { RECIPE_PATH } from '../../core/paths';
import { isCraftingType } from '../../core/recipe';
import { generateRecipeSvg } from '../../utils/image-generator/svg';
import { TRANSPARENT_PNG } from '../../utils/minecraft/texture';
import type { ZipLike } from '../../core/jar-assets';
import { assetKindByRoot, rootPrefix } from '../../core/paths';



/**
 * jar を優先して読み、無いものだけ配信側から引く読み出し口。
 */
class LocalAssetReader implements AssetReader {
  /** 手元の描画なので、永続キャッシュには関わりません。 */
  readonly persistIcons = false;

  /** jar に無く、外から取る必要があったもの。 */
  readonly missing = new Set<string>();

  /** 取得済みの中身。`ns:論理パス` を鍵にします。 */
  private readonly fetched = new Map<string, ArrayBuffer>();

  /** 取りに行った回数。描画側のメモを周回ごとに切り替えるために使います。 */
  private round = 0;

  /**
   * @param zip 展開済みの jar
   */
  constructor(private readonly zip: ZipLike) {}

  /**
   * アセットを読み出します。
   * @param ns ネームスペース
   * @param logicalPath 論理パス（例: `textures/item/foo.png`）
   */
  async get(ns: string, logicalPath: string): Promise<AssetBody | null> {
    const jarKey = this.jarKeyOf(ns, logicalPath);
    const file = jarKey ? this.zip.files[jarKey] : null;
    if (file && !file.dir) {
      return { text: () => file.async('string'), arrayBuffer: () => file.async('arraybuffer') };
    }
    // 手元に無いものは記録だけして、この回は諦めます。まとめて取ってから描き直します。
    const key = `${ns}:${logicalPath}`;
    const body = this.fetched.get(key);
    if (body) return { text: async () => new TextDecoder().decode(body), arrayBuffer: async () => body };

    this.missing.add(key);
    return null;
  }

  /**
   * 記録した不足分の在り処をまとめて問い合わせ、R2 から直接取ります。
   * @returns 取れた件数
   */
  async loadMissing(): Promise<number> {
    const wanted = [...this.missing].filter((key) => !this.fetched.has(key));
    if (wanted.length === 0) return 0;

    const res = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: wanted }),
    }).catch(() => null);
    if (!res || !res.ok) return 0;

    const { base, keys } = (await res.json()) as { base: string; keys: Record<string, string | null> };
    let loaded = 0;
    await Promise.all(
      wanted.map(async (key) => {
        const objectKey = keys[key];
        if (!objectKey || !base) return;
        const body = await fetchBytes(`${base}/${objectKey.split('/').map(encodeURIComponent).join('/')}`);
        if (!body) return;
        this.fetched.set(key, body);
        loaded++;
      })
    );
    if (loaded > 0) this.round++;
    return loaded;
  }

  /**
   * この周回を表す世代を返します。
   *
   * 描画側は「見つからなかった」結果もメモします。素材を取り終えたあとに引き直させるため、
   * 周回が進むたびに別の値を返します。
   */
  async buildOf(): Promise<string | null> {
    return `local-${this.round}`;
  }

  /**
   * 論理パスを jar 内のパスへ変換します。
   * @param ns ネームスペース
   * @param logicalPath 論理パス
   * @returns 対応が無ければ null
   */
  private jarKeyOf(ns: string, logicalPath: string): string | null {
    const slash = logicalPath.indexOf('/');
    if (slash <= 0) return null;

    const root = logicalPath.slice(0, slash);
    const spec = assetKindByRoot(root);
    return spec ? `${rootPrefix(ns, root, spec)}${logicalPath.slice(slash + 1)}` : null;
  }
}

/**
 * 不足を集めて取りに行く回数の上限。
 *
 * タグ→アイテム→テクスチャ、モデル→親モデル→テクスチャ、と辿る段数を吸収できれば足ります。
 * 上限を設けるのは、解決できない参照が残ったときに往復し続けないためです。
 */
const MAX_RESOLVE_ROUNDS = 5;

/** 素材の切り替わりを見せるコマ数の上限。Worker 側の GIF と揃えています。 */
const MAX_FRAMES = 5;

/**
 * レシピの入力スロット数を数えます。
 *
 * 描けたかどうかを判断する基準になります。素材の解決に失敗したスロットは描画側が黙って飛ばすため、
 * 枚数を突き合わせないと「欠けたまま出来上がった絵」を配ってしまいます。
 * @param data レシピJSON
 */
function slotCount(data: any): number {
  const type = String(data?.type ?? '').replace(/^minecraft:/, '');
  if (type === 'crafting_shapeless') {
    return Array.isArray(data.ingredients) ? Math.min(data.ingredients.length, 9) : 0;
  }
  if (type !== 'crafting_shaped' || !Array.isArray(data.pattern)) return 0;

  let slots = 0;
  for (const row of data.pattern.slice(0, 3)) {
    if (typeof row !== 'string') continue;
    for (const ch of row.slice(0, 3)) if (ch !== ' ') slots++;
  }
  return slots;
}

/**
 * 素材がすべて揃った絵かどうかを判定します。
 * @param data レシピJSON
 * @param svg 組み立てた SVG
 */
function isComplete(data: any, svg: string): boolean {
  // 透明で埋まったスロットは「解決できなかった」印です。欠けたまま配らないために弾きます。
  if (svg.includes(TRANSPARENT_PNG)) return false;

  const result = data?.result ?? data?.output;
  // 背景 + 入力スロット + 完成品
  const expected = 1 + slotCount(data) + (result ? 1 : 0);
  return (svg.match(/<image /g) ?? []).length === expected;
}

/**
 * 手元で組み立てた1レシピ。
 *
 * `frames` は素材が切り替わるレシピのコマです。切り替わらないものは1つだけ入ります。
 */
export type LocalRecipe = { id: string; svg: string; frames: string[] };

/** 手元での描画結果。 */
export type LocalRenderResult = {
  /** 素材が揃って描けたもの */
  recipes: LocalRecipe[];
  /** 素材が足りず描けなかったレシピID */
  failed: string[];
};

/**
 * jar からクラフト系のレシピを取り出し、SVGに組み立てます。
 * @param zip 展開済みの jar
 * @param onProgress 進捗の通知
 */
export async function renderJarLocally(
  zip: ZipLike,
  onProgress?: (done: number, total: number) => void
): Promise<LocalRenderResult> {
  const reader = new LocalAssetReader(zip);
  const recipes = await collectRecipes(zip);

  // 描いては不足を取る、を新しい不足が出なくなるまで繰り返します。ここでの描画は結果を捨て、
  // 何が要るかを知るためだけに行います。
  for (let round = 0; round < MAX_RESOLVE_ROUNDS; round++) {
    for (const { data } of recipes) await framesOf(data, reader).catch(() => []);
    if ((await reader.loadMissing()) === 0) break;
  }

  const out: LocalRecipe[] = [];
  const failed: string[] = [];
  let done = 0;
  for (const { id, data } of recipes) {
    const frames = await framesOf(data, reader).catch(() => []);
    // 素材が欠けたものは出しません。中途半端な絵は、無いことより分かりにくい間違いになります。
    if (frames.length > 0 && isComplete(data, frames[0])) out.push({ id, svg: frames[0], frames });
    else failed.push(id);
    onProgress?.(++done, recipes.length);
  }
  return { recipes: out, failed };
}

/**
 * 素材の切り替わりぶんのコマを作ります。
 *
 * タグを展開して構成アイテム数を数える代わりに、実際に描いて絵が変わるかで判断します。
 * 1周して1コマ目に戻った時点で打ち切るため、同じ絵を並べたGIFになりません。
 * @param data レシピJSON
 * @param reader アセット読み出し口
 */
async function framesOf(data: any, reader: AssetReader): Promise<string[]> {
  const frames: string[] = [];

  for (let offset = 0; offset < MAX_FRAMES; offset++) {
    const svg = await generateRecipeSvg(data, null, offset, reader);
    if (offset > 0 && svg === frames[0]) break;
    frames.push(svg);
  }
  return frames;
}

/**
 * jar からクラフト系のレシピを取り出します。
 * @param zip 展開済みの jar
 */
async function collectRecipes(zip: ZipLike): Promise<{ id: string; data: any }[]> {
  const found: { id: string; data: any }[] = [];

  for (const path of Object.keys(zip.files)) {
    const entry = zip.files[path];
    if (entry.dir) continue;

    const match = path.match(RECIPE_PATH);
    if (!match) continue;

    const data = await entry.async('string').then((t) => JSON.parse(t)).catch(() => null);
    if (!data || !isCraftingType(data.type)) continue;
    found.push({ id: `${match[1]}:${match[2]}`, data });
  }

  return found.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * ドット絵が滲まないよう、拡大時の補間を切る指定を差し込みます。
 *
 * SVG が持つのは `image-rendering="optimizeSpeed"` です。SVG 1.1 の値で、ブラウザによっては
 * 補間されます。サーバー側のラスタライザはこの値で正しく動くため書き換えず、ブラウザへ渡すときだけ
 * 現行の指定を上から足します。
 * @param svg SVG文字列
 */
function pixelated(svg: string): string {
  const close = svg.indexOf('>');
  if (close < 0) return svg;
  return `${svg.slice(0, close + 1)}<style>image{image-rendering:pixelated}</style>${svg.slice(close + 1)}`;
}

/**
 * SVG文字列をデータURLにします。
 * @param svg SVG文字列
 */
export function svgDataUrl(svg: string): string {
  svg = pixelated(svg);
  // 日本語などの非ASCIIが混じっても壊れないように、UTF-8として符号化してから base64 にします。
  const utf8 = new TextEncoder().encode(svg);
  let binary = '';
  for (const byte of utf8) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

/**
 * SVGをPNGのデータURLに変換します。
 *
 * アイコンはすべてSVGの中にデータURLとして埋まっているため、外部参照が無く canvas が汚れません。
 * @param svg SVG文字列
 * @param scale 拡大率
 */
export async function svgToPngDataUrl(svg: string, scale: number): Promise<string | null> {
  const image = new Image();
  image.src = svgDataUrl(svg);
  await image.decode().catch(() => undefined);
  if (!image.width) return null;

  const canvas = document.createElement('canvas');
  canvas.width = image.width * scale;
  canvas.height = image.height * scale;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // ドット絵なので、拡大時に補間させません。
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

/**
 * URLの中身をバイト列で読みます。
 * @param url 取得先
 * @returns 取れなければ null
 */
async function fetchBytes(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url);
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}
