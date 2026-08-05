/**
 * @fileoverview "/" で配信される、レシピ検索ページ用のスタンドアロンHTML。
 *
 * リストは `/api/list.json` から1回だけ取得されます（CIパイプラインによって生成される静的インデックス。
 * クライアント側でフィルタリングされるため、サーバーに負荷はかかりません）。
 * レシピは完成品アイテムごとにグループ化されているため、複数のレシピを持つアイテムはすべて同時に表示されます。
 * `namespace:id` を直接入力して検索することも可能です（例: Modのアイテムなど）。
 *
 * CDN経由の MUI (Material UI) UMD バンドルを使用して構築され、小さなReactアプリケーションによって動作します
 * （React.createElementを使用しているため、ビルド/JSXの手順はありません）。
 */
import { searchMessagesFor, type SearchMessages } from './i18n/search';

/**
 * レシピ検索ページを組み立てます。
 * @param locale 表示言語
 * @returns HTML文字列
 */
export function searchPage(locale: string): string {
  const t: SearchMessages = searchMessagesFor(locale);
  return /* html */ `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${t.title}</title>
<style>
  html, body { margin: 0; background: #0f172a; }
</style>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" />
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script crossorigin src="https://unpkg.com/@mui/material@5.15.20/umd/material-ui.production.min.js"></script>
</head>
<body>
  <div id="root"></div>
<script>
window.MPR_SEARCH_MESSAGES = ${JSON.stringify(t)};
(function () {
  const t = window.MPR_SEARCH_MESSAGES;
  const e = React.createElement;
  const MUI = MaterialUI;
  const { ThemeProvider, createTheme, CssBaseline, Container, Box, Typography, TextField, MenuItem, Button, Stack, Link, CircularProgress, List, ListItemButton, ListItemText, Chip, IconButton, Checkbox, FormControlLabel, Pagination } = MUI;
  const theme = createTheme({ palette: { mode: 'dark', primary: { main: '#3b82f6', light: '#60a5fa', dark: '#2563eb' }, secondary: { main: '#10b981', light: '#34d399', dark: '#059669' }, background: { default: '#0f172a', paper: '#1e293b' } }, shape: { borderRadius: 4 } });
  const MAX_ROWS = 300;

  function splitId(full) {
    const i = full.indexOf(':');
    return i === -1 ? { ns: 'minecraft', id: full } : { ns: full.slice(0, i), id: full.slice(i + 1) };
  }

  function ImageTile(props) {
    const [st, setSt] = React.useState('loading');
    const p = splitId(props.recipeId);
    const path = '/api/' + encodeURIComponent(p.ns) + '/' + encodeURIComponent(p.id) + '.' + props.fmt;
    return e(Box, { sx: { m: 1, textAlign: 'center' } },
      st === 'loading' && e(CircularProgress, { size: 24 }),
      st === 'error' && e(Typography, { variant: 'caption', color: 'error' }, props.recipeId + ' ' + t.cannotDisplay),
      e('img', {
        src: path + '?t=' + props.nonce, alt: props.recipeId,
        onLoad: () => setSt('ok'), onError: () => setSt('error'), onClick: props.onClick,
        style: { display: st === 'ok' ? 'block' : 'none', imageRendering: 'pixelated', maxWidth: '100%', borderRadius: 4, background: '#1e293b', cursor: props.onClick ? 'pointer' : 'default' }
      }),
      st === 'ok' && e(Box, { sx: { mt: 0.5, fontSize: 12, overflowWrap: 'anywhere' } },
        e(Link, { href: path }, p.ns + ':' + p.id)));
  }

  function App() {
    const [recipes, setRecipes] = React.useState(null);
    const [q, setQ] = React.useState('');
    const [fmt, setFmt] = React.useState(() => localStorage.getItem('mpr_fmt') || 'png');
    const [sel, setSel] = React.useState(null);
    const [nonce, setNonce] = React.useState(0);
    const [names, setNames] = React.useState({});
    const [copiedId, setCopiedId] = React.useState(null);
    const [selNs, setSelNs] = React.useState('all');
    const [showImg, setShowImg] = React.useState(false);
    const [page, setPage] = React.useState(1);
    const [mcLocale, toggleLang, toggleLangLabel] = '${locale}' === 'ja' ? ['ja_jp', 'en', 'English'] : ['en_us', 'ja', '日本語'];

    React.useEffect(() => {
      fetch('/api/list.json').then(r => r.ok ? r.json() : {}).then(d => {
        if (Array.isArray(d.recipes)) setRecipes(d.recipes);
        else if (Array.isArray(d.ids)) setRecipes(d.ids.map(id => ({ id, result: id })));
        else setRecipes([]);
      }).catch(() => setRecipes([]));
    }, []);

    const groups = React.useMemo(() => { const m = {}; (recipes || []).forEach(r => { const k = r.result || r.id; (m[k] = m[k] || []).push(r.id); }); return m; }, [recipes]);
    const items = React.useMemo(() => Object.keys(groups).sort(), [groups]);
    const nss = React.useMemo(() => { const s = new Set(['all']); items.forEach(x => s.add(splitId(x).ns)); return Array.from(s).sort(); }, [items]);
    const query = q.trim().toLowerCase();
    const filtered = React.useMemo(() => {
      const step1 = selNs === 'all' ? items : items.filter(x => splitId(x).ns === selNs);
      return !query ? step1 : step1.filter(x => x.toLowerCase().includes(query) || (names[x] || '').toLowerCase().includes(query));
    }, [items, query, names, selNs]);

    React.useEffect(() => {
      if (!recipes) return;
      const p = new URLSearchParams(window.location.search);
      if (p.get('ns')) setSelNs(p.get('ns'));
      if (p.get('view') === 'img') setShowImg(true);
      if (p.get('id') && groups[p.get('id')]) select(p.get('id'));
    }, [recipes]);

    React.useEffect(() => {
      const p = new URLSearchParams(window.location.search);
      selNs === 'all' ? p.delete('ns') : p.set('ns', selNs);
      window.history.replaceState(null, '', window.location.pathname + '?' + p.toString());
    }, [selNs]);

    React.useEffect(() => {
      const p = new URLSearchParams(window.location.search);
      showImg ? p.set('view', 'img') : p.delete('view');
      window.history.replaceState(null, '', window.location.pathname + '?' + p.toString());
      setPage(1);
    }, [showImg]);

    React.useEffect(() => {
      setPage(1);
    }, [filtered]);

    const filteredRecipes = React.useMemo(() => {
      const res = [];
      filtered.forEach(item => {
        const ids = groups[item] || [];
        res.push(...ids.map(rid => ({ rid, item })));
      });
      return res;
    }, [filtered, groups]);

    React.useEffect(() => {
      if (!recipes) return;
      const visible = filtered.slice(0, MAX_ROWS);
      const missing = visible.filter(id => !names[id] && id.includes(':'));
      if (missing.length === 0) return;
      const ps = {}; missing.forEach(id => { ps[id] = id; }); setNames(prev => Object.assign({}, prev, ps));
      for (let i = 0; i < missing.length; i += 50) {
        fetch('/api/names?lang=' + mcLocale + '&ids=' + encodeURIComponent(missing.slice(i, i + 50).join(','))).then(r => r.ok ? r.json() : { names: {} }).then(d => { if (d.names) setNames(prev => Object.assign({}, prev, d.names)); }).catch(e => console.error(e));
      }
    }, [filtered, recipes]);

    function select(item) { setSel({ label: item, recipeIds: groups[item] || [item] }); setNonce(Date.now()); const p = new URLSearchParams(window.location.search); p.set('id', item); window.history.replaceState(null, '', window.location.pathname + '?' + p.toString()); }
    function copyId(ev, id) { ev.stopPropagation(); const p = new URLSearchParams(window.location.search); p.set('id', id); navigator.clipboard.writeText(window.location.origin + window.location.pathname + '?' + p.toString()).then(() => { setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); }); }
    
    const selName = sel ? (names[sel.label] || sel.label) : '';
    return e(Container, { maxWidth: 'md', sx: { py: 6 } },
      e(Box, { sx: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 } },
        e(Typography, { variant: 'h4', gutterBottom: true, fontWeight: 700 }, t.title),
        e(Stack, { direction: 'row', spacing: 2, alignItems: 'center' },
          e(Link, { href: '/?lang=' + toggleLang + (sel ? '&id=' + encodeURIComponent(sel.label) : ''), color: 'text.secondary' }, toggleLangLabel),
          e(Link, { href: '/upload', color: 'text.secondary' }, t.publish),
          e(Link, { href: 'https://github.com/Pitan76/modparks-recipe', target: '_blank', rel: 'noopener', color: 'text.secondary', sx: { fontSize: 28 } }, e('i', { className: 'fa-brands fa-github' })))),
      e(Typography, { color: 'text.secondary', sx: { mb: 3 } }, t.lead),
      e('form', { onSubmit: ev => { ev.preventDefault(); if (query) select(q.trim()); } },
        e(Stack, { direction: { xs: 'column', sm: 'row' }, spacing: 1.5, sx: { mb: 2 } },
          e(TextField, { label: t.search, value: q, onChange: x => setQ(x.target.value), autoFocus: true, fullWidth: true, size: 'small' }),
          e(TextField, { label: 'Mod', select: true, value: selNs, onChange: x => setSelNs(x.target.value), sx: { width: { sm: 150 } }, size: 'small' }, nss.map(ns => e(MenuItem, { key: ns, value: ns }, ns === 'all' ? 'All' : ns))),
          e(TextField, { label: t.format, select: true, value: fmt, onChange: x => { setFmt(x.target.value); localStorage.setItem('mpr_fmt', x.target.value); }, sx: { width: { sm: 130 } }, size: 'small' }, e(MenuItem, { value: 'png' }, 'PNG'), e(MenuItem, { value: 'gif' }, 'GIF'), e(MenuItem, { value: 'jpg' }, 'JPG')),
          e(Button, { type: 'submit', variant: 'contained', size: 'small' }, t.show))),
      showImg
        ? e(Box, { sx: { mb: 3 } },
            e(Typography, { variant: 'h6', fontWeight: 600, mb: 1.5 }, t.showImages),
            e(Box, { sx: { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', minHeight: 400, p: 1, border: '1px solid #334155', borderRadius: 1 } },
              filteredRecipes.slice((page - 1) * 48, page * 48).map(({ rid, item }) => e(ImageTile, { key: rid, recipeId: rid, fmt: fmt, nonce: nonce, onClick: () => { select(item); setShowImg(false); } }))),
            filteredRecipes.length > 48 && e(Box, { sx: { mt: 2, display: 'flex', justifyContent: 'center' } },
              e(Pagination, { count: Math.ceil(filteredRecipes.length / 48), page: page, onChange: (ev, val) => setPage(val), color: 'primary', size: 'small' })))
        : sel && e(Box, { sx: { mb: 3 } },
            e(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' } },
              e(Box, { sx: { flexGrow: 1 } }, e(Typography, { variant: 'h6', fontWeight: 600 }, selName)),
              e(Chip, { size: 'small', label: sel.recipeIds.length + ' ' + t.recipeCount }),
              e(Stack, { direction: 'row', spacing: 0.5, alignItems: 'center' },
                e(IconButton, {
                  size: 'small',
                  onClick: ev => copyId(ev, sel.label),
                  title: copiedId === sel.label ? t.copySuccess : t.copyLink,
                  sx: { color: copiedId === sel.label ? 'secondary.main' : 'text.secondary' }
                }, e('i', { className: copiedId === sel.label ? 'fa-solid fa-check' : 'fa-regular fa-copy' })),
                e(IconButton, {
                  size: 'small',
                  onClick: () => {
                    sel.recipeIds.forEach(rid => {
                      const p = splitId(rid);
                      const a = document.createElement('a');
                      a.href = '/api/' + encodeURIComponent(p.ns) + '/' + encodeURIComponent(p.id) + '.' + fmt;
                      a.download = p.id + '.' + fmt;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    });
                  },
                  title: t.download,
                  sx: { color: 'text.secondary', '&:hover': { color: 'text.primary' } }
                }, e('i', { className: 'fa-solid fa-download' })))),
            e(Box, { sx: { display: 'flex', flexWrap: 'wrap', justifyContent: 'center' } }, sel.recipeIds.map(rid => e(ImageTile, { key: rid, recipeId: rid, fmt: fmt, nonce: nonce })))),

      e(Box, { sx: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 } },
        e(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1 } }, e(Typography, { variant: 'subtitle1', fontWeight: 600 }, t.itemList), recipes && e(Chip, { size: 'small', label: filtered.length })),
        e(FormControlLabel, { control: e(Checkbox, { size: 'small', checked: showImg, onChange: x => setShowImg(x.target.checked) }), label: t.showImages, sx: { '& .MuiFormControlLabel-label': { fontSize: 13, color: 'text.secondary' } } })),

      e(Box, null,
        recipes === null
          ? e(Box, { sx: { p: 3, textAlign: 'center' } }, e(CircularProgress, { size: 24 }))
          : items.length === 0
            ? e(Box, { sx: { p: 3, textAlign: 'center', color: 'text.secondary' } }, t.listUnavailable)
            : e(React.Fragment, null,
                e(List, { dense: true, sx: { maxHeight: 460, overflow: 'auto', py: 0 } },
                  filtered.slice(0, MAX_ROWS).map((item, i) => {
                    const n = groups[item].length;
                    const displayName = names[item] || item;
                    const hasName = names[item] && names[item] !== item;
                    const isCopied = copiedId === item;
                    return e(ListItemButton, {
                      key: item,
                      divider: i < Math.min(filtered.length, MAX_ROWS) - 1,
                      onClick: () => { select(item); setShowImg(false); },
                      sx: { pr: 12 }
                    },
                      e(ListItemText, {
                        primary: displayName,
                        secondary: e(Stack, { direction: 'row', spacing: 1, alignItems: 'center', sx: { mt: 0.25 } },
                          hasName && e(Typography, { variant: 'caption', color: 'text.secondary', sx: { fontFamily: 'monospace' } }, item),
                          n > 1 && e(Chip, { size: 'small', label: n + ' ' + t.recipeCount, sx: { height: 16, fontSize: 10 } })
                        )
                      }),
                      e(IconButton, {
                        size: 'small',
                        onClick: ev => {
                          ev.stopPropagation();
                          groups[item].forEach(rid => {
                            const p = splitId(rid);
                            const a = document.createElement('a');
                            a.href = '/api/' + encodeURIComponent(p.ns) + '/' + encodeURIComponent(p.id) + '.' + fmt;
                            a.download = p.id + '.' + fmt;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                          });
                        },
                        title: t.download,
                        sx: { position: 'absolute', right: 48, top: '50%', transform: 'translateY(-50%)', color: 'text.secondary' }
                      }, e('i', { className: 'fa-solid fa-download' })),
                      e(IconButton, {
                        size: 'small',
                        onClick: ev => copyId(ev, item),
                        title: isCopied ? t.copySuccess : t.copyLink,
                        sx: { position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', color: isCopied ? 'secondary.main' : 'text.secondary' }
                      }, e('i', { className: isCopied ? 'fa-solid fa-check' : 'fa-regular fa-copy' })));
                  })),
                filtered.length > MAX_ROWS && e(Box, { sx: { p: 1.5, textAlign: 'center', color: 'text.secondary', fontSize: 13 } },
                  t.moreRowsPrefix + (filtered.length - MAX_ROWS) + t.moreRowsSuffix))));
  }

  ReactDOM.createRoot(document.getElementById('root')).render(
    e(ThemeProvider, { theme: theme }, e(CssBaseline, null), e(App, null))
  );
})();
</script>
</body>
</html>`;
}
