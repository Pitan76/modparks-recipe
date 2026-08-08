/**
 * @fileoverview 表示設定の保存。次に開いたときも同じ見え方にするためのものです。
 *
 * 保存値をそのまま信じないのは、選択肢を変えたときに「どれも選ばれていないセレクト」が出るためです。
 */

import { useState } from 'react';
import { DEFAULT_SCALE, DEFAULT_VIEW, SCALE_CHOICES, type ViewOptions } from './api';
import { normalizeCrop } from '../../core/render-options';
import { toFmt, type Fmt } from './format';
import { readStored, writeStored } from '../shared/browser';

/** 画像形式の保存キー。 */
const FMT_KEY = 'mpr_fmt';

/** 拡大率の保存キー。 */
const SCALE_KEY = 'mpr_scale';

/** タグ構成アイテムに足すネームスペースの保存キー。 */
const TAG_NS_KEY = 'mpr_tag_ns';

/** 余白クリップ量の保存キー。 */
const CROP_KEY = 'mpr_crop';

/** 既定の画像形式。素材が切り替わるレシピだけ GIF になり、他は PNG のままです。 */
const DEFAULT_FMT: Fmt = 'auto';

/** 表示設定と、その変更手段。 */
export interface DisplayPrefs {
  fmt: Fmt;
  view: ViewOptions;
  changeFmt: (next: string) => void;
  changeScale: (next: number) => void;
  changeTagNs: (next: string) => void;
  changeCrop: (next: number) => void;
}

/**
 * 保存済みの拡大率を読みます。選択肢に無い値は既定へ落とします。
 */
function storedScale(): number {
  const saved = Number(readStored(SCALE_KEY));
  return SCALE_CHOICES.includes(saved as never) ? saved : DEFAULT_SCALE;
}

/**
 * 表示設定を保存しつつ持ちます。
 */
export function useDisplayPrefs(): DisplayPrefs {
  const [fmt, setFmt] = useState<Fmt>(() => toFmt(readStored(FMT_KEY), DEFAULT_FMT));
  const [view, setView] = useState<ViewOptions>(() => ({
    scale: storedScale(),
    tagNs: readStored(TAG_NS_KEY) ?? DEFAULT_VIEW.tagNs,
    crop: normalizeCrop(readStored(CROP_KEY)),
  }));

  /** 1項目だけ差し替えて保存します。 */
  const change = <K extends keyof ViewOptions>(key: K, storeKey: string, value: ViewOptions[K]) => {
    setView((prev) => ({ ...prev, [key]: value }));
    writeStored(storeKey, String(value));
  };

  return {
    fmt,
    view,
    changeFmt: (next) => {
      const value = toFmt(next, DEFAULT_FMT);
      setFmt(value);
      writeStored(FMT_KEY, value);
    },
    changeScale: (next) => change('scale', SCALE_KEY, next),
    changeTagNs: (next) => change('tagNs', TAG_NS_KEY, next.trim()),
    changeCrop: (next) => change('crop', CROP_KEY, normalizeCrop(next)),
  };
}
