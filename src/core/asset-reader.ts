/**
 * @fileoverview アセットの読み出し口。
 *
 * レシピ画像の組み立ては「どこからアセットを読むか」に依存しますが、読み方そのものには依存しません。
 * Worker は R2 と build マニフェストから読み、ブラウザは手元の jar から読む、という差をここで吸収します。
 *
 * 実装を型で縛らず構造だけを求めているのは、Worker 側の `AssetSource` に手を入れずに済ませるためです。
 */

/** 読み出したアセットの中身。R2 の返り値がそのまま満たします。 */
export interface AssetBody {
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** アセットを論理パスで引く口。 */
export interface AssetReader {
  /**
   * アセットを読み出します。
   * @param ns ネームスペース
   * @param logicalPath 論理パス（例: `textures/item/foo.png`）
   * @returns 見つからなければ null
   */
  get(ns: string, logicalPath: string): Promise<AssetBody | null>;

  /**
   * ネームスペースが解決される build を返します。
   *
   * アイコンのキャッシュ世代に使います。build を持たない読み出し口は null を返してください。
   * @param ns ネームスペース
   */
  buildOf(ns: string): Promise<string | null>;
}
