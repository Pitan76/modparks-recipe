/**
 * @fileoverview 検索結果として並ぶ部品。1レシピ・1アイテムの見せ方だけを持ちます。
 *
 * R2 直接配信の 404 を Worker で拾い直す判断も、それが要るのは画像タイルだけなのでここに閉じます。
 */

import { useState, type MouseEvent } from 'react';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import { imageCdnPath, imagePath, splitId, type Assets, type Versions, type ViewOptions } from './api';
import { copyTitle, type WithMessages } from './parts';
import type { FmtResolver } from './format';

/** アイテム一覧の1行。 */
export type ItemRowProps = WithMessages & {
  item: string;
  name: string;
  selected: boolean;
  copied: boolean;
  failed: boolean;
  onSelect: () => void;
  onCopy: (ev: MouseEvent) => void;
  onDownload: (ev: MouseEvent) => void;
};

export function ItemRow(props: ItemRowProps) {
  const { t } = props;
  return (
    <div className={`item-row${props.selected ? ' selected' : ''}`} onClick={props.onSelect}>
      <Typography variant="body2" fontWeight={props.selected ? 500 : 400} noWrap>
        {props.name}
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" noWrap sx={{ fontFamily: 'monospace' }}>
        {props.item}
      </Typography>
      <div className="item-actions">
        <IconButton size="small" onClick={props.onDownload} title={t.download}>
          <i className="fa-solid fa-download" style={{ fontSize: 11 }} />
        </IconButton>
        <IconButton size="small" onClick={props.onCopy} title={copyTitle(t, props.copied, props.failed)}>
          <i className={props.copied ? 'fa-solid fa-check' : 'fa-regular fa-copy'} style={{ fontSize: 11 }} />
        </IconButton>
      </div>
    </div>
  );
}

/** 一覧の表示件数を切り替えるチェックボックス。 */
export function ShowImagesToggle({ t, checked, onChange }: WithMessages & { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <FormControlLabel
      control={<Checkbox size="small" disableRipple checked={checked} onChange={(ev) => onChange(ev.target.checked)} />}
      label={t.showImages}
      sx={{ mb: 0, '& .MuiFormControlLabel-label': { fontSize: 13, color: 'text.secondary' } }}
    />
  );
}

/** レシピ画像1枚のタイル。 */
export type ImageTileProps = WithMessages & {
  recipeId: string;
  itemId: string;
  name?: string;
  fmtOf: FmtResolver;
  versions: Versions | null;
  assets: Assets | null;
  view: ViewOptions;
  title?: string;
  copied: boolean;
  failed: boolean;
  onClick?: () => void;
  onCopy: (ev: MouseEvent) => void;
  onDownload: (ev: MouseEvent) => void;
};

export function ImageTile(props: ImageTileProps) {
  const { t } = props;
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const parts = splitId(props.recipeId);
  const direct = imageCdnPath(props.recipeId, props.fmtOf(props.recipeId), props.versions, props.assets, props.view);
  // 直接配信を諦めたURL。形式や表示設定を変えると direct も変わるので、その都度また直接配信から試せる。
  const [gaveUp, setGaveUp] = useState<string | null>(null);
  const useDirect = direct !== null && gaveUp !== direct;

  /** 直接配信の404はWorkerで拾い直す。それ以外の失敗は本当のエラーとして出す。 */
  const onError = () => {
    if (useDirect) return setGaveUp(direct);
    setStatus('error');
  };

  return (
    <div className="recipe-item">
      {status === 'loading' && <CircularProgress size={20} sx={{ my: 1 }} />}
      {status === 'error' && (
        <Typography variant="caption" color="error">{`${props.recipeId} ${t.cannotDisplay}`}</Typography>
      )}
      <img
        src={(useDirect && direct) || imagePath(props.recipeId, props.fmtOf(props.recipeId), props.versions, props.assets, props.view)}
        alt={props.recipeId}
        className="recipe-img"
        title={props.title}
        decoding="async"
        onLoad={() => setStatus('ok')}
        onError={onError}
        onClick={props.onClick}
        style={{ display: status === 'ok' ? 'block' : 'none' }}
      />
      {status === 'ok' && (
        <div className="recipe-meta">
          {props.name && props.name !== props.itemId && <div className="recipe-name">{props.name}</div>}
          <div className="recipe-label">{`${parts.ns}:${parts.id}`}</div>
          <div className="recipe-actions">
            <IconButton size="small" onClick={props.onDownload} title={t.download}>
              <i className="fa-solid fa-download" style={{ fontSize: 11 }} />
            </IconButton>
            <IconButton size="small" onClick={props.onCopy} title={copyTitle(t, props.copied, props.failed, t.copyImage)}>
              <i className={props.copied ? 'fa-solid fa-check' : 'fa-regular fa-copy'} style={{ fontSize: 11 }} />
            </IconButton>
          </div>
        </div>
      )}
    </div>
  );
}
