/**
 * @fileoverview 検索ページ本体。状態を持ち、部品へ配ります。
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Pagination from '@mui/material/Pagination';
import { splitId } from './api';
import { MainPanel, PAGE_SIZE, type GridEntry, type Selection } from './MainPanel';
import { AppBar, SearchForm, SectionHead, ZipButton } from './parts';
import { ShowImagesToggle } from './result-parts';
import { ItemList } from './ItemList';
import { useDisplayPrefs } from './preferences';
import { useFmtResolver } from './format';
import { useShare } from './useShare';
import {
  INITIAL_PARAMS,
  namespacesOf,
  replaceQuery,
  useGroups,
  useNameRequests,
  useNames,
  useNamespaceCounts,
  useRecipeIndex,
} from './state';
import { buildRecipeZip, saveBlob } from './zip';
import { searchMessagesFor } from '../../utils/i18n/search';

/** 1ページあたりのアイテム一覧の表示件数。 */
const ITEM_PAGE_SIZE = 50;

/**
 * 表示言語に対応するMinecraftのロケールと、言語切替リンクの行き先を返します。
 * @param locale 表示言語
 */
function localeSetup(locale: string) {
  if (locale === 'ja') return { mcLocale: 'ja_jp', toggle: { lang: 'en', label: 'English' } };
  return { mcLocale: 'en_us', toggle: { lang: 'ja', label: '日本語' } };
}

export function App({ locale }: { locale: string }) {
  const t = searchMessagesFor(locale);
  const { mcLocale, toggle } = localeSetup(locale);
  const { recipes, versions, assets } = useRecipeIndex();
  const { names, request } = useNames(mcLocale);

  const [q, setQ] = useState('');
  const { fmt, view, changeFmt, changeScale, changeTagNs, changeCrop } = useDisplayPrefs();
  const fmtOf = useFmtResolver(fmt, recipes);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [ns, setNs] = useState(() => INITIAL_PARAMS.get('ns') || 'default');
  const [showImages, setShowImages] = useState(() => INITIAL_PARAMS.get('view') !== 'list');
  const [page, setPage] = useState(1);
  const [itemPage, setItemPage] = useState(1);
  const [zipping, setZipping] = useState<string | null>(null);

  const groups = useGroups(recipes);
  const items = useMemo(() => Object.keys(groups).sort(), [groups]);
  const counts = useNamespaceCounts(groups, items);
  const namespaces = useMemo(
    () =>
      Object.keys(counts).sort((a, b) => {
        if (a === 'all') return -1;
        if (b === 'all') return 1;
        if (a === 'default') return -1;
        if (b === 'default') return 1;
        return counts[b] - counts[a] || a.localeCompare(b);
      }),
    [counts]
  );

  const query = q.trim().toLowerCase();
  const scope = useMemo(() => {
    if (ns === 'all') return items;
    if (ns === 'default') return items.filter((x) => namespacesOf(groups, x).some((n) => n !== 'minecraft'));
    return items.filter((x) => namespacesOf(groups, x).includes(ns));
  }, [groups, items, ns]);
  const filtered = useMemo(() => {
    if (!query) return scope;
    return scope.filter((x) => x.toLowerCase().includes(query) || (names[x] || '').toLowerCase().includes(query));
  }, [scope, query, names]);

  const select = useCallback(
    (item: string) => {
      setSelection({ label: item, recipeIds: groups[item] || [item] });
      replaceQuery((p) => p.set('id', item));
    },
    [groups]
  );

  useEffect(() => {
    if (!recipes) return;
    const id = INITIAL_PARAMS.get('id');
    if (id && groups[id]) {
      select(id);
      setShowImages(false);
    }
  }, [recipes, groups, select]);

  useEffect(() => replaceQuery((p) => (ns === 'default' ? p.delete('ns') : p.set('ns', ns))), [ns]);
  useEffect(() => {
    replaceQuery((p) => (showImages ? p.delete('view') : p.set('view', 'list')));
    setPage(1);
  }, [showImages]);
  // filtered は names の更新でも作り直されるため、絞り込み条件そのものを見る
  useEffect(() => {
    setPage(1);
    setItemPage(1);
  }, [query, ns, items]);

  // 索引に無い namespace が ?ns= で来ると、選択肢に無い値のまま0件になる
  useEffect(() => {
    if (ns !== 'all' && ns !== 'default' && items.length > 0 && !counts[ns]) setNs('default');
  }, [items, counts, ns]);

  const itemPageCount = Math.max(1, Math.ceil(filtered.length / ITEM_PAGE_SIZE));
  const pagedItems = useMemo(
    () => filtered.slice((itemPage - 1) * ITEM_PAGE_SIZE, itemPage * ITEM_PAGE_SIZE),
    [filtered, itemPage]
  );
  const entries = useMemo<GridEntry[]>(() => {
    const out: GridEntry[] = [];
    filtered.forEach((item) =>
      (groups[item] || []).forEach((rid) => {
        // Mod を選んでいる間は、その Mod が定義したレシピだけを見せます。バニラのアイテムを
        // 作る Mod のレシピを選んだのに、バニラ側のレシピまで並ぶと選んだ意味がなくなります。
        if (ns === 'default') {
          if (splitId(rid).ns === 'minecraft') return;
        } else if (ns !== 'all' && splitId(rid).ns !== ns) {
          return;
        }
        out.push({ rid, item });
      })
    );
    return out;
  }, [filtered, groups, ns]);
  const gridItems = useMemo(
    () => Array.from(new Set(entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((x) => x.item))),
    [entries, page]
  );
  useNameRequests(!!recipes, showImages ? gridItems : pagedItems, scope, !!query, request);

  const { copiedId, failedId, copyLink, copyImage, downloadItem, downloadRecipe } = useShare({
    fmtOf,
    view,
    versions,
    assets,
    recipesOf: (item) => groups[item] || [],
  });

  /** 一覧から選ぶと結果は下（モバイル）か右（PC）に出る。モバイルでは見えないので送り届ける。 */
  function pick(item: string) {
    select(item);
    setShowImages(false);
    if (window.innerWidth <= 900) document.getElementById('main-panel')?.scrollIntoView({ block: 'start' });
  }

  function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!query) return;
    const typed = q.trim();
    if (groups[typed]) return pick(typed);
    if (filtered.length > 0) pick(filtered[0]);
  }

  /**
   * 表示中のレシピをまとめて1つの zip にして渡します。
   *
   * 対象は絞り込み後のレシピです。Mod を選んでいればその Mod 分だけになるので、
   * 「Mod ごとにまとめて欲しい」という使い方はネームスペースの選択で表現できます。
   */
  async function downloadZip() {
    const ids = entries.map((e) => e.rid);
    if (ids.length === 0 || zipping) return;

    setZipping(t.downloadZipProgress.replace('{done}', '0').replace('{total}', String(ids.length)));
    const blob = await buildRecipeZip(ids, fmtOf, versions, assets, view, (done, total) => {
      setZipping(t.downloadZipProgress.replace('{done}', String(done)).replace('{total}', String(total)));
    }).catch(() => null);
    setZipping(null);

    if (!blob) return window.alert(t.downloadZipEmpty);
    saveBlob(blob, `${ns === 'all' || ns === 'default' ? 'recipes' : ns}-${fmt}.zip`);
  }

  return (
    <>
      <AppBar t={t} toggle={toggle} selected={selection ? selection.label : null} />
      <Container maxWidth={false} disableGutters sx={{ px: { xs: 1.5, sm: 3 }, py: { xs: 2, sm: 2.5 } }}>
        <SearchForm
          t={t}
          q={q}
          onQ={setQ}
          ns={ns}
          onNs={setNs}
          fmt={fmt}
          onFmt={changeFmt}
          view={view}
          onScale={changeScale}
          onTagNs={changeTagNs}
          onCrop={changeCrop}
          namespaces={namespaces}
          counts={counts}
          onSubmit={submit}
        />
        <div className="app-layout">
          <div className="side-panel">
            <SectionHead
              title={t.itemList}
              count={recipes ? filtered.length : undefined}
              action={
                entries.length > 0 ? (
                  <ZipButton t={t} busy={zipping} onClick={downloadZip} />
                ) : undefined
              }
            />
            <ShowImagesToggle t={t} checked={showImages} onChange={setShowImages} />
            <div className="list-box">
              <ItemList
                t={t}
                recipes={recipes}
                items={items}
                filtered={filtered}
                pagedItems={pagedItems}
                names={names}
                selection={selection}
                copiedId={copiedId}
                failedId={failedId}
                onPick={pick}
                onCopy={copyLink}
                onDownload={downloadItem}
              />
            </div>
            {itemPageCount > 1 && (
              <Box sx={{ my: 1, display: 'flex', justifyContent: 'center' }}>
                <Pagination
                  count={itemPageCount}
                  page={itemPage}
                  onChange={(_ev, value) => setItemPage(value)}
                  size="small"
                  siblingCount={0}
                  color="primary"
                />
              </Box>
            )}
          </div>
          <div className="main-panel" id="main-panel">
            <MainPanel
              t={t}
              showImages={showImages}
              selection={selection}
              names={names}
              fmtOf={fmtOf}
              versions={versions}
              assets={assets}
              view={view}
              page={page}
              onPage={setPage}
              entries={entries}
              copiedId={copiedId}
              failedId={failedId}
              onPick={pick}
              onCopy={copyLink}
              onCopyImage={copyImage}
              onDownloadItem={downloadItem}
              onDownloadRecipe={downloadRecipe}
            />
          </div>
        </div>
      </Container>
    </>
  );
}
