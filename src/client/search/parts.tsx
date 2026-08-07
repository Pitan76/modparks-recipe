/**
 * @fileoverview 検索ページの表示部品。状態は持たず、見た目と入力の受け渡しだけを担います。
 */

import { useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { imageCdnPath, imagePath, SCALE_CHOICES, splitId, type Assets, type Versions } from './api';
import type { SearchMessages } from '../../utils/i18n/search';

/** 部品が共通で受け取る文言。 */
export type WithMessages = { t: SearchMessages };

/**
 * コピー操作のツールチップ文言を選びます。
 * @param t 文言表
 * @param copied コピー成功直後か
 * @param failed コピー失敗直後か
 * @param idle 平常時の文言
 */
export function copyTitle(t: SearchMessages, copied: boolean, failed: boolean, idle: string = t.copyLink): string {
  if (failed) return t.copyFailed;
  return copied ? t.copySuccess : idle;
}

/** ページ上端のヘッダー。 */
export function AppBar({ t, toggle, selected }: WithMessages & { toggle: { lang: string; label: string }; selected: string | null }) {
  const langHref = `/?lang=${toggle.lang}${selected ? `&id=${encodeURIComponent(selected)}` : ''}`;
  return (
    <header className="app-bar">
      <div className="app-bar-inner">
        <a className="app-brand" href="/">
          <img src="/icon.svg" alt="ModParks" width={32} height={32} />
          <span className="app-title">{t.title}</span>
        </a>
        <nav className="app-nav">
          <a href={langHref}>{toggle.label}</a>
          <a href="/upload">{t.publish}</a>
          <a href="https://github.com/Pitan76/modparks-recipe" target="_blank" rel="noreferrer" aria-label="GitHub">
            <i className="fa-brands fa-github" style={{ fontSize: 22 }} />
          </a>
        </nav>
      </div>
    </header>
  );
}

/** 検索フォームの入力値。 */
export type SearchFormProps = WithMessages & {
  q: string;
  onQ: (value: string) => void;
  ns: string;
  onNs: (value: string) => void;
  fmt: string;
  onFmt: (value: string) => void;
  scale: number;
  onScale: (value: number) => void;
  namespaces: string[];
  counts: Record<string, number>;
  onSubmit: (ev: FormEvent) => void;
};

/** 検索・Mod絞り込み・画像形式をまとめた1行。 */
export function SearchForm(props: SearchFormProps) {
  const { t } = props;
  const clear = props.q ? (
    <InputAdornment position="end">
      <IconButton size="small" onClick={() => props.onQ('')} title={t.clear} aria-label={t.clear}>
        <i className="fa-solid fa-xmark" style={{ fontSize: 13 }} />
      </IconButton>
    </InputAdornment>
  ) : null;

  return (
    <form onSubmit={props.onSubmit}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} sx={{ mb: { xs: 2, sm: 2.5 } }}>
        <TextField
          label={t.search}
          value={props.q}
          onChange={(ev) => props.onQ(ev.target.value)}
          autoFocus
          fullWidth
          placeholder="namespace:id"
          InputProps={{ endAdornment: clear }}
          sx={{ maxWidth: { sm: 360 } }}
        />
        <FilterSelects {...props} />
        <Button type="submit" variant="contained" sx={{ minWidth: 88, flexShrink: 0 }}>
          {t.show}
        </Button>
      </Stack>
    </form>
  );
}

/**
 * 絞り込みの選択欄3つ。狭い画面では縦積みだと嵩むため、横一列に詰めて幅を分け合わせます。
 */
function FilterSelects(props: SearchFormProps) {
  const { t } = props;
  /** 狭い画面では割合で、広い画面では固定幅で並べる。 */
  const cell = (grow: number, wide: number) => ({ flex: { xs: `${grow} 1 0`, sm: '0 0 auto' }, width: { sm: wide }, minWidth: 0 });

  return (
    <Stack direction="row" spacing={1.5} sx={{ width: { xs: '100%', sm: 'auto' }, flexShrink: 0 }}>
      <TextField label={t.namespace} select value={props.ns} onChange={(ev) => props.onNs(ev.target.value)} sx={cell(2, 200)}>
        {props.namespaces.map((ns) => (
          <MenuItem key={ns} value={ns}>
            {`${ns === 'all' ? 'All' : ns === 'default' ? 'Default' : ns} (${props.counts[ns] ?? 0})`}
          </MenuItem>
        ))}
      </TextField>
      <TextField label={t.format} select value={props.fmt} onChange={(ev) => props.onFmt(ev.target.value)} sx={cell(1, 110)}>
        <MenuItem value="png">PNG</MenuItem>
        <MenuItem value="gif">GIF</MenuItem>
        <MenuItem value="jpg">JPG</MenuItem>
      </TextField>
      <TextField label={t.size} select value={props.scale} onChange={(ev) => props.onScale(Number(ev.target.value))} sx={cell(1, 110)}>
        {SCALE_CHOICES.map((scale) => (
          <MenuItem key={scale} value={scale}>{`${scale}x`}</MenuItem>
        ))}
      </TextField>
    </Stack>
  );
}

/** 見出しと件数バッジ。 */
export function SectionHead({
  title,
  count,
  action,
}: {
  title: string;
  count?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="section-head">
      <Typography variant="subtitle2">{title}</Typography>
      {count !== undefined && <Chip size="small" variant="outlined" label={count} />}
      {action !== undefined && <span style={{ marginLeft: 'auto' }}>{action}</span>}
    </div>
  );
}

/**
 * 表示中のレシピをまとめて zip で受け取るボタン。
 * @param busy 進行中の表示。null なら待機中
 */
export function ZipButton({ t, busy, onClick }: WithMessages & { busy: string | null; onClick: () => void }) {
  return (
    <Button size="small" startIcon={<i className="fa-solid fa-file-zipper" />} disabled={!!busy} onClick={onClick}>
      {busy ?? t.downloadZip}
    </Button>
  );
}

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
  fmt: string;
  versions: Versions | null;
  assets: Assets | null;
  scale: number;
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
  const direct = imageCdnPath(props.recipeId, props.fmt, props.versions, props.assets, props.scale);
  // 直接配信を諦めたURL。形式や拡大率を変えると direct も変わるので、その都度また直接配信から試せる。
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
        src={(useDirect && direct) || imagePath(props.recipeId, props.fmt, props.versions, props.assets, props.scale)}
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

/** 何も選ばれていないときの案内。 */
export function EmptyState({ t }: WithMessages) {
  return (
    <div className="empty-state">
      <Typography variant="body2">{t.lead}</Typography>
    </div>
  );
}

/** 読み込み中の表示。 */
export function Loading() {
  return (
    <Box sx={{ p: 2, textAlign: 'center' }}>
      <CircularProgress size={20} />
    </Box>
  );
}

/** 一覧が空のときの表示。 */
export function EmptyMessage({ text }: { text: string }) {
  return (
    <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary' }}>
      <Typography variant="body2">{text}</Typography>
    </Box>
  );
}
