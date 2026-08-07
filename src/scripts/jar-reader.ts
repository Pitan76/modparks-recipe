/**
 * @fileoverview client.jar をアセットの読み出し口として使うための実装。
 *
 * オフラインでアイコンを焼く経路も、描けるかを確かめる経路も、Worker と同じ描画コードを通します。
 * その描画コードが要求するのは `AssetReader` だけなので、jar をその形に見せればそのまま使えます。
 */

import fs from 'fs';
import * as unzipper from 'unzipper';
import type { AssetBody, AssetReader } from '../core/asset-reader';

/** 検証・焼き付けの対象を数え上げられる読み出し口。 */
export interface JarSource extends AssetReader {
  /**
   * 対象のアイテムIDを列挙します。
   * @param ns ネームスペース
   */
  itemIds(ns: string): Promise<string[]>;
}

/** バイト列を `AssetBody` に包みます。 */
export function bodyOf(buf: Buffer): AssetBody {
  return {
    text: async () => buf.toString('utf-8'),
    arrayBuffer: async () => new Uint8Array(buf).buffer,
  };
}

/**
 * client.jar を読み出し口にします。
 * @param jarPath jar のパス
 */
export async function jarSource(jarPath: string): Promise<JarSource> {
  if (!fs.existsSync(jarPath)) throw new Error(`client.jar not found at ${jarPath}. Run fetch-mc-data first.`);

  const dir = await unzipper.Open.file(jarPath);
  const files = new Map(dir.files.map((f) => [f.path, f]));

  return {
    async get(ns, logicalPath) {
      const entry = files.get(`assets/${ns}/${logicalPath}`);
      return entry ? bodyOf(await entry.buffer()) : null;
    },
    async buildOf() {
      return 'local';
    },
    async itemIds(ns) {
      return idsFromPaths(ns, [...files.keys()]);
    },
  };
}

/**
 * zip 内のパス一覧から、対象のアイテムIDを取り出します。
 *
 * `items/` があればそれだけを対象にします。ここは実在するアイテムと1対1で対応する唯一の一覧で、
 * `models/item/` には `clock_00` や `template_*` のような部品モデルが混ざるためです。
 * `items/` を持たない版（1.21.3以前）でだけ `models/item/` へ落とします。
 * @param ns ネームスペース
 * @param paths zip 内のパス一覧
 */
function idsFromPaths(ns: string, paths: string[]): string[] {
  const ids = collectMatches(paths, new RegExp(`^assets/${ns}/items/(.+)\\.json$`));
  if (ids.length > 0) return ids;
  return collectMatches(paths, new RegExp(`^assets/${ns}/models/item/(.+)\\.json$`));
}

/**
 * 正規表現の1番目の捕捉群を集めて並べます。
 * @param paths 走査するパス一覧
 * @param re 捕捉群を1つ持つ正規表現
 */
function collectMatches(paths: string[], re: RegExp): string[] {
  const ids = new Set<string>();
  for (const path of paths) {
    const hit = re.exec(path);
    if (hit) ids.add(hit[1]);
  }
  return [...ids].sort();
}
