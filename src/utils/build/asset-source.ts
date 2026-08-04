/**
 * @fileoverview 描画時のアセット読み出し口。build 経由と従来のフラット配置の差をここで吸収します。
 *
 * 1枚の画像は複数のネームスペースに跨がって解決されるため（modのレシピが `minecraft:` を参照する）、
 * 解決の文脈はリクエスト単位の「MCチャネル」です。呼び出し側はそれを持ち回るだけで済みます。
 *
 * build を持たないネームスペースは従来のフラットなキーへ落ちます。移行が終わった ns から
 * 順に build 経由へ切り替わるため、全体を一斉に移行し終えるまで待つ必要がありません。
 */

import type { Env } from '../minecraft';
import { getBlob } from './blob';
import { resolveBuild } from './channels';
import { foldBuild } from './manifest';

/** 論理パスの接頭辞と、従来のフラットなキーの対応。 */
const LEGACY_ROOTS: Record<string, (ns: string) => string> = {
  textures: (ns) => `assets/${ns}/textures/`,
  models: (ns) => `assets/${ns}/models/`,
  lang: (ns) => `assets/${ns}/lang/`,
  recipe: (ns) => `data/${ns}/recipe/`,
  tags: (ns) => `data/${ns}/tags/`,
};

/**
 * あるMCチャネルの文脈でアセットを読み出します。
 *
 * ネームスペースごとの build 解決結果はインスタンス内に覚えるので、1枚の画像で同じ ns を
 * 何度引いてもチャネル表の参照は1回で済みます。
 */
export class AssetSource {
  private readonly builds = new Map<string, string | null>();

  /**
   * @param env 環境変数
   * @param mc 要求されたMCチャネル（未指定なら各 ns の最新）
   */
  constructor(private readonly env: Env, private readonly mc: string | null) {}

  /**
   * ネームスペースが解決される build を返します。
   * @param ns ネームスペース
   * @returns build ID。build を持たない ns なら null
   */
  async buildOf(ns: string): Promise<string | null> {
    const memoized = this.builds.get(ns);
    if (memoized !== undefined) return memoized;

    const resolved = await resolveBuild(this.env, ns, this.mc);
    const buildId = resolved?.buildId ?? null;
    this.builds.set(ns, buildId);
    return buildId;
  }

  /**
   * 論理パスのアセットを読み出します。
   * @param ns ネームスペース
   * @param logicalPath 論理パス（例: `textures/item/foo.png`）
   * @returns 見つからなければ null
   */
  async get(ns: string, logicalPath: string): Promise<R2ObjectBody | null> {
    const buildId = await this.buildOf(ns);
    if (buildId) {
      const folded = await foldBuild(this.env, ns, buildId);
      const hash = folded?.files[logicalPath];
      if (hash) return getBlob(this.env, hash);
    }
    return this.env.BUCKET.get(legacyKey(ns, logicalPath));
  }
}

/**
 * build を参照しない読み出し口を作ります。
 *
 * 移行用スクリプトや、MCチャネルの文脈を持たない管理ルートから使います。
 * @param env 環境変数
 */
export function legacyAssetSource(env: Env): AssetSource {
  return new AssetSource(env, null);
}

/**
 * 論理パスを従来のフラットなR2キーへ戻します。
 * @param ns ネームスペース
 * @param logicalPath 論理パス
 */
function legacyKey(ns: string, logicalPath: string): string {
  const slash = logicalPath.indexOf('/');
  const root = slash < 0 ? logicalPath : logicalPath.slice(0, slash);
  const rest = slash < 0 ? '' : logicalPath.slice(slash + 1);

  const prefix = LEGACY_ROOTS[root];
  return prefix ? `${prefix(ns)}${rest}` : `assets/${ns}/${logicalPath}`;
}
