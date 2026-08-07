/**
 * @fileoverview レンダラーのバージョン識別子。
 *
 * この値は永続キャッシュ（L1）のキーに含まれるため、値が変わると過去にレンダリングした画像・
 * アイコンは参照されなくなり、新しい出力で再構築されます。
 *
 * 値はレンダリング系ソースの指紋から自動で決まります（`scripts/gen-render-version.mjs`）。
 * 以前は手で上げる定数でしたが、描画を直した日に上げ忘れて「直したのに古い絵が返り続ける」
 * 事故が起きたため、人が覚えておく必要をなくしました。手で編集する場所はもうありません。
 *
 * 環境変数 `RENDERER_VERSION` が設定されていればそれを優先します。特定の版へ固定したい、
 * あるいは緊急に作り直させたい、といった運用上の逃げ道です。
 */

import type { Env } from './minecraft';
import { RENDERER_VERSION } from '../generated/render-version';

/**
 * 実効レンダラー版を返します。
 * @param env 環境変数
 */
export function rendererVersion(env: Env): string {
  return env.RENDERER_VERSION || RENDERER_VERSION;
}
