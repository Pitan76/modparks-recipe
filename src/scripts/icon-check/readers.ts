/**
 * @fileoverview アイコン検証で使う読み出し口。手元の client.jar と、稼働中のサーバの2通りを用意します。
 *
 * 2通り必要なのは、空きスロットの原因が2種類あるからです。片方は解釈のバグ（jar には資産があるのに
 * 描けない）、もう片方は投入漏れ（描ける資産がサーバに載っていない）で、jar だけを見ていると後者を
 * 取りこぼします。実際 `items/` の投入漏れは、手元では通るのに本番だけ空になる形で表面化しました。
 */

import fs from 'fs';
import * as unzipper from 'unzipper';
import type { AssetReader, AssetBody } from '../../core/asset-reader';

/** 検証対象を数え上げられる読み出し口。 */
export interface IconSource extends AssetReader {
  /**
   * 検証すべきアイテムIDを列挙します。
   * @param ns ネームスペース
   */
  itemIds(ns: string): Promise<string[]>;
}

/** バイト列を `AssetBody` に包みます。 */
function bodyOf(buf: Buffer): AssetBody {
  return {
    text: async () => buf.toString('utf-8'),
    arrayBuffer: async () => new Uint8Array(buf).buffer,
  };
}

/**
 * client.jar を読み出し口にします。
 * @param jarPath jar のパス
 */
export async function jarSource(jarPath: string): Promise<IconSource> {
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
 * 稼働中のサーバを読み出し口にします。資産APIを1件ずつ引きます。
 *
 * 列挙だけは jar から採ります。サーバ側に一覧APIは無く、また「jar にあるのにサーバで描けない」を
 * 見つけるのが目的なので、期待する集合は jar 側が持っているべきものです。
 * @param baseUrl サーバのベースURL
 * @param jarPath 検証対象を数え上げるための jar
 */
export async function remoteSource(baseUrl: string, jarPath: string): Promise<IconSource> {
  const base = baseUrl.replace(/\/$/, '');
  const jar = await jarSource(jarPath);

  return {
    async get(ns, logicalPath) {
      const res = await fetch(`${base}/api/${ns}/asset/${logicalPath}`);
      if (!res.ok) return null;
      return bodyOf(Buffer.from(await res.arrayBuffer()));
    },
    async buildOf() {
      return null;
    },
    itemIds: (ns) => jar.itemIds(ns),
  };
}

/**
 * zip 内のパス一覧から、検証対象のアイテムIDを取り出します。
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
