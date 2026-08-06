/**
 * @fileoverview 検索ページ本体。状態を持ち、部品へ配ります。
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Pagination from '@mui/material/Pagination';
import { DEFAULT_SCALE, imagePath, imageUrl, SCALE_CHOICES, splitId, type Names } from './api';
import { MainPanel, PAGE_SIZE, type GridEntry, type Selection } from './MainPanel';
import { AppBar, EmptyMessage, ItemRow, Loading, SearchForm, SectionHead, ShowImagesToggle, ZipButton } from './parts';
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
import { copyText, downloadUrl, readStored, writeStored } from '../shared/browser';
import { buildRecipeZip, saveBlob } from './zip';
import { searchMessagesFor } from '../../utils/i18n/search';

/** 1ページあたりのアイテム一覧の表示件数。 */
const ITEM_PAGE_SIZE = 50;

/** 画像形式の保存キー。 */
const FMT_KEY = 'mpr_fmt';

/** 拡大率の保存キー。 */
const SCALE_KEY = 'mpr_scale';

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
  const [fmt, setFmt] = useState(() => readStored(FMT_KEY) || 'png');
  const [scale, setScale] = useState(() => storedScale());
  const [selection, setSelection] = useState<Selection | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [ns, setNs] = useState(() => INITIAL_PARAMS.get('ns') || 'all');
  const [showImages, setShowImages] = useState(() => INITIAL_PARAMS.get('view') !== 'list');
  const [page, setPage] = useState(1);
  const [itemPage, setItemPage] = useState(1);
  const [zipping, setZipping] = useState<string | null>(null);

  const groups = useGroups(recipes);
  const items = useMemo(() => Object.keys(groups).sort(), [groups]);
  const counts = useNamespaceCounts(groups, items);
  const namespaces = useMemo(
    () => Object.keys(counts).sort((a, b) => (a === 'all' ? -1 : b === 'all' ? 1 : counts[b] - counts[a] || a.localeCompare(b))),
    [counts]
  );

  const query = q.trim().toLowerCase();
  const scope = useMemo(
    () => (ns === 'all' ? items : items.filter((x) => namespacesOf(groups, x).includes(ns))),
    [groups, items, ns]
  );
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

  useEffect(() => replaceQuery((p) => (ns === 'all' ? p.delete('ns') : p.set('ns', ns))), [ns]);
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
    if (ns !== 'all' && items.length > 0 && !counts[ns]) setNs('all');
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
        if (ns !== 'all' && splitId(rid).ns !== ns) return;
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

  /** アイテム一覧からはページへのリンクを配りたい。画像そのものは別（{@link copyImage}）。 */
  function copyLink(ev: MouseEvent, id: string) {
    ev.stopPropagation();
    const params = new URLSearchParams(window.location.search);
    params.set('id', id);
    copy(ev, id, `${window.location.origin}${window.location.pathname}?${params.toString()}`);
  }

  /** 画像タイルからは画像そのもののURLを配る。直接配信が効くならR2のURLになる。 */
  function copyImage(ev: MouseEvent, rid: string) {
    copy(ev, rid, imageUrl(rid, fmt, versions, assets, scale));
  }

  /** コピーして、その行に結果を2秒だけ出す。 */
  function copy(ev: MouseEvent, id: string, url: string) {
    ev.stopPropagation();
    copyText(url).then((ok) => {
      (ok ? setCopiedId : setFailedId)(id);
      setTimeout(() => {
        setCopiedId(null);
        setFailedId(null);
      }, 2000);
    });
  }

  function downloadItem(ev: MouseEvent, item: string) {
    ev.stopPropagation();
    (groups[item] || []).forEach((rid) => downloadRecipe(ev, rid));
  }

  function downloadRecipe(ev: MouseEvent, rid: string) {
    ev.stopPropagation();
    downloadUrl(imagePath(rid, fmt, versions, assets, scale), `${splitId(rid).id}.${fmt}`);
  }

  /**
   * 表示中のレシピをまとめて1つの zip にして渡します。
   *
   * 対象は絞り込み後のレシピです。Mod を選んでいればその Mod 分だけになるので、
   * 「Mod ごとにまとめて欲しい」という使い方はネームスペースの選択で表現できます。
   */
  async function downloadZip() {
    const ids = entries.map((e) => e.rid);
    const animated = new Set((recipes ?? []).filter((r) => r.tagged).map((r) => r.id));
    if (ids.length === 0 || zipping) return;

    setZipping(t.downloadZipProgress.replace('{done}', '0').replace('{total}', String(ids.length)));
    const blob = await buildRecipeZip(ids, fmt, (id) => animated.has(id), versions, assets, scale, (done, total) => {
      setZipping(t.downloadZipProgress.replace('{done}', String(done)).replace('{total}', String(total)));
    }).catch(() => null);
    setZipping(null);

    if (!blob) return window.alert(t.downloadZipEmpty);
    saveBlob(blob, `${ns === 'all' ? 'recipes' : ns}-${fmt}.zip`);
  }

  function changeFmt(next: string) {
    setFmt(next);
    writeStored(FMT_KEY, next);
  }

  function changeScale(next: number) {
    setScale(next);
    writeStored(SCALE_KEY, String(next));
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
          scale={scale}
          onScale={changeScale}
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
              fmt={fmt}
              versions={versions}
              assets={assets}
              scale={scale}
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

/**
 * 保存済みの拡大率を読みます。選択肢に無い値は既定へ落とします
 * （保存値を素通しすると、選択肢を変えたときに選択の外れたセレクトが出ます）。
 */
function storedScale(): number {
  const saved = Number(readStored(SCALE_KEY));
  return SCALE_CHOICES.includes(saved as never) ? saved : DEFAULT_SCALE;
}

/** アイテム一覧の中身。読み込み中・索引なし・0件をここで出し分けます。 */
function ItemList(props: {
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
