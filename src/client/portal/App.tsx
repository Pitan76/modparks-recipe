/**
 * @fileoverview 投稿ポータル本体。ログイン状態と投入の進行を持ちます。
 */

import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import {
  claimNamespace,
  fetchHistory,
  fetchMe,
  fetchProviders,
  uploadJar,
  type Me,
  type Provider,
  type UploadRecord,
  type UploadSummary,
} from './api';
import { AccountRow, HistoryView, JarPicker, ResultView, Section, SignInView } from './parts';
import { readStored, removeStored, writeStored } from '../shared/browser';
import { messagesFor } from '../../utils/i18n/portal';

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

  async function pick(file: File | null) {
    if (!file || !token) return;
    setFileName(file.name);
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

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
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
          </Section>
          {result && <ResultView t={t} result={result} onClaim={(ns) => claimNamespace(ns, token, t)} />}
          <HistoryView t={t} rows={history} />
        </>
      )}
    </Container>
  );
}
