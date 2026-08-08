/**
 * @fileoverview リンクや画像を配る操作と、その結果の一時表示。
 *
 * コピーと保存は「どの行で起きたか」を短く見せる必要があり、成否の印を持つ状態が付いて回ります。
 * 画面の組み立てとは別の関心なので、まとめてここに置いています。
 */

import { useState, type MouseEvent } from 'react';
import { imagePath, imageUrl, splitId, type Assets, type Versions, type ViewOptions } from './api';
import type { FmtResolver } from './format';
import { copyText, downloadUrl } from '../shared/browser';
import { cropImageBlob } from './crop-image';
import { DEFAULT_CROP, normalizeCrop } from '../../core/crop';

/** コピー結果を出しておく時間。 */
const FLASH_MS = 2000;

/** 配る操作に必要な、現在の表示設定。 */
export interface ShareContext {
  /** レシピIDから実際の拡張子を引きます。 */
  fmtOf: FmtResolver;
  view: ViewOptions;
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

  /**
   * 1枚を保存させます。
   *
   * クリップ指定があるときだけ、一度取ってから削って渡します。見えている絵は CSS で
   * 切り抜いているだけなので、URLをそのまま渡すと余白付きの絵が保存されます。
   */
  const downloadRecipe = (ev: MouseEvent, rid: string) => {
    ev.stopPropagation();
    const ext = ctx.fmtOf(rid);
    const url = imagePath(rid, ext, ctx.versions, ctx.assets, ctx.view);
    const name = `${splitId(rid).id}.${ext}`;
    if (normalizeCrop(ctx.view.crop) === DEFAULT_CROP) return downloadUrl(url, name);
    downloadCropped(url, name, ctx.view.crop);
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
    copyImage: (ev, rid) => copy(ev, rid, imageUrl(rid, ctx.fmtOf(rid), ctx.versions, ctx.assets, ctx.view)),
    downloadItem: (ev, item) => {
      ev.stopPropagation();
      for (const rid of ctx.recipesOf(item)) downloadRecipe(ev, rid);
    },
    downloadRecipe,
  };
}

/**
 * 取得して切り抜いてから保存させます。
 *
 * 取得や描画に失敗したときは元のURLをそのまま渡します。切り抜けないことと
 * 保存できないことは別なので、巻き添えで何も保存されない方が困ります。
 * @param url 画像の取得先
 * @param fileName 保存名
 * @param crop 削る量（ネイティブpx）
 */
async function downloadCropped(url: string, fileName: string, crop: number): Promise<void> {
  const res = await fetch(url).catch(() => null);
  if (!res?.ok) return downloadUrl(url, fileName);

  const cropped = await cropImageBlob(await res.blob(), crop);
  const objectUrl = URL.createObjectURL(cropped);
  downloadUrl(objectUrl, fileName);
  // 即座に解放すると保存が始まる前に失効することがあるため、少し置いてから捨てます。
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}
