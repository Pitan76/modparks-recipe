// Standalone HTML for the recipe lookup page served at "/".
// Users enter a namespaced id (e.g. minecraft:wooden_sword) and preview the
// generated recipe image fetched from the /api/ endpoint.
//
// The UI is built with MUI (Material UI) loaded as UMD bundles from a CDN,
// driven by a small React app (using React.createElement, so no build step /
// JSX transform is required at runtime).
export const RECIPE_PAGE_HTML = /* html */ `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>ModParks Recipe</title>
<style>
  html, body { margin: 0; background: #121212; }
</style>
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
    ThemeProvider, createTheme, CssBaseline, Container, Box, Card, CardContent,
    Typography, TextField, MenuItem, Button, Stack, Link, CircularProgress
  } = MUI;

  const theme = createTheme({ palette: { mode: 'dark', primary: { main: '#646cff' } } });

  function App() {
    const [ns, setNs] = React.useState('minecraft');
    const [id, setId] = React.useState('');
    const [fmt, setFmt] = React.useState('png');
    const [src, setSrc] = React.useState(null);
    const [status, setStatus] = React.useState('idle'); // idle | loading | ok | error
    // Details of the item currently shown in the card (captured on submit so the
    // caption doesn't change while the user edits the fields).
    const [shown, setShown] = React.useState(null);

    const path = id.trim()
      ? '/api/' + encodeURIComponent(ns.trim() || 'minecraft') + '/' + encodeURIComponent(id.trim()) + '.' + fmt
      : null;

    function submit(ev) {
      ev.preventDefault();
      if (!path) return;
      setStatus('loading');
      setShown({ ns: ns.trim() || 'minecraft', id: id.trim(), fmt: fmt, path: path });
      setSrc(path + '?t=' + Date.now());
    }

    return e(Container, { maxWidth: 'sm', sx: { py: 6 } },
      e(Typography, { variant: 'h4', gutterBottom: true, fontWeight: 700 }, 'ModParks Recipe'),
      e(Typography, { color: 'text.secondary', sx: { mb: 3 } },
        'アイテムIDを入力してクラフトレシピ画像を確認できます。'),
      e('form', { onSubmit: submit },
        e(Stack, { direction: { xs: 'column', sm: 'row' }, spacing: 1.5, sx: { mb: 3 } },
          e(TextField, { label: 'namespace', value: ns, onChange: (x) => setNs(x.target.value), sx: { width: { sm: 140 } } }),
          e(TextField, { label: 'item id', placeholder: 'wooden_sword', value: id, onChange: (x) => setId(x.target.value), autoFocus: true, fullWidth: true }),
          e(TextField, { label: '形式', select: true, value: fmt, onChange: (x) => setFmt(x.target.value), sx: { width: { sm: 130 } } },
            e(MenuItem, { value: 'png' }, 'PNG'),
            e(MenuItem, { value: 'gif' }, 'GIF'),
            e(MenuItem, { value: 'jpg' }, 'JPG')),
          e(Button, { type: 'submit', variant: 'contained', size: 'large' }, '表示'))),
      status !== 'idle' && shown && e(Card, { variant: 'outlined' },
        e(CardContent, { sx: { textAlign: 'center' } },
          e(Typography, { variant: 'h6', sx: { mb: 0.5, wordBreak: 'break-all' } }, shown.ns + ':' + shown.id),
          e(Typography, { variant: 'caption', color: 'text.secondary', sx: { display: 'block', mb: 2 } },
            'namespace: ' + shown.ns + ' / item: ' + shown.id + ' / ' + shown.fmt.toUpperCase()),
          status === 'loading' && e(CircularProgress, { size: 28 }),
          status === 'error' && e(Typography, { color: 'error' }, 'レシピが見つかりませんでした。'),
          e('img', {
            src: src || '',
            alt: 'recipe',
            onLoad: () => setStatus('ok'),
            onError: () => setStatus('error'),
            style: {
              display: status === 'ok' ? 'inline-block' : 'none',
              imageRendering: 'pixelated', maxWidth: '100%',
              borderRadius: 6, background: '#1e1e1e'
            }
          }),
          status === 'ok' && e(Box, { sx: { mt: 1.5, fontSize: 13, wordBreak: 'break-all' } },
            e(Link, { href: shown.path }, location.origin + shown.path)))));
  }

  ReactDOM.createRoot(document.getElementById('root')).render(
    e(ThemeProvider, { theme: theme }, e(CssBaseline, null), e(App, null))
  );
})();
</script>
</body>
</html>`;
