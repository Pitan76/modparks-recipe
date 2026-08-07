/**
 * @fileoverview アイテム一覧の中身。読み込み中・索引なし・0件をここで出し分けます。
 */

import type { MouseEvent } from 'react';
import type { Names } from './api';
import type { Selection } from './MainPanel';
import { ItemRow } from './result-parts';
import { EmptyMessage, Loading } from './status-parts';
import type { searchMessagesFor } from '../../utils/i18n/search';

/** アイテム一覧の中身。読み込み中・索引なし・0件をここで出し分けます。 */
export function ItemList(props: {
  t: ReturnType<typeof searchMessagesFor>;
  recipes: unknown[] | null;
  items: string[];
  filtered: string[];
  pagedItems: string[];
  names: Names;
  selection: Selection | null;
  copiedId: string | null;
  failedId: string | null;
  onPick: (item: string) => void;
  onCopy: (ev: MouseEvent, item: string) => void;
  onDownload: (ev: MouseEvent, item: string) => void;
}) {
  const { t } = props;
  if (props.recipes === null) return <Loading />;
  if (props.items.length === 0) return <EmptyMessage text={t.listUnavailable} />;
  if (props.filtered.length === 0) return <EmptyMessage text={t.noResults} />;

  return (
    <>
      {props.pagedItems.map((item) => (
        <ItemRow
          key={item}
          t={t}
          item={item}
          name={props.names[item] || item}
          selected={!!props.selection && props.selection.label === item}
          copied={props.copiedId === item}
          failed={props.failedId === item}
          onSelect={() => props.onPick(item)}
          onCopy={(ev) => props.onCopy(ev, item)}
          onDownload={(ev) => props.onDownload(ev, item)}
        />
      ))}
    </>
  );
}
