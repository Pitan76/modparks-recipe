/**
 * @fileoverview アイコン検証で使う読み出し口。手元の client.jar と、稼働中のサーバの2通りを用意します。
 *
 * 2通り必要なのは、空きスロットの原因が2種類あるからです。片方は解釈のバグ（jar には資産があるのに
 * 描けない）、もう片方は投入漏れ（描ける資産がサーバに載っていない）で、jar だけを見ていると後者を
 * 取りこぼします。実際 `items/` の投入漏れは、手元では通るのに本番だけ空になる形で表面化しました。
 */

import { bodyOf, jarSource, type JarSource } from '../jar-reader';

/** 検証対象を数え上げられる読み出し口。 */
export type IconSource = JarSource;

export { jarSource };

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
