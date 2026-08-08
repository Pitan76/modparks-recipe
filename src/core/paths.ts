/**
 * @fileoverview アセット種別の唯一の出所。
 *
 * 1つの種別は「jar のどこにあるか」「論理パスの何という根に置くか」「R2 のどのキーに落ちるか」
 * 「中身がバイナリか」「外から読ませてよいか」を同時に持ちます。これらが別々の場所に書かれて
 * いると、種別を1つ足すのに5ファイルを直すことになり、必ずどこかが取り残されます。実際
 * `items/`（1.21.4以降のアイテム定義）は読み出し側だけが知っていて、投入側が丸ごと欠けたまま
 * 動いていました。
 *
 * 種別を増やすときは、この表に1行足すだけで済むようにしてあります。
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
export type AssetKind = 'recipes' | 'tags' | 'textures' | 'models' | 'items' | 'langs' | 'mcmetas';

/** 種別1つ分の決まりごと。 */
export interface AssetKindSpec {
  /** bulk 投入APIのボディのキー。抽出結果の器のキーでもあります。 */
  kind: AssetKind;
  /** jar 内のパス規則。捕捉群はネームスペースと種別内IDです。 */
  jarPath: RegExp;
  /** 論理パスの根。種別名とは一致しません（`langs` の論理パスは `lang/`）。 */
  root: string;
  /** 論理パスとして受け付ける別名。MCの版差で複数形・単数形が揺れるためです。 */
  rootAliases: string[];
  /** jar でも R2 でも共通の最上位ディレクトリ。見た目の資産か、データ駆動の定義かで分かれます。 */
  container: 'assets' | 'data';
  /** 中身がバイナリか。抽出時に base64 へ畳む必要があるかを決めます。 */
  binary: boolean;
  /** 生アセットとして外から読ませてよいか。レシピ本体は専用ルートが返すため開けません。 */
  publiclyReadable: boolean;
}

/**
 * 種別表。`classifyAssetPath` はこの順に当てるため、狭い規則を先に置いてください。
 *
 * `models` を `items` より先に置いているのは、両方に当たりうるパスを従来どおり `models` として
 * 扱うためです。順番を入れ替えると既存の分類が変わります。
 */
export const ASSET_KINDS: readonly AssetKindSpec[] = [
  {
    kind: 'recipes',
    jarPath: RECIPE_PATH,
    root: 'recipe',
    rootAliases: ['recipes'],
    container: 'data',
    binary: false,
    publiclyReadable: false,
  },
  {
    kind: 'tags',
    jarPath: TAG_PATH,
    root: 'tags',
    rootAliases: [],
    container: 'data',
    binary: false,
    publiclyReadable: true,
  },
  {
    kind: 'textures',
    jarPath: TEXTURE_PATH,
    root: 'textures',
    rootAliases: [],
    container: 'assets',
    binary: true,
    publiclyReadable: true,
  },
  {
    kind: 'mcmetas',
    jarPath: /^assets\/([^/]+)\/textures\/((?:item|block)\/.+)\.png\.mcmeta$/,
    root: 'textures',
    rootAliases: [],
    container: 'assets',
    binary: false,
    publiclyReadable: true,
  },
  {
    kind: 'models',
    jarPath: MODEL_PATH,
    root: 'models',
    rootAliases: [],
    container: 'assets',
    binary: false,
    publiclyReadable: true,
  },
  {
    kind: 'items',
    jarPath: ITEM_DEF_PATH,
    root: 'items',
    rootAliases: [],
    container: 'assets',
    binary: false,
    publiclyReadable: true,
  },
  {
    kind: 'langs',
    jarPath: LANG_PATH,
    root: 'lang',
    rootAliases: [],
    container: 'assets',
    binary: false,
    publiclyReadable: true,
  },
];

/** 種別名から決まりごとを引く表。 */
const BY_KIND = new Map(ASSET_KINDS.map((spec) => [spec.kind, spec]));

/** 論理パスの根（別名を含む）から決まりごとを引く表。 */
const BY_ROOT = new Map(
  ASSET_KINDS.flatMap((spec) => [spec.root, ...spec.rootAliases].map((root) => [root, spec] as const))
);

/**
 * 論理パスの根に対応する、従来のフラットなキーの接頭辞を作ります。
 *
 * 根は呼び出し側が持っているものをそのまま使います。別名（`recipes` と `recipe`）は指す場所が
 * 違うため、正規化してしまうと jar 側の実体を見失います。
 * @param ns ネームスペース
 * @param root 論理パスの根
 * @param spec 種別の決まりごと
 */
export function rootPrefix(ns: string, root: string, spec: AssetKindSpec): string {
  return `${spec.container}/${ns}/${root}/`;
}

/**
 * 種別名から決まりごとを引きます。
 * @param kind 種別名
 */
export function assetKind(kind: AssetKind): AssetKindSpec {
  return BY_KIND.get(kind)!;
}

/**
 * 論理パスの根から決まりごとを引きます。
 * @param root 論理パスの根（例: `textures`）
 * @returns 知らない根なら null
 */
export function assetKindByRoot(root: string): AssetKindSpec | null {
  return BY_ROOT.get(root) ?? null;
}

/** 種別ごとに空の器を作ります。 */
export function emptyByKind<T>(make: () => T): Record<AssetKind, T> {
  return Object.fromEntries(ASSET_KINDS.map((spec) => [spec.kind, make()])) as Record<AssetKind, T>;
}

/** パスを種別・ネームスペース・種別内IDに分解した結果。 */
export interface ClassifiedAsset {
  kind: AssetKind;
  namespace: string;
  /** 種別ごとのID。テクスチャは拡張子を含まず、呼び出し側で付け直します。 */
  id: string;
}

/**
 * zip 内の1パスがどの種別のアセットかを判定します。
 * @param path zip エントリの相対パス
 * @returns 該当する種別と分解結果。対象外なら null
 */
export function classifyAssetPath(path: string): ClassifiedAsset | null {
  for (const spec of ASSET_KINDS) {
    const m = path.match(spec.jarPath);
    if (m) return { kind: spec.kind, namespace: m[1], id: m[2] };
  }
  return null;
}
