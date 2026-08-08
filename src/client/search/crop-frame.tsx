/**
 * @fileoverview 画像の余白を切り落とす枠。
 *
 * 切り抜きはサーバーではなくここで行います。絵そのものは同じなので、クリップ量ごとに
 * ラスタライズし直してR2へ置くのは、見た目の調整に対して割に合いません。
 */

import type { ReactElement } from 'react';
import { cropGeometry, DEFAULT_CROP, normalizeCrop } from '../../core/crop';

export type CropFrameProps = {
  /** 上下左右から削る量（ネイティブpx）。 */
  crop: number;
  /** 読み込み中・失敗時に隠すか。 */
  hidden: boolean;
  /** 切り抜く対象の画像。 */
  children: ReactElement;
};

/**
 * 中の画像を外へ押し出し、枠からはみ出た分を隠して切り抜きます。
 *
 * 寸法をすべて百分率で当てるのは、表示倍率やデバイスピクセル比が変わっても
 * 同じ位置で切れるようにするためです。
 */
export function CropFrame({ crop, hidden, children }: CropFrameProps) {
  const display = hidden ? 'none' : 'block';
  if (normalizeCrop(crop) === DEFAULT_CROP) return <div style={{ display }}>{children}</div>;

  const g = cropGeometry(crop);
  return (
    <div style={{ display, position: 'relative', overflow: 'hidden', width: '100%', aspectRatio: g.aspectRatio }}>
      <div style={{ position: 'absolute', left: g.left, top: g.top, width: g.width, height: g.height }}>
        {children}
      </div>
    </div>
  );
}
