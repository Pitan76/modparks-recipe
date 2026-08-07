/**
 * @fileoverview jar 内アセットのパス規則。
 *
 * クライアント側の抽出（ブラウザで jar を展開する経路）と、サーバ側の抽出
 * （jar を丸ごと受け取る経路）で同じ規則を使うための唯一の出所です。
 * 片方だけが新しいディレクトリ名に対応する、という食い違いを防ぎます。
 */

/** data/<ns>/recipe(s)/<id>.json。1.21 以降は単数形の `recipe/`。 */
export const RECIPE_PATH = /^data\/([^/]+)\/recipes?\/(.+)\.json$/;

/**
 * レシピの素材解決で実際に読むタグのディレクトリ。単数形・複数形はMCの版によって使い分けられます。
 *
 * `worldgen` や `enchantment` など他の種別のタグも jar には入っていますが、クラフト画像の描画では
 * 引かれることがありません。取り込み側もここに合わせ、読まれないものを溜めないようにします。
 */
export const TAG_DIRS = ['item', 'items', 'block', 'blocks'];

/** data/<ns>/tag(s)/<種別>/<id>.json。`id` は `item/planks` のように種別を含みます。 */
export const TAG_PATH = new RegExp(`^data/([^/]+)/tags?/((?:${TAG_DIRS.join('|')})/.+)\\.json$`);

/** assets/<ns>/textures/(item|block)/<id>.png */
export const TEXTURE_PATH = /^assets\/([^/]+)\/textures\/((?:item|block)\/.+)\.png$/;

/** assets/<ns>/models/(item|block)/<id>.json */
export const MODEL_PATH = /^assets\/([^/]+)\/models\/((?:item|block)\/.+)\.json$/;

/**
 * assets/<ns>/items/<id>.json。1.21.4 以降のアイテムモデル定義。
 *
 * ここが見た目の起点で、`models/item/<id>.json` を持たないアイテム（時計・コンパス・ベッド・頭部）が
 * あるため、モデルとは別に取り込む必要があります。
 */
export const ITEM_DEF_PATH = /^assets\/([^/]+)\/items\/(.+)\.json$/;

/** assets/<ns>/lang/<locale>.json */
export const LANG_PATH = /^assets\/([^/]+)\/lang\/([a-z]{2,8}(?:_[a-z0-9]{2,8})?)\.json$/;

/** 抽出対象の種別。bulk 投入APIのボディのキーと一致させています。 */
export type AssetKind = 'recipes' | 'tags' | 'textures' | 'models' | 'items' | 'langs';

/** パスを種別・ネームスペース・種別内IDに分解した結果。 */
export interface ClassifiedAsset {
  kind: AssetKind;
  namespace: string;
  /** 種別ごとのID。テクスチャは拡張子を含まず、呼び出し側で付け直します。 */
  id: string;
}

/** 判定順に並べた規則表。先に一致したものを採用します。 */
const RULES: readonly [AssetKind, RegExp][] = [
  ['recipes', RECIPE_PATH],
  ['tags', TAG_PATH],
  ['textures', TEXTURE_PATH],
  ['models', MODEL_PATH],
  ['items', ITEM_DEF_PATH],
  ['langs', LANG_PATH],
];

/**
 * zip 内の1パスがどの種別のアセットかを判定します。
 * @param path zip エントリの相対パス
 * @returns 該当する種別と分解結果。対象外なら null
 */
export function classifyAssetPath(path: string): ClassifiedAsset | null {
  for (const [kind, re] of RULES) {
    const m = path.match(re);
    if (m) return { kind, namespace: m[1], id: m[2] };
  }
  return null;
}
