/**
 * @fileoverview 投稿ポータルのクライアントスクリプト。
 *
 * MUI の UMD 版を CDN から読み、React.createElement で組み立てます（ビルド手順なし）。
 * 文言は `window.MPR_MESSAGES` からのみ取ります。ここに文字列を直接書くと言語が増やせません。
 */

import { APP_THEME } from '../ui/theme';
import { PORTAL_PARTS } from './parts';

/** ページ側のスクリプト。 */
export const PORTAL_SCRIPT = /* js */ `
(function () {
  const t = window.MPR_MESSAGES;
  const e = React.createElement;
  const TOKEN_KEY = 'mpr_token';
  const { ThemeProvider, createTheme, Container, Box, Stack, Typography, Button, Chip, CircularProgress } = MaterialUI;

  ${APP_THEME}
  ${PORTAL_PARTS}

  // コールバックは #token=... を付けて戻ってくる。URLに残すと共有時に漏れるので消す。
  if (location.hash.indexOf('#token=') === 0) {
    writeStored(TOKEN_KEY, location.hash.slice(7));
    history.replaceState(null, '', location.pathname + location.search);
  }

  let token = readStored(TOKEN_KEY);

  function readStored(key) {
    try { return localStorage.getItem(key); } catch (err) { return null; }
  }

  function writeStored(key, value) {
    try { localStorage.setItem(key, value); } catch (err) { /* 保存できなくても投稿はできる */ }
  }

  function authHeaders() {
    return { Authorization: 'Bearer ' + token };
  }

  /**
   * jar をクライアント側で展開して投入します。
   * 展開に失敗したときだけサーバへ丸ごと送ります（jar 本体を送らずに済むほうが軽いため）。
   */
  function uploadJar(file) {
    return readArrayBuffer(file)
      .then(buf => JSZip.loadAsync(buf))
      .then(zip => analyzeJar(zip))
      .then(extracted => {
        if (extracted.namespaces.length === 0) throw new Error(t.errorGeneric);
        return sendExtracted(extracted);
      })
      .catch(err => {
        console.warn('Client extraction failed, falling back to server side:', err);
        return sendWholeJar(file);
      });
  }

  function readArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = ev => resolve(ev.target.result);
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsArrayBuffer(file);
    });
  }

  function sendExtracted(extracted) {
    const posts = extracted.namespaces.map(ns =>
      fetch('/api/' + ns + '/bulk', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
        body: JSON.stringify(extracted.byNs[ns]),
      }).then(res => {
        if (res.status === 429) throw new Error(t.errorLimit);
        if (!res.ok) throw new Error(t.errorGeneric);
        return res.json();
      }));

    return Promise.all(posts).then(bodies => ({
      count: bodies.reduce((sum, b) => sum + (b.recipes || 0) + (b.textures || 0) + (b.models || 0) + (b.tags || 0) + (b.langs || 0), 0),
      namespaces: extracted.namespaces,
    }));
  }

  function sendWholeJar(file) {
    const body = new FormData();
    body.append('jar', file);
    return fetch('/api/upload', { method: 'POST', headers: authHeaders(), body: body }).then(res => {
      if (res.status === 429) throw new Error(t.errorLimit);
      if (res.status === 400) throw new Error(t.errorTooLarge);
      if (!res.ok) throw new Error(t.errorGeneric);
      return res.json();
    });
  }

  function claimNamespace(ns) {
    return fetch('/api/' + ns + '/claim', { method: 'POST', headers: authHeaders() }).then(res => {
      if (res.status === 409) throw new Error(t.errorOwned);
      if (!res.ok) throw new Error(t.errorGeneric);
      return res.json();
    });
  }

  function App() {
    const [me, setMe] = React.useState(null);
    const [providers, setProviders] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const [fileName, setFileName] = React.useState('');
    const [status, setStatus] = React.useState('');
    const [error, setError] = React.useState('');
    const [result, setResult] = React.useState(null);
    const [history, setHistory] = React.useState(null);

    React.useEffect(() => {
      if (!token) {
        fetch('/auth/providers.json').then(r => r.ok ? r.json() : { providers: [] })
          .then(body => setProviders(body.providers || []))
          .catch(() => setProviders([]));
        return;
      }
      fetch('/auth/me', { headers: authHeaders() })
        .then(res => { if (!res.ok) throw new Error('unauthenticated'); return res.json(); })
        .then(setMe)
        .catch(signOut);
    }, []);

    React.useEffect(() => { if (me) loadHistory(); }, [me]);

    function loadHistory() {
      fetch('/auth/me/uploads', { headers: authHeaders() })
        .then(r => r.ok ? r.json() : { uploads: [] })
        .then(d => setHistory(d.uploads || []))
        .catch(() => setHistory([]));
    }

    function signOut() {
      try { localStorage.removeItem(TOKEN_KEY); } catch (err) { /* 消せなくてもリロードで再判定される */ }
      location.reload();
    }

    function pick(file) {
      if (!file) return;
      setFileName(file.name);
      setBusy(true);
      setStatus(t.uploading);
      setError('');
      uploadJar(file)
        .then(summary => { setResult(summary); setStatus(''); loadHistory(); })
        .catch(err => { setStatus(''); setError(err.message || t.errorGeneric); })
        .then(() => setBusy(false));
    }

    const body = !token
      ? e(Box, { sx: { mt: 3 } }, e(SignInView, { providers: providers, onSignIn: p => { location.href = '/auth/' + p.id + '/start?redirect=/upload'; } }))
      : me === null
        ? e(Box, { sx: { py: 3 } }, e(CircularProgress, { size: 20 }))
        : e(React.Fragment, null,
            e(Section, { title: t.signedIn }, e(AccountRow, { me: me, onSignOut: signOut })),
            e(Section, { title: t.title },
              e(JarPicker, { busy: busy, fileName: fileName, status: status, error: error, onPick: pick })),
            result && e(ResultView, { result: result, onClaim: claimNamespace }),
            e(HistoryView, { rows: history }));

    return e(Container, { maxWidth: 'md', sx: { py: 3 } },
      e(Typography, { variant: 'h6', sx: { mb: 0.5 } }, t.title),
      e(Typography, { variant: 'body2', color: 'text.secondary' }, t.lead),
      body);
  }

  ReactDOM.createRoot(document.getElementById('root')).render(e(ThemeProvider, { theme: theme }, e(App, null)));
})();
`;
