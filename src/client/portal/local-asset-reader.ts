/**
 * @fileoverview jar を優先して読み、無いものだけ配信側から引く読み出し口。
 *
 * 手元の jar には自分の mod の資産しか入っていません。`minecraft:` のテクスチャやモデル、`c:` の
 * タグは外から取る必要がありますが、何が要るかは実際に描いてみるまで分かりません。そこで1周目は
 * 「無かったもの」を記録するだけにして、まとめて取ってから描き直す、という使い方を前提にしています。
 */

import type { AssetBody, AssetReader } from '../../core/asset-reader';
import type { ZipLike } from '../../core/jar-assets';
import { assetKindByRoot, rootPrefix } from '../../core/paths';
import { fetchBytes } from './svg-image';

/**
 * jar を優先して読み、無いものだけ配信側から引く読み出し口。
 */
export class LocalAssetReader implements AssetReader {
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
