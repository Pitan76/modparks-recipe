/**
 * @fileoverview 絵の見え方の設定をまとめたポップオーバー。
 *
 * 検索バーに並べると、設定が増えるたびに横一列が伸びて狭い画面で破綻します。
 * 検索の絞り込み（何を出すか）とは関心が別なので、ボタン1つの内側へ隔離します。
 */

import { useState, type MouseEvent } from 'react';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { MAX_CROP } from '../../core/render-options';
import { SCALE_CHOICES, type ViewOptions } from './api';
import type { SearchMessages } from '../../utils/i18n/search';

/** 選べるクリップ量（ネイティブpx）。 */
const CROP_CHOICES = Array.from({ length: MAX_CROP + 1 }, (_, n) => n);

export type ViewSettingsProps = {
  t: SearchMessages;
  view: ViewOptions;
  onScale: (value: number) => void;
  onTagNs: (value: string) => void;
  onCrop: (value: number) => void;
};

/**
 * 表示設定を開くボタンと、その中身。
 */
export function ViewSettings(props: ViewSettingsProps) {
  const { t } = props;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  return (
    <>
      <IconButton
        onClick={(ev: MouseEvent<HTMLElement>) => setAnchor(ev.currentTarget)}
        title={t.viewSettings}
        aria-label={t.viewSettings}
        sx={{ flexShrink: 0 }}
      >
        <i className="fa-solid fa-sliders" style={{ fontSize: 16 }} />
      </IconButton>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Stack spacing={2} sx={{ p: 2, width: 280 }}>
          <TextField
            label={t.size}
            select
            size="small"
            value={props.view.scale}
            onChange={(ev) => props.onScale(Number(ev.target.value))}
          >
            {SCALE_CHOICES.map((scale) => (
              <MenuItem key={scale} value={scale}>{`${scale}x`}</MenuItem>
            ))}
          </TextField>
          <TextField
            label={t.tagNamespaces}
            size="small"
            value={props.view.tagNs}
            onChange={(ev) => props.onTagNs(ev.target.value)}
            placeholder="create, farmersdelight"
            helperText={t.tagNamespacesHelp}
          />
          <TextField
            label={t.crop}
            select
            size="small"
            value={props.view.crop}
            onChange={(ev) => props.onCrop(Number(ev.target.value))}
            helperText={t.cropHelp}
          >
            {CROP_CHOICES.map((crop) => (
              <MenuItem key={crop} value={crop}>{`${crop} px`}</MenuItem>
            ))}
          </TextField>
        </Stack>
      </Popover>
    </>
  );
}
