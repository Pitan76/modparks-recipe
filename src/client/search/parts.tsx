/**
 * @fileoverview 検索ページの表示部品。状態は持たず、見た目と入力の受け渡しだけを担います。
 */

import { type FormEvent, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { SCALE_CHOICES } from './api';
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
