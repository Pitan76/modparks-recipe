/**
 * @fileoverview レンダラーのバージョン識別子。
 *
 * レンダリング系のコード（renderer / block-geometry / model-parser / image-generator など）を
 * 変更したら、この値を上げてください。永続キャッシュ（L1）のキーに含まれるため、値が変わると
 * 過去にレンダリングした画像・アイコンは自動的に参照されなくなり、新しい出力で再構築されます。
 *
 * 環境変数 `RENDERER_VERSION` が設定されていればそれを優先します（CI がレンダリング系ソースの
 * ハッシュを注入する運用に備えたもの）。未設定ならこの定数を使います。
 */

import type { Env } from './minecraft';

/** 手動管理のレンダラー版。レンダリング出力が変わる変更のたびに上げる。 */
const RENDERER_VERSION_FALLBACK = 'r1';

/**
 * 実効レンダラー版を返します。
 * @param env 環境変数
 */
export function rendererVersion(env: Env): string {
  return env.RENDERER_VERSION || RENDERER_VERSION_FALLBACK;
}
