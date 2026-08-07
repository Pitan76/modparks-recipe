/**
 * @fileoverview リンクや画像を配る操作と、その結果の一時表示。
 *
 * コピーと保存は「どの行で起きたか」を短く見せる必要があり、成否の印を持つ状態が付いて回ります。
 * 画面の組み立てとは別の関心なので、まとめてここに置いています。
 */

import { useState, type MouseEvent } from 'react';
import { imagePath, imageUrl, splitId, type Assets, type Versions } from './api';
import { copyText, downloadUrl } from '../shared/browser';

/** コピー結果を出しておく時間。 */
const FLASH_MS = 2000;

/** 配る操作に必要な、現在の表示設定。 */
export interface ShareContext {
  fmt: string;
  scale: number;
  versions: Versions | null;
  assets: Assets | null;
  /** アイテムIDから、そのアイテムが持つレシピIDを引きます。 */
  recipesOf: (item: string) => string[];
}

/** 配る操作一式。 */
export interface Share {
  /** コピーに成功した直後のID。 */
  copiedId: string | null;
  /** コピーに失敗した直後のID。 */
  failedId: string | null;
  copyLink: (ev: MouseEvent, id: string) => void;
  copyImage: (ev: MouseEvent, rid: string) => void;
  downloadItem: (ev: MouseEvent, item: string) => void;
  downloadRecipe: (ev: MouseEvent, rid: string) => void;
}

/**
 * 配る操作をまとめて用意します。
 * @param ctx 現在の表示設定
 */
export function useShare(ctx: ShareContext): Share {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);

  /** コピーして、その行に結果を少しだけ出す。 */
  const copy = (ev: MouseEvent, id: string, url: string) => {
    ev.stopPropagation();
    copyText(url).then((ok) => {
      (ok ? setCopiedId : setFailedId)(id);
      setTimeout(() => {
        setCopiedId(null);
        setFailedId(null);
      }, FLASH_MS);
    });
  };

  const downloadRecipe = (ev: MouseEvent, rid: string) => {
    ev.stopPropagation();
    downloadUrl(imagePath(rid, ctx.fmt, ctx.versions, ctx.assets, ctx.scale), `${splitId(rid).id}.${ctx.fmt}`);
  };

  return {
    copiedId,
    failedId,
    // アイテム一覧からはページへのリンクを配りたい。画像そのものは copyImage の担当。
    copyLink: (ev, id) => {
      ev.stopPropagation();
      const params = new URLSearchParams(window.location.search);
      params.set('id', id);
      copy(ev, id, `${window.location.origin}${window.location.pathname}?${params.toString()}`);
    },
    // 画像タイルからは画像そのもののURLを配る。直接配信が効くならR2のURLになる。
    copyImage: (ev, rid) => copy(ev, rid, imageUrl(rid, ctx.fmt, ctx.versions, ctx.assets, ctx.scale)),
    downloadItem: (ev, item) => {
      ev.stopPropagation();
      for (const rid of ctx.recipesOf(item)) downloadRecipe(ev, rid);
    },
    downloadRecipe,
  };
}
