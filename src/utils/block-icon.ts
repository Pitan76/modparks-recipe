/**
 * @fileoverview リクエスト時にブロックモデルを3Dの等角投影（isometric）アイコンにレンダリングするユーティリティ。
 * これにより、書き込みAPI経由でプッシュされたブロック（オフラインのブロックレンダリングパイプラインを通過しないもの）が、
 * 事前レンダリングされたバニラのブロックと同じ見た目になります。
 *
 * ジオメトリは実際のモデルJSON（モデル自身、または継承元の親モデル。バニラの親モデルも含みます）からのみ取得されます。
 * チェーンが実際の `elements` に解決できない場合、この処理は null を返し、呼び出し側は平面的な2Dテクスチャにフォールバックします。
 * テクスチャリストから代わりの立方体を合成するようなことはしないでください。
 * 実際と異なる結果になり、2Dフォールバックよりも見た目が悪くなります。
 */

import type { Env } from './minecraft';
import { loadModel, renderModelToSvg } from '../core/model-parser';
import { FLAT_ITEM_PARENTS } from '../core/block-geometry';
import { ensureWasm, svgToPng } from './wasm';
import { bytesToBase64 } from './http';
import { chestModel, CHEST_VARIANTS } from '../core/chest';
import { getAssetVersion } from './cache-version';

/** scripts/render-blocks/render.ts の SIZE と一致させ、両方のパスで表示サイズが揃うようにします。 */
const ICON_SIZE = 128;

/**
 * `ns:path` に対応するブロックを3DアイコンPNGとしてレンダリングします。レンダリングできない場合は null を返します。
 * @param env 環境変数
 * @param ns ネームスペース（Mod ID など）
 * @param path ブロックのパス
 * @returns PNGのバイナリ、または null
 */
export async function renderBlockIconPng(env: Env, ns: string, path: string): Promise<Uint8Array | null> {
  const svg = await renderBlockIconSvg(env, ns, path);
  if (!svg) return null;
  await ensureWasm();
  // ピクセルアート：アンチエイリアシングは一切適用しません。
  // shapeRendering を 0 (optimizeSpeed) に設定することで、面のクリップパスの境界がぼやける（フェザリング）のを防ぎます。
  // imageRendering を 1 (optimizeSpeed) に設定することで、テクスチャをニアレストネイバー法でサンプリングします。
  return svgToPng(svg, {
    fitTo: { mode: 'width', value: ICON_SIZE },
    shapeRendering: 0,
    imageRendering: 1,
  });
}

/**
 * ラスタライズ前のSVG形式のアイコン。ジオメトリのデバッグ用に公開されています。
 * @param env 環境変数
 * @param ns ネームスペース
 * @param path ブロックのパス
 * @returns SVG文字列、または null
 */
export async function renderBlockIconSvg(env: Env, ns: string, path: string): Promise<string | null> {
  const getModel = (id: string) => modelJson(env, id);
  const getTexture = (ref: string) => textureDataUrl(env, ns, ref);

  // アイテムモデルを唯一の判断基準にします。バニラの `items/<name>.json` が指すモデルを起点に、
  // 親チェーンを辿った結果でそのまま描き分けます:
  //   - 親チェーンが elements を持つ（= block モデルを参照する）なら 3D 等角投影で描画。
  //   - `item/generated` 系のフラットアイテム（松明・棒・レール等）は、バニラのインベントリと同じく
  //     スロットいっぱいの 2D スプライトとして描画します（renderModelToSvg → flatItemSvg）。
  //     以前はここで平面アイテムをスキップして `block/<path>` の 3D を強制していましたが、
  //     松明が極細スティック（実質1px単位）に潰れてバニラと別物になるため取りやめました。
  // ブロックエンティティ（チェストなど）はエレメントのない `builtin/entity` に解決されるため、
  // 代わりにエンティティのアトラスからジオメトリを合成する必要があります。
  const synthetic = ns === 'minecraft' && CHEST_VARIANTS[path]
    ? chestModel(CHEST_VARIANTS[path])
    : null;

  const candidates = synthetic
    ? [{ id: `${ns}:block/${path}`, model: synthetic }]
    : [`${ns}:item/${path}`, `${ns}:block/${path}`].map((id) => ({ id, model: null as any }));

  for (const candidate of candidates) {
    const model = candidate.model ?? (await loadModel(candidate.id, getModel));
    if (!isRenderable(model)) continue;

    // 合成モデルは、IDで再読み込みされることなく直接渡されます。
    const resolve = candidate.model
      ? async (id: string) => (id === candidate.id ? candidate.model : await getModel(id))
      : getModel;
    const svg = await renderModelToSvg(candidate.id, resolve, getTexture);
    if (svg) return svg;
  }
  return null;
}

/**
 * 解決されたモデルチェーンが renderModelToSvg で描画可能かどうかを判定します。
 * 3Dジオメトリ（elements）を持つか、または `item/generated` 系のフラットアイテム
 * （flatItemSvg で2Dスプライトとして描画される）であれば描画可能です。
 * @param model モデルデータ
 */
function isRenderable(model: any): boolean {
  if (!model) return false;
  if (FLAT_ITEM_PARENTS.has(model.parent)) return true;
  return Array.isArray(model.elements) && model.elements.length > 0;
}

// 1つのアイコンをレンダリングする際、同じオブジェクトが何度も再読み込みされます：
// 親チェーンは `item/<path>` のために1回、`block/<path>` のためにもう1回、そして renderModelToSvg 内で3回目として走査され、
// 9スロットのレシピではスロットごとにこれが繰り返されます。特に `block/cube_all` のような共有されるバニラの親モデルでこれが顕著になります。
// これらの読み込みは順次実行されるため、累積して大きな遅延になります。
// `wrangler dev --remote` で測定したところ、これら2つの読み込みをメモ化することで、キャッシュされた `minecraft:stone` アイコンの処理時間が約4.6秒から約250ミリ秒に短縮されました。
//
// 解決済みの値ではなく Promise を保存することで、並行するスロットが同じ親に対して実行する同時ルックアップも、1回の読み込みに統合されます。
const memo = new Map<string, Promise<any>>();

/**
 * 保持するエントリ数の上限。この数を超えて実行されたアイソレートは、ほとんどが古いバージョンを保持しているため、
 * LRUの追跡は行わずにすべてを破棄します。キャッシュミスが発生したときのコストはR2のGETアクセス1回分です。
 */
const MEMO_MAX = 2000;

/**
 * アセットのバージョンごとに、アイソレートあたり1回だけアセットを読み込みます。
 * バージョンをキーにすることで、書き込みAPIに対して安全になります。アセットがアップロードされるとバージョンが上がり、
 * レンダリング済みの画像と同様に、古いバージョンのすべてのエントリがアクセス不能（無効化）になります。
 */
async function memoized<T>(env: Env, ns: string, key: string, load: () => Promise<T>): Promise<T> {
  const version = await getAssetVersion(env, ns);
  const memoKey = `${version}:${ns}:${key}`;

  const hit = memo.get(memoKey);
  if (hit) return hit as Promise<T>;

  if (memo.size >= MEMO_MAX) memo.clear();
  // A failed read must not be remembered, or one transient R2 error would stick
  // to this isolate for as long as the version holds.
  const pending = load().catch((err) => {
    memo.delete(memoKey);
    throw err;
  });
  memo.set(memoKey, pending);
  return pending as Promise<T>;
}

/**
 * モデルIDに対応するモデルのJSONオブジェクトを取得します。
 * @param env 環境変数
 * @param id モデルID
 * @returns モデルJSONデータ、または null
 */
function modelJson(env: Env, id: string): Promise<any | null> {
  const { ns, path } = split(id);
  return memoized(env, ns, `models/${path}`, async () => {
    const obj = await env.BUCKET.get(`assets/${ns}/models/${path}.json`);
    if (!obj) return null;
    try {
      return JSON.parse(await obj.text());
    } catch {
      return null;
    }
  });
}

/**
 * テクスチャ参照からデータURLを取得します。
 * @param env 環境変数
 * @param defaultNs デフォルトのネームスペース
 * @param ref テクスチャ参照（#から始まるキー、またはファイルパス）
 * @returns テクスチャ画像のbase64データURL、または null
 */
function textureDataUrl(env: Env, defaultNs: string, ref: string): Promise<string | null> {
  const { ns, path } = split(ref, defaultNs);
  // 読み取りがバニラにフォールバックする場合でも、要求元のネームスペースのバージョンをキーにします。
  // これにより、`minecraft` だけのアップロードでModのエントリが無効化されるのを防ぎます。
  // これは再アップロードされたバニラテクスチャにおいてのみ意味を持ち、オフラインパイプラインはいずれにせよバージョンごとに1回だけ書き込みを行います。
  return memoized(env, ns, `textures/${path}`, async () => {
    let obj = await env.BUCKET.get(`assets/${ns}/textures/${path}.png`);
    if (!obj && ns !== 'minecraft') obj = await env.BUCKET.get(`assets/minecraft/textures/${path}.png`);
    if (!obj) return null;
    return `data:image/png;base64,${bytesToBase64(new Uint8Array(await obj.arrayBuffer()))}`;
  });
}

/**
 * リソースIDをネームスペースとパスに分割します。
 * @param id リソースID（例: namespace:path または path）
 * @param fallbackNs ネームスペースが省略されている場合のフォールバック値
 * @returns 分割されたネームスペースとパスのオブジェクト
 */
function split(id: string, fallbackNs = 'minecraft'): { ns: string; path: string } {
  const idx = id.indexOf(':');
  if (idx < 0) return { ns: fallbackNs, path: id };
  return { ns: id.slice(0, idx), path: id.slice(idx + 1) };
}
