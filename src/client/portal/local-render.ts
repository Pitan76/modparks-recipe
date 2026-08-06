/**
 * @fileoverview ブラウザだけでレシピ画像を組み立てる処理。
 *
 * jar は手元にあるので、その中身をそのまま読み出し口にします。jar に無いもの（`minecraft:` の
 * テクスチャやモデル、`c:` のタグ）だけを配信側から引きます。サーバは素材を返すだけで、
 * 描画そのものは行いません。
 *
 * レシピのSVGは文字列として組み立てられるため、ラスタライザ（wasm）は要りません。
 * ブラウザにそのまま渡せば描画されます。
 */

import type { AssetBody, AssetReader } from '../../core/asset-reader';
import { RECIPE_PATH } from '../../core/paths';
import { isCraftingType } from '../../core/recipe';
import { generateRecipeSvg } from '../../utils/image-generator/svg';
import type { ZipLike } from '../../core/jar-assets';

/** 論理パスから jar 内のパスを組み立てるための対応。 */
const ROOTS: Record<string, (ns: string) => string> = {
  textures: (ns) => `assets/${ns}/textures/`,
  models: (ns) => `assets/${ns}/models/`,
  lang: (ns) => `assets/${ns}/lang/`,
  recipe: (ns) => `data/${ns}/recipe/`,
  recipes: (ns) => `data/${ns}/recipes/`,
  tags: (ns) => `data/${ns}/tags/`,
};

/**
 * jar を優先して読み、無いものだけ配信側から引く読み出し口。
 */
class LocalAssetReader implements AssetReader {
  /** 手元の描画なので、永続キャッシュには関わりません。 */
  readonly persistIcons = false;

  private readonly remote = new Map<string, Promise<AssetBody | null>>();

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
    const key = this.jarKeyOf(ns, logicalPath);
    const file = key ? this.zip.files[key] : null;
    if (file && !file.dir) {
      return { text: () => file.async('string'), arrayBuffer: () => file.async('arraybuffer') };
    }
    return this.fetchRemote(ns, logicalPath);
  }

  /** 手元の jar は build を持たないため、常に固定の世代になります。 */
  async buildOf(): Promise<string | null> {
    return null;
  }

  /**
   * 配信側から引きます。空振りも含めて覚え、同じ問い合わせを繰り返しません。
   * @param ns ネームスペース
   * @param logicalPath 論理パス
   */
  private fetchRemote(ns: string, logicalPath: string): Promise<AssetBody | null> {
    const cacheKey = `${ns}/${logicalPath}`;
    let pending = this.remote.get(cacheKey);
    if (pending) return pending;

    pending = (async () => {
      const res = await fetch(`/api/${encodeURIComponent(ns)}/asset/${logicalPath}`).catch(() => null);
      if (!res || !res.ok) return null;

      const buffer = await res.arrayBuffer();
      return { text: async () => new TextDecoder().decode(buffer), arrayBuffer: async () => buffer };
    })();
    this.remote.set(cacheKey, pending);
    return pending;
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

    const root = ROOTS[logicalPath.slice(0, slash)];
    return root ? `${root(ns)}${logicalPath.slice(slash + 1)}` : null;
  }
}

/** 手元で組み立てた1レシピ。 */
export type LocalRecipe = { id: string; svg: string };

/**
 * jar からクラフト系のレシピを取り出し、SVGに組み立てます。
 * @param zip 展開済みの jar
 * @param onProgress 進捗の通知
 */
export async function renderJarLocally(
  zip: ZipLike,
  onProgress?: (done: number, total: number) => void
): Promise<LocalRecipe[]> {
  const reader = new LocalAssetReader(zip);
  const recipes = await collectRecipes(zip);

  const out: LocalRecipe[] = [];
  let done = 0;
  for (const { id, data } of recipes) {
    // 1件の失敗で全体を捨てず、描けたものだけ返します。
    const svg = await generateRecipeSvg(data, null, 0, reader).catch(() => null);
    if (svg) out.push({ id, svg });
    onProgress?.(++done, recipes.length);
  }
  return out;
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
 * SVG文字列をデータURLにします。
 * @param svg SVG文字列
 */
export function svgDataUrl(svg: string): string {
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
