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
export const RECIPE_PAGE_HTML = /* html */ `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>ModParks Recipe</title>
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
(function () {
  const e = React.createElement;
  const MUI = MaterialUI;
  const {
    ThemeProvider, createTheme, CssBaseline, Container, Box,
    Typography, TextField, MenuItem, Button, Stack, Link, CircularProgress,
    List, ListItemButton, ListItemText, Chip
  } = MUI;

  // ModParksサイトのデザインに合わせます（ダークパレット、細い境界線、フラットボタン）。
  const theme = createTheme({
    palette: {
      mode: 'dark',
      primary: { main: '#3b82f6', light: '#60a5fa', dark: '#2563eb', contrastText: '#ffffff' },
      secondary: { main: '#10b981', light: '#34d399', dark: '#059669', contrastText: '#ffffff' },
      background: { default: '#0f172a', paper: '#1e293b' },
      text: { primary: '#f8fafc', secondary: '#94a3b8' },
      divider: '#334155'
    },
    shape: { borderRadius: 4 },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { textTransform: 'none', fontWeight: 600, transition: 'all 0.2s ease-in-out' } }
      },
      MuiChip: {
        styleOverrides: { root: { borderRadius: 4, fontWeight: 500 } }
      },
      MuiLink: {
        defaultProps: { color: 'primary.light' },
        styleOverrides: { root: { textDecoration: 'none', '&:hover': { textDecoration: 'underline' } } }
      },
      MuiListItemButton: {
        styleOverrides: { root: { transition: 'all 0.2s ease-in-out' } }
      }
    }
  });
  const MAX_ROWS = 300; // 巨大なリストでもレスポンシブ動作を維持するため、レンダリングする行数を制限します

  function splitId(full) {
    const i = full.indexOf(':');
    return i === -1 ? { ns: 'minecraft', id: full } : { ns: full.slice(0, i), id: full.slice(i + 1) };
  }

  // 画像の読み込み/エラー状態を個別に管理するレシピ画像タイル。読み込みに失敗した画像は非表示になります。
  function ImageTile(props) {
    const [st, setSt] = React.useState('loading');
    const p = splitId(props.recipeId);
    const path = '/api/' + encodeURIComponent(p.ns) + '/' + encodeURIComponent(p.id) + '.' + props.fmt;
    return e(Box, { sx: { m: 1, textAlign: 'center' } },
      st === 'loading' && e(CircularProgress, { size: 24 }),
      st === 'error' && e(Typography, { variant: 'caption', color: 'error' }, props.recipeId + ' を表示できません'),
      e('img', {
        src: path + '?t=' + props.nonce,
        alt: props.recipeId,
        onLoad: function () { setSt('ok'); },
        onError: function () { setSt('error'); },
        style: {
          display: st === 'ok' ? 'block' : 'none',
          imageRendering: 'pixelated', maxWidth: '100%', borderRadius: 4, background: '#1e293b'
        }
      }),
      st === 'ok' && e(Box, { sx: { mt: 0.5, fontSize: 12, overflowWrap: 'anywhere' } },
        e(Link, { href: path }, p.ns + ':' + p.id)));
  }

  function App() {
    const [recipes, setRecipes] = React.useState(null); // null=読み込み中、[]=データなし/失敗
    const [q, setQ] = React.useState('');
    const [fmt, setFmt] = React.useState('png');
    const [sel, setSel] = React.useState(null);         // { label, recipeIds }
    const [nonce, setNonce] = React.useState(0);

    React.useEffect(function () {
      fetch('/api/list.json')
        .then(function (r) { return r.ok ? r.json() : {}; })
        .then(function (d) {
          // 新フォーマット: recipes:[{id,result}]。旧フォーマット: ids:[...] (グループ化なし)。
          if (Array.isArray(d.recipes)) setRecipes(d.recipes);
          else if (Array.isArray(d.ids)) setRecipes(d.ids.map(function (id) { return { id: id, result: id }; }));
          else setRecipes([]);
        })
        .catch(function () { setRecipes([]); });
    }, []);

    // レシピIDを完成品アイテムごとにグループ化します。
    const groups = React.useMemo(function () {
      const m = {};
      (recipes || []).forEach(function (r) {
        const key = r.result || r.id;
        (m[key] = m[key] || []).push(r.id);
      });
      return m;
    }, [recipes]);

    const items = React.useMemo(function () { return Object.keys(groups).sort(); }, [groups]);
    const query = q.trim().toLowerCase();
    const filtered = query ? items.filter(function (x) { return x.toLowerCase().includes(query); }) : items;

    function select(item) {
      setSel({ label: item, recipeIds: groups[item] || [item] });
      setNonce(Date.now());
    }

    function openTyped(ev) {
      ev.preventDefault();
      if (!query) return;
      // 入力されたID/アイテムを直接表示し、それを共有する他のレシピとグループ化します。
      select(q.trim());
    }

    return e(Container, { maxWidth: 'md', sx: { py: 6 } },
      e(Box, { sx: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 } },
        e(Typography, { variant: 'h4', gutterBottom: true, fontWeight: 700 }, 'ModParks Recipe'),
        e(Link, {
          href: 'https://github.com/Pitan76/modparks-recipe', target: '_blank', rel: 'noopener',
          color: 'text.secondary', title: 'GitHub',
          sx: { fontSize: 28, display: 'inline-flex', '&:hover': { color: 'text.primary' } }
        }, e('i', { className: 'fa-brands fa-github' }))),
      e(Typography, { color: 'text.secondary', sx: { mb: 3 } },
        'レシピIDを入力してレシピを表示します。'),

      e('form', { onSubmit: openTyped },
        e(Stack, { direction: { xs: 'column', sm: 'row' }, spacing: 1.5, sx: { mb: 2 } },
          e(TextField, { label: '検索', placeholder: 'iron_ingot', value: q, onChange: function (x) { setQ(x.target.value); }, autoFocus: true, fullWidth: true, size: 'small' }),
          e(TextField, { label: '形式', select: true, value: fmt, onChange: function (x) { setFmt(x.target.value); }, sx: { width: { sm: 130 } }, size: 'small' },
            e(MenuItem, { value: 'png' }, 'PNG'),
            e(MenuItem, { value: 'gif' }, 'GIF'),
            e(MenuItem, { value: 'jpg' }, 'JPG')),
          e(Button, { type: 'submit', variant: 'contained', size: 'small', sx: { flexShrink: 0, whiteSpace: 'nowrap' } }, '表示'))),

      // プレビュー: 選択されたアイテムを生成するすべてのレシピ
      sel && e(Box, { sx: { mb: 3 } },
        e(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' } },
          e(Typography, { variant: 'h6', sx: { overflowWrap: 'anywhere' } }, sel.label),
          e(Chip, { size: 'small', label: sel.recipeIds.length + ' レシピ' })),
        e(Box, { sx: { display: 'flex', flexWrap: 'wrap', justifyContent: 'center' } },
          sel.recipeIds.map(function (rid) {
            return e(ImageTile, { key: rid, recipeId: rid, fmt: fmt, nonce: nonce });
          }))),

      // アイテム一覧
      e(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, mb: 1 } },
        e(Typography, { variant: 'subtitle1', fontWeight: 600 }, 'アイテム一覧'),
        recipes && e(Chip, { size: 'small', label: filtered.length + (query ? ' / ' + items.length : '') })),
      e(Box, null,
        recipes === null
          ? e(Box, { sx: { p: 3, textAlign: 'center' } }, e(CircularProgress, { size: 24 }))
          : items.length === 0
            ? e(Box, { sx: { p: 3, textAlign: 'center', color: 'text.secondary' } }, '一覧を取得できませんでした（索引が未生成の可能性があります）。')
            : e(React.Fragment, null,
                e(List, { dense: true, sx: { maxHeight: 460, overflow: 'auto', py: 0 } },
                  filtered.slice(0, MAX_ROWS).map(function (item, i) {
                    const n = groups[item].length;
                    return e(ListItemButton, { key: item, divider: i < Math.min(filtered.length, MAX_ROWS) - 1, onClick: function () { select(item); } },
                      e(ListItemText, { primary: item, secondary: n > 1 ? (n + ' レシピ') : null }));
                  })),
                filtered.length > MAX_ROWS && e(Box, { sx: { p: 1.5, textAlign: 'center', color: 'text.secondary', fontSize: 13 } },
                  '他 ' + (filtered.length - MAX_ROWS) + ' 件… 検索で絞り込んでください'))));
  }

  ReactDOM.createRoot(document.getElementById('root')).render(
    e(ThemeProvider, { theme: theme }, e(CssBaseline, null), e(App, null))
  );
})();
</script>
</body>
</html>`;
