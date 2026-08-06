/**
 * @fileoverview 右側（モバイルでは下側）の表示領域。レシピ画像の一覧と、選択したアイテムの詳細。
 */

import type { MouseEvent } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Pagination from '@mui/material/Pagination';
import Typography from '@mui/material/Typography';
import { imageUrl, type Assets, type Names, type Versions } from './api';
import { copyTitle, EmptyState, ImageTile, SectionHead, type WithMessages } from './parts';

/** 1ページあたりのレシピ画像の表示枚数。 */
export const PAGE_SIZE = 48;

/** 選択中のアイテム。 */
export type Selection = { label: string; recipeIds: string[] };

/** 一覧に並べる1枚分。 */
export type GridEntry = { rid: string; item: string };

export type MainPanelProps = WithMessages & {
  showImages: boolean;
  selection: Selection | null;
  names: Names;
  fmt: string;
  versions: Versions | null;
  assets: Assets | null;
  scale: number;
  page: number;
  onPage: (page: number) => void;
  entries: GridEntry[];
  copiedId: string | null;
  failedId: string | null;
  onPick: (item: string) => void;
  onCopy: (ev: MouseEvent, item: string) => void;
  onDownloadItem: (ev: MouseEvent, item: string) => void;
  onDownloadRecipe: (ev: MouseEvent, rid: string) => void;
  onCopyImage: (ev: MouseEvent, rid: string) => void;
};

export function MainPanel(props: MainPanelProps) {
  if (props.showImages) return <RecipeGrid {...props} />;
  if (!props.selection) return <EmptyState t={props.t} />;
  return <RecipeDetail {...props} selection={props.selection} />;
}

/** 絞り込み結果のレシピ画像を並べます。 */
function RecipeGrid(props: MainPanelProps) {
  const { t, entries, page } = props;
  const pageCount = Math.ceil(entries.length / PAGE_SIZE);
  const pager = pageCount > 1 && (
    <Box sx={{ my: 1, display: 'flex', justifyContent: 'center' }}>
      <Pagination count={pageCount} page={page} onChange={(_ev, value) => props.onPage(value)} color="primary" />
    </Box>
  );

  return (
    <Box>
      <SectionHead title={t.showImages} count={entries.length} />
      {pager}
      <div className="recipe-grid">
        {entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(({ rid, item }) => (
          <ImageTile
            key={rid}
            t={t}
            recipeId={rid}
            itemId={item}
            name={props.names[item]}
            fmt={props.fmt}
            versions={props.versions}
            assets={props.assets}
            scale={props.scale}
            copied={props.copiedId === rid}
            failed={props.failedId === rid}
            onClick={() => props.onPick(item)}
            onCopy={(ev) => props.onCopyImage(ev, rid)}
            onDownload={(ev) => props.onDownloadRecipe(ev, rid)}
          />
        ))}
      </div>
      {pager}
    </Box>
  );
}

/** 選択したアイテムのレシピをすべて出します。 */
function RecipeDetail(props: MainPanelProps & { selection: Selection }) {
  const { t, selection } = props;
  const label = selection.label;
  const name = props.names[label] || label;
  const copied = props.copiedId === label;
  const failed = props.failedId === label;

  return (
    <Box>
      <div className="section-head">
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h6">{name}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
            {label}
          </Typography>
        </Box>
        <Chip size="small" variant="outlined" label={`${selection.recipeIds.length} ${t.recipeCount}`} />
        <IconButton size="small" onClick={(ev) => props.onCopy(ev, label)} title={copyTitle(t, copied, failed)}>
          <i className={copied ? 'fa-solid fa-check' : 'fa-regular fa-copy'} style={{ fontSize: 14 }} />
        </IconButton>
        <IconButton size="small" onClick={(ev) => props.onDownloadItem(ev, label)} title={t.download}>
          <i className="fa-solid fa-download" style={{ fontSize: 14 }} />
        </IconButton>
      </div>
      <div className="recipe-grid">
        {selection.recipeIds.map((rid) => (
          <ImageTile
            key={rid}
            t={t}
            recipeId={rid}
            itemId={label}
            name={props.names[label]}
            fmt={props.fmt}
            versions={props.versions}
            assets={props.assets}
            scale={props.scale}
            title={t.openImage}
            copied={props.copiedId === rid}
            failed={props.failedId === rid}
            onClick={() => window.open(imageUrl(rid, props.fmt, props.versions, props.assets, props.scale), '_blank', 'noopener')}
            onCopy={(ev) => props.onCopyImage(ev, rid)}
            onDownload={(ev) => props.onDownloadRecipe(ev, rid)}
          />
        ))}
      </div>
    </Box>
  );
}
