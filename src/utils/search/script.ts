/**
 * @fileoverview 検索ページのクライアントスクリプト。
 *
 * MUI の UMD 版を CDN から読み、React.createElement で組み立てます（ビルド手順なし）。
 * 文言は `window.MPR_SEARCH_MESSAGES` からのみ取得します。
 */

import { SEARCH_THEME } from './theme';
import { searchParts } from './parts';

/** 1ページあたりのレシピ画像の表示枚数。 */
const PAGE_SIZE = 48;

/** 1ページあたりのアイテム一覧の表示件数。 */
const ITEM_PAGE_SIZE = 50;

/**
 * クライアントスクリプトを組み立てます。
 * @param locale 表示言語（アイテム名の取得言語と言語切替リンクに使います）
 * @returns JavaScript文字列
 */
export function searchScript(locale: string): string {
  const [mcLocale, toggleLang, toggleLabel] = locale === 'ja' ? ['ja_jp', 'en', 'English'] : ['en_us', 'ja', '日本語'];
  return /* js */ `
(function () {
  const t = window.MPR_SEARCH_MESSAGES;
  const e = React.createElement;
  const PAGE_SIZE = ${PAGE_SIZE};
  const ITEM_PAGE_SIZE = ${ITEM_PAGE_SIZE};
  const MC_LOCALE = '${mcLocale}';
  const { ThemeProvider, createTheme, Container, Box, Typography, TextField, MenuItem, Button, Stack, CircularProgress, Chip, IconButton, Checkbox, FormControlLabel, Pagination, InputAdornment } = MaterialUI;

  ${SEARCH_THEME}
  ${searchParts({ lang: toggleLang, label: toggleLabel })}

  /** 初期表示のURLパラメータ。同期エフェクトが書き換える前の値を読む必要がある。 */
  const INITIAL_PARAMS = new URLSearchParams(window.location.search);

  function App() {
    const [recipes, setRecipes] = React.useState(null);
    const [q, setQ] = React.useState('');
    const [fmt, setFmt] = React.useState(() => localStorage.getItem('mpr_fmt') || 'png');
    const [sel, setSel] = React.useState(null);
    const [nonce, setNonce] = React.useState(0);
    const [names, setNames] = React.useState({});
    const [copiedId, setCopiedId] = React.useState(null);
    const [selNs, setSelNs] = React.useState(() => INITIAL_PARAMS.get('ns') || 'all');
    const [showImg, setShowImg] = React.useState(() => INITIAL_PARAMS.get('view') === 'img');
    const [page, setPage] = React.useState(1);
    const [itemPage, setItemPage] = React.useState(1);

    React.useEffect(() => {
      fetch('/api/list.json').then(r => r.ok ? r.json() : {}).then(d => {
        if (Array.isArray(d.recipes)) setRecipes(d.recipes);
        else if (Array.isArray(d.ids)) setRecipes(d.ids.map(id => ({ id, result: id })));
        else setRecipes([]);
      }).catch(() => setRecipes([]));
    }, []);

    const groups = React.useMemo(() => { const m = {}; (recipes || []).forEach(r => { const k = r.result || r.id; (m[k] = m[k] || []).push(r.id); }); return m; }, [recipes]);
    const items = React.useMemo(() => Object.keys(groups).sort(), [groups]);
    // Mod ごとの件数。どの Mod にレシピがどれだけあるかを選ぶ前に知りたいので、選択肢に添える
    const nsCounts = React.useMemo(() => {
      const counts = { all: items.length };
      items.forEach(x => { const ns = splitId(x).ns; counts[ns] = (counts[ns] || 0) + 1; });
      return counts;
    }, [items]);
    const nss = React.useMemo(() => Object.keys(nsCounts).sort((a, b) => a === 'all' ? -1 : b === 'all' ? 1 : nsCounts[b] - nsCounts[a] || a.localeCompare(b)), [nsCounts]);
    const query = q.trim().toLowerCase();
    const filtered = React.useMemo(() => {
      const base = selNs === 'all' ? items : items.filter(x => splitId(x).ns === selNs);
      return !query ? base : base.filter(x => x.toLowerCase().includes(query) || (names[x] || '').toLowerCase().includes(query));
    }, [items, query, names, selNs]);

    function replaceQuery(mutate) {
      const p = new URLSearchParams(window.location.search);
      mutate(p);
      window.history.replaceState(null, '', window.location.pathname + '?' + p.toString());
    }

    React.useEffect(() => {
      if (!recipes) return;
      const id = INITIAL_PARAMS.get('id');
      if (id && groups[id]) select(id);
    }, [recipes]);

    React.useEffect(() => { replaceQuery(p => selNs === 'all' ? p.delete('ns') : p.set('ns', selNs)); }, [selNs]);
    React.useEffect(() => { replaceQuery(p => showImg ? p.set('view', 'img') : p.delete('view')); setPage(1); }, [showImg]);
    React.useEffect(() => { setPage(1); setItemPage(1); }, [filtered]);

    // 一覧はページ単位で描画する。全件をDOMに出すと重く、探している場所も見失いやすい
    const itemPageCount = Math.max(1, Math.ceil(filtered.length / ITEM_PAGE_SIZE));
    const pagedItems = React.useMemo(
      () => filtered.slice((itemPage - 1) * ITEM_PAGE_SIZE, itemPage * ITEM_PAGE_SIZE),
      [filtered, itemPage]
    );

    const filteredRecipes = React.useMemo(() => {
      const res = [];
      filtered.forEach(item => { (groups[item] || []).forEach(rid => res.push({ rid, item })); });
      return res;
    }, [filtered, groups]);

    // 画像一覧を見ているときはそちらに出ているアイテムの名前が要る
    const gridItems = React.useMemo(
      () => Array.from(new Set(filteredRecipes.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(x => x.item))),
      [filteredRecipes, page]
    );
    const visibleItems = showImg ? gridItems : pagedItems;

    React.useEffect(() => {
      if (!recipes) return;
      const missing = visibleItems.filter(id => !names[id] && id.includes(':'));
      if (missing.length === 0) return;
      const placeholders = {}; missing.forEach(id => { placeholders[id] = id; });
      setNames(prev => Object.assign({}, prev, placeholders));
      for (let i = 0; i < missing.length; i += 50) {
        fetch('/api/names?lang=' + MC_LOCALE + '&ids=' + encodeURIComponent(missing.slice(i, i + 50).join(',')))
          .then(r => r.ok ? r.json() : { names: {} })
          .then(d => { if (d.names) setNames(prev => Object.assign({}, prev, d.names)); })
          .catch(err => console.error(err));
      }
    }, [visibleItems, recipes]);

    function select(item) {
      setSel({ label: item, recipeIds: groups[item] || [item] });
      setNonce(Date.now());
      replaceQuery(p => p.set('id', item));
    }

    function copyId(ev, id) {
      ev.stopPropagation();
      const p = new URLSearchParams(window.location.search);
      p.set('id', id);
      navigator.clipboard.writeText(window.location.origin + window.location.pathname + '?' + p.toString())
        .then(() => { setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); });
    }

    function downloadItem(ev, item) {
      ev.stopPropagation();
      (groups[item] || []).forEach(rid => {
        const a = document.createElement('a');
        a.href = imagePath(rid, fmt);
        a.download = splitId(rid).id + '.' + fmt;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      });
    }

    function changeFmt(next) { setFmt(next); localStorage.setItem('mpr_fmt', next); }

    // 一覧から選ぶと結果は下（モバイル）か右（PC）に出る。モバイルでは見えない位置なので送り届ける
    function pick(item) {
      select(item);
      setShowImg(false);
      if (window.innerWidth <= 900) document.getElementById('main-panel').scrollIntoView({ block: 'start' });
    }

    // 入力がそのままIDなら直接、そうでなければ絞り込みの先頭を開く（Enter だけで結果まで届く）
    function submit(ev) {
      ev.preventDefault();
      if (!query) return;
      if (groups[q.trim()]) return pick(q.trim());
      if (filtered.length > 0) pick(filtered[0]);
    }

    const selName = sel ? (names[sel.label] || sel.label) : '';
    const itemPager = itemPageCount > 1 && e(Box, { sx: { my: 1, display: 'flex', justifyContent: 'center' } },
      e(Pagination, { count: itemPageCount, page: itemPage, onChange: (ev, val) => setItemPage(val), size: 'small', siblingCount: 0, color: 'primary' }));
    const listBody = recipes === null
      ? e(Box, { sx: { p: 2, textAlign: 'center' } }, e(CircularProgress, { size: 20 }))
      : items.length === 0
        ? e(Box, { sx: { p: 2, textAlign: 'center', color: 'text.secondary' } }, e(Typography, { variant: 'body2' }, t.listUnavailable))
        : filtered.length === 0
          ? e(Box, { sx: { p: 2, textAlign: 'center', color: 'text.secondary' } }, e(Typography, { variant: 'body2' }, t.noResults))
          : pagedItems.map(item => e(ItemRow, {
              key: item, item: item, name: names[item] || item,
              selected: !!sel && sel.label === item, copied: copiedId === item,
              onSelect: () => pick(item),
              onCopy: ev => copyId(ev, item), onDownload: ev => downloadItem(ev, item)
            }));

    return e(React.Fragment, null,
      e(AppBar, { selected: sel ? sel.label : null }),
      e(Container, { maxWidth: false, disableGutters: true, sx: { px: 3, py: 2.5 } },
        e(SearchForm, { q: q, setQ: setQ, selNs: selNs, setSelNs: setSelNs, fmt: fmt, setFmt: changeFmt, nss: nss, nsCounts: nsCounts, onSubmit: submit }),
        e('div', { className: 'app-layout' },
          e('div', { className: 'side-panel' },
            e('div', { className: 'section-head' },
              e(Typography, { variant: 'subtitle2' }, t.itemList),
              selNs !== 'all' && e(Chip, { size: 'small', variant: 'outlined', label: selNs, onDelete: () => setSelNs('all') }),
              e(Box, { sx: { flexGrow: 1 } }),
              recipes && e(Chip, { size: 'small', variant: 'outlined', label: filtered.length })),
            e(FormControlLabel, {
              control: e(Checkbox, { size: 'small', disableRipple: true, checked: showImg, onChange: x => setShowImg(x.target.checked) }),
              label: t.showImages,
              sx: { mb: 0, '& .MuiFormControlLabel-label': { fontSize: 13, color: 'text.secondary' } }
            }),
            e('div', { className: 'list-box' }, listBody),
            itemPager),
          e('div', { className: 'main-panel', id: 'main-panel' }, e(MainPanel, {
            showImg: showImg, sel: sel, selName: selName, fmt: fmt, nonce: nonce, page: page, setPage: setPage,
            filteredRecipes: filteredRecipes, copiedId: copiedId, names: names, onPick: pick, onCopy: copyId, onDownload: downloadItem
          })))));
  }

  function MainPanel(props) {
    const { showImg, sel, filteredRecipes, page } = props;
    if (showImg) {
      const pageCount = Math.ceil(filteredRecipes.length / PAGE_SIZE);
      const pager = pageCount > 1 && e(Box, { sx: { my: 1, display: 'flex', justifyContent: 'center' } },
        e(Pagination, { count: pageCount, page: page, onChange: (ev, val) => props.setPage(val), color: 'primary' }));
      return e(Box, null,
        e('div', { className: 'section-head' },
          e(Typography, { variant: 'subtitle2', sx: { flexGrow: 1 } }, t.showImages),
          e(Chip, { size: 'small', variant: 'outlined', label: filteredRecipes.length })),
        pager,
        e('div', { className: 'recipe-grid' },
          filteredRecipes.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(({ rid, item }) =>
            e(ImageTile, { key: rid, recipeId: rid, name: props.names[item], fmt: props.fmt, nonce: props.nonce, onClick: () => props.onPick(item) }))),
        pager);
    }
    if (!sel) return e('div', { className: 'empty-state' }, e(Typography, { variant: 'body2' }, t.lead));
    const openFullSize = rid => window.open(imagePath(rid, props.fmt), '_blank', 'noopener');
    return e(Box, null,
      e('div', { className: 'section-head' },
        e(Box, { sx: { flexGrow: 1, minWidth: 0 } },
          e(Typography, { variant: 'h6' }, props.selName),
          e(Typography, { variant: 'caption', color: 'text.secondary', sx: { fontFamily: 'monospace' } }, sel.label)),
        e(Chip, { size: 'small', variant: 'outlined', label: sel.recipeIds.length + ' ' + t.recipeCount }),
        e(IconButton, { size: 'small', onClick: ev => props.onCopy(ev, sel.label), title: props.copiedId === sel.label ? t.copySuccess : t.copyLink },
          e('i', { className: props.copiedId === sel.label ? 'fa-solid fa-check' : 'fa-regular fa-copy', style: { fontSize: 14 } })),
        e(IconButton, { size: 'small', onClick: ev => props.onDownload(ev, sel.label), title: t.download },
          e('i', { className: 'fa-solid fa-download', style: { fontSize: 14 } }))),
      e('div', { className: 'recipe-grid' },
        sel.recipeIds.map(rid => e(ImageTile, { key: rid, recipeId: rid, name: props.selName, fmt: props.fmt, nonce: props.nonce, title: t.openImage, onClick: () => openFullSize(rid) }))));
  }

  ReactDOM.createRoot(document.getElementById('root')).render(e(ThemeProvider, { theme: theme }, e(App, null)));
})();
`;
}
