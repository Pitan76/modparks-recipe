/**
 * @fileoverview 投稿ポータル本体。ログイン状態と投入の進行を持ちます。
 */

import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import {
  claimNamespace,
  fetchHistory,
  fetchMe,
  fetchProviders,
  previewJar,
  uploadJar,
  type Me,
  type PreviewResult,
  type Provider,
  type UploadRecord,
  type UploadSummary,
} from './api';
import { AccountRow, HistoryView, JarPicker, PreviewView, ResultView, Section, SignInView } from './parts';
import { saveDataUrlZip } from './preview-zip';
import { renderJarLocally, svgDataUrl, svgToPngDataUrl } from './local-render';
import { readStored, removeStored, writeStored } from '../shared/browser';
import type { ZipLike } from '../../core/jar-assets';
import { messagesFor } from '../../utils/i18n/portal';

/** JSZip はページに読み込まれたものを使います。 */
declare const JSZip: { loadAsync(data: ArrayBuffer): Promise<ZipLike> };

/** トークンの保存キー。 */
const TOKEN_KEY = 'mpr_token';

/**
 * ログインから戻ってきたトークンを取り出します。
 * URLに残すと共有時に漏れるため、保存したら消します。
 */
function takeToken(): string | null {
  if (window.location.hash.indexOf('#token=') === 0) {
    writeStored(TOKEN_KEY, window.location.hash.slice(7));
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return readStored(TOKEN_KEY);
}

export function App({ locale }: { locale: string }) {
  const t = messagesFor(locale);
  const [token] = useState<string | null>(takeToken);
  const [me, setMe] = useState<Me | null>(null);
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<UploadSummary | null>(null);
  const [history, setHistory] = useState<UploadRecord[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [localFailed, setLocalFailed] = useState(false);

  const signOut = useCallback(() => {
    removeStored(TOKEN_KEY);
    window.location.reload();
  }, []);

  const loadHistory = useCallback(() => {
    if (!token) return;
    fetchHistory(token).then(setHistory).catch(() => setHistory([]));
  }, [token]);

  useEffect(() => {
    if (!token) {
      fetchProviders().then(setProviders).catch(() => setProviders([]));
      return;
    }
    fetchMe(token).then(setMe).catch(signOut);
  }, [token, signOut]);

  useEffect(() => {
    if (me) loadHistory();
  }, [me, loadHistory]);

  /**
   * jar を選びます。投稿はしません。
   *
   * 選んだ時点でこの端末だけでプレビューを作ります。サーバは素材を返すだけなので、
   * 描画のためにファイルを送る必要がありません。作れなかったときだけサーバ描画に頼ります。
   */
  function pick(next: File | null) {
    if (!next) return;
    setFile(next);
    setFileName(next.name);
    setResult(null);
    setPreview(null);
    setLocalFailed(false);
    setError('');
    void previewLocally(next);
  }

  /** この端末だけでプレビューを作ります。 */
  async function previewLocally(target: File) {
    setBusy(true);
    try {
      const zip = await JSZip.loadAsync(await target.arrayBuffer());
      const rendered = await renderJarLocally(zip, (n, total) => {
        setStatus(t.previewLocal.replace('{done}', String(n)).replace('{total}', String(total)));
      });
      if (rendered.length === 0) throw new Error('no recipes');

      setPreview({
        ids: rendered.map((r) => r.id),
        images: Object.fromEntries(rendered.map((r) => [r.id, svgDataUrl(r.svg)])),
      });
      setStatus('');
    } catch (err) {
      console.warn('Local render failed, offering server-side preview:', err);
      setLocalFailed(true);
      setStatus('');
    } finally {
      setBusy(false);
    }
  }

  /** 選んだ jar を投稿します。こちらは投稿枠を消費します。 */
  async function upload() {
    if (!file || !token || busy) return;
    setBusy(true);
    setStatus(t.uploading);
    setError('');
    try {
      setResult(await uploadJar(file, token, t));
      setStatus('');
      loadHistory();
    } catch (err) {
      setStatus('');
      setError(err instanceof Error ? err.message : t.errorGeneric);
    } finally {
      setBusy(false);
    }
  }

  /** 保存せずに描画します。投稿ではないので枠を消費しません。 */
  async function runPreview() {
    if (!file || !token || busy) return;
    setBusy(true);
    setError('');
    setPreview(null);
    try {
      const done = await previewJar(file, token, t, (n, total) => {
        setStatus(t.previewing.replace('{done}', String(n)).replace('{total}', String(total)));
      });
      setPreview(done);
      setStatus('');
    } catch (err) {
      setStatus('');
      setError(err instanceof Error ? err.message : t.errorGeneric);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Container maxWidth="md" sx={{ px: { xs: 1.5, sm: 3 }, py: { xs: 2, sm: 3 } }}>
      <Typography variant="h6" sx={{ mb: 0.5 }}>{t.title}</Typography>
      <Typography variant="body2" color="text.secondary">{t.lead}</Typography>
      {!token ? (
        <Box sx={{ mt: 3 }}>
          <SignInView t={t} providers={providers} />
        </Box>
      ) : me === null ? (
        <Box sx={{ py: 3 }}>
          <CircularProgress size={20} />
        </Box>
      ) : (
        <>
          <Section title={t.signedIn}>
            <AccountRow t={t} me={me} onSignOut={signOut} />
          </Section>
          <Section title={t.title}>
            <JarPicker t={t} busy={busy} fileName={fileName} status={status} error={error} onPick={pick} />
            <Button variant="contained" disabled={!file || busy} onClick={upload} sx={{ mt: 1.5 }}>
              {t.upload}
            </Button>
          </Section>
          <Section title={t.preview}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{t.previewLead}</Typography>
            {localFailed && (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t.previewLocalFailed}</Typography>
                <Button variant="outlined" disabled={!file || busy} onClick={runPreview}>{t.preview}</Button>
              </>
            )}
            {preview && (
              <Box sx={{ mt: 2 }}>
                <PreviewView
                  t={t}
                  ids={preview.ids}
                  images={preview.images}
                  onDownload={() => saveDataUrlZip(preview.images, `${fileName.replace(/\.jar$/i, '')}-recipes.zip`)}
                />
              </Box>
            )}
          </Section>
          {result && <ResultView t={t} result={result} onClaim={(ns) => claimNamespace(ns, token, t)} />}
          <HistoryView t={t} rows={history} />
        </>
      )}
    </Container>
  );
}
