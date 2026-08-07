/**
 * @fileoverview 画像形式と拡大率の保存。次に開いたときも同じ見え方にするためのものです。
 *
 * 保存値をそのまま信じないのは、選択肢を変えたときに「どれも選ばれていないセレクト」が出るためです。
 */

import { useState } from 'react';
import { DEFAULT_SCALE, SCALE_CHOICES } from './api';
import { readStored, writeStored } from '../shared/browser';

/** 画像形式の保存キー。 */
const FMT_KEY = 'mpr_fmt';

/** 拡大率の保存キー。 */
const SCALE_KEY = 'mpr_scale';

/** 既定の画像形式。 */
const DEFAULT_FMT = 'png';

/** 表示設定と、その変更手段。 */
export interface DisplayPrefs {
  fmt: string;
  scale: number;
  changeFmt: (next: string) => void;
  changeScale: (next: number) => void;
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
  const [fmt, setFmt] = useState(() => readStored(FMT_KEY) || DEFAULT_FMT);
  const [scale, setScale] = useState(() => storedScale());

  return {
    fmt,
    scale,
    changeFmt: (next) => {
      setFmt(next);
      writeStored(FMT_KEY, next);
    },
    changeScale: (next) => {
      setScale(next);
      writeStored(SCALE_KEY, String(next));
    },
  };
}
