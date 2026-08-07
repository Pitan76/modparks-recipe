/**
 * @fileoverview レンダリング済み画像（L1）のR2キーと、その公開URLの組み立て。
 *
 * Worker を通さず R2 のカスタムドメインから直接配信するため、キーの作り方をサーバ・クライアントで
 * 共有します。クライアントは `/api/**\/list.json` が返す `assets`（base と rv）からURLを組めます。
 * L1 に無い画像は 404 になるので、呼び出し側は Worker の `/api/:ns/:id.png` へフォールバックして
 * ください（Worker がレンダリングしてL1へ保存するため、次回からは直接ヒットします）。
 */

import type { Env } from './minecraft';
import type { AssetSource } from './build/asset-source';
import { rendererVersion } from './render-version';
import { getAllVersions, getAssetVersion } from './cache-version';
import { SHARED_NAMESPACES } from '../core/namespaces';

// キー書式そのものはブラウザ側も組み立てるため core にあります。ここから通して使わせます。
export { imageCacheKey, IMAGE_CACHE_PREFIX } from '../core/image-key';

/** build ID を世代として使うときの長さ。キーを短く保つため先頭だけを採ります。 */
const BUILD_VERSION_LENGTH = 16;

/** クライアントへ渡す配信情報。`base` が空なら直接配信は無効です。 */
export type AssetDelivery = { base: string; rv: string };

/**
 * ネームスペース1つ分の画像バージョンを返します。キーを組む側も、それをクライアントへ配る側も、
 * 必ずここを通してください。
 *
 * build を持つなら build ID を採ります。中身のハッシュなので、同じ絵に別の世代が割り当たることも、
 * 違う内容が同じ世代を共有することもありません。持たないネームスペースだけがアセットバージョンへ
 * 落ちます。
 *
 * 導出を1箇所に集めているのは、配る側と組む側で食い違うと不整合が黙って進むからです。実際に
 * アグリゲート版の索引だけがアセットバージョンを配っていたことがあり、同じ絵が2通りのキーで
 * L1 に書かれたうえ、そのネームスペースへ何か書くたびに直リンクが一斉に 404 へ落ちていました。
 * @param env 環境変数
 * @param src アセット読み出し口（MCチャネルの文脈を持ちます）
 * @param ns ネームスペース
 */
export async function imageVersion(env: Env, src: AssetSource, ns: string): Promise<string> {
  const buildId = await src.buildOf(ns);
  if (buildId) return buildId.slice(0, BUILD_VERSION_LENGTH);
  return getAssetVersion(env, ns);
}

/**
 * 実効のレンダラー版を返します。共有ネームスペースのバージョンを畳み込んだものです。
 *
 * 1枚のレシピ画像は自分のネームスペースだけでは完結せず、`c` や `minecraft` のタグを辿って
 * 素材のアイコンを決めます。ところがキャッシュキーが持つのはレシピ側のバージョンだけなので、
 * 共通タグを足しても依存する画像が切り替わりません。共有側のバージョンをここで混ぜることで、
 * 共通タグを更新した時点で関係する画像が一斉に作り直されます。
 *
 * クライアントはこの値を `assets.rv` として受け取り、中身を解釈せずキーに埋めるだけなので、
 * キーの形は変わりません。
 * @param env 環境変数
 */
export async function deliveryVersion(env: Env): Promise<string> {
  const versions = await getAllVersions(env);
  const parts = SHARED_NAMESPACES.filter((ns) => versions[ns]).map((ns) => `${ns}=${versions[ns]}`);
  if (parts.length === 0) return rendererVersion(env);
  return `${rendererVersion(env)}.${fingerprint(parts.join('|'))}`;
}

/**
 * 文字列を短い16進の指紋に畳みます（FNV-1a）。
 *
 * キーの一部に載せるだけなので衝突耐性より短さと同期実行を優先しています。
 * @param text 元の文字列
 */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * クライアントに配る配信情報を返します。
 * @param env 環境変数
 */
export async function assetDelivery(env: Env): Promise<AssetDelivery> {
  return { base: trimSlash(env.PUBLIC_IMAGE_BASE ?? ''), rv: await deliveryVersion(env) };
}

/** 末尾のスラッシュを落とします。URL結合時の `//` を避けるためです。 */
function trimSlash(base: string): string {
  return base.endsWith('/') ? base.slice(0, -1) : base;
}
