/**
 * @fileoverview 投稿ポータルの表示部品。
 */

import { useEffect, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { fetchOwner, type Me, type Provider, type UploadRecord, type UploadSummary } from './api';
import type { Messages } from '../../utils/i18n/portal';

/** 部品が共通で受け取る文言。 */
type WithMessages = { t: Messages };

/** 見出し付きの区画。区切りは下線1本だけ（カード・影は使わない）。 */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box sx={{ mt: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 0.75, mb: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="subtitle2">{title}</Typography>
      </Box>
      {children}
    </Box>
  );
}

/** ログイン手段のボタン。 */
export function SignInView({ t, providers }: WithMessages & { providers: Provider[] | null }) {
  if (providers === null) return <CircularProgress size={20} />;
  if (providers.length === 0) {
    return (
      <Typography variant="body2" color="error">
        {t.noProviders}
      </Typography>
    );
  }
  return (
    <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
      {providers.map((p) => (
        <Button
          key={p.id}
          variant="contained"
          onClick={() => {
            window.location.href = `/auth/${p.id}/start?redirect=/upload`;
          }}
        >
          {t.signInWith.replace('{provider}', p.name)}
        </Button>
      ))}
    </Stack>
  );
}

/** ログイン中の表示とログアウト。 */
export function AccountRow({ t, me, onSignOut }: WithMessages & { me: Me; onSignOut: () => void }) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
      <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }}>
        {me.displayName}
      </Typography>
      <Chip size="small" variant="outlined" label={t.remaining.replace('{remaining}', String(me.remaining))} />
      <Button size="small" variant="outlined" onClick={onSignOut}>
        {t.signOut}
      </Button>
    </Stack>
  );
}

/** jar の選択と進行状況。 */
export function JarPicker(props: WithMessages & {
  busy: boolean;
  fileName: string;
  status: string;
  error: string;
  onPick: (file: File | null) => void;
}) {
  const { t } = props;
  return (
    <Box>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Button
          variant="contained"
          component="label"
          disabled={props.busy}
          sx={{ maxWidth: '100%', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {props.fileName || t.chooseJar}
          <input type="file" accept=".jar" hidden onChange={(ev) => props.onPick(ev.target.files?.[0] ?? null)} />
        </Button>
        {props.busy && <CircularProgress size={18} />}
      </Stack>
      {props.status && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {props.status}
        </Typography>
      )}
      {props.error && (
        <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
          {props.error}
        </Typography>
      )}
    </Box>
  );
}

/** 取り込んだ namespace の1行。所有権の確認と主張をここで完結させます。 */
function NamespaceRow({ t, ns, onClaim }: WithMessages & { ns: string; onClaim: (ns: string) => Promise<{ trust: string }> }) {
  const [owner, setOwner] = useState<{ claimed?: boolean; trust?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchOwner(ns).then(setOwner).catch(() => setOwner({}));
  }, [ns]);

  async function claim() {
    setBusy(true);
    setError('');
    try {
      const claimed = await onClaim(ns);
      setOwner({ claimed: true, trust: claimed.trust });
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errorGeneric);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="center"
      flexWrap="wrap"
      useFlexGap
      sx={{ py: 1, borderBottom: 1, borderColor: 'divider' }}
    >
      <Typography variant="body2" sx={{ fontFamily: 'monospace', flexGrow: 1, minWidth: 0 }}>
        {ns}
      </Typography>
      {error && (
        <Typography variant="caption" color="error">
          {error}
        </Typography>
      )}
      {owner?.claimed ? (
        <Chip size="small" variant="outlined" label={owner.trust === 'verified' ? t.trustVerified : t.trustUnverified} />
      ) : (
        <Button size="small" variant="outlined" disabled={busy || owner === null} onClick={claim}>
          {busy ? t.claiming : t.claim}
        </Button>
      )}
    </Stack>
  );
}

/** 投入結果。 */
export function ResultView({ t, result, onClaim }: WithMessages & {
  result: UploadSummary;
  onClaim: (ns: string) => Promise<{ trust: string }>;
}) {
  return (
    <Section title={t.resultTitle}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {`${t.extracted}: ${result.count}`}
      </Typography>
      {result.namespaces.map((ns) => (
        <NamespaceRow key={ns} t={t} ns={ns} onClaim={onClaim} />
      ))}
    </Section>
  );
}

/** 本人の投入履歴。 */
export function HistoryView({ t, rows }: WithMessages & { rows: UploadRecord[] | null }) {
  if (rows === null) {
    return (
      <Section title={t.historyTitle}>
        <CircularProgress size={20} />
      </Section>
    );
  }
  if (rows.length === 0) {
    return (
      <Section title={t.historyTitle}>
        <Typography variant="body2" color="text.secondary">
          {t.historyEmpty}
        </Typography>
      </Section>
    );
  }
  return (
    <Section title={t.historyTitle}>
      {rows.map((row) => (
        <Stack
          key={row.id}
          direction="row"
          spacing={1.5}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          sx={{ py: 1, borderBottom: 1, borderColor: 'divider' }}
        >
          <Typography variant="body2" sx={{ fontFamily: 'monospace', flexGrow: 1, minWidth: 0 }}>
            {row.ns}
          </Typography>
          <Chip size="small" variant="outlined" label={sourceLabel(t, row.source)} />
          <Typography variant="caption" color="text.secondary">
            {t.historyItems.replace('{count}', String(row.items))}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {new Date(`${row.createdAt}Z`).toLocaleString()}
          </Typography>
        </Stack>
      ))}
    </Section>
  );
}

/**
 * 投入経路の表示名を返します。
 * @param t 文言表
 * @param source 投入経路
 */
function sourceLabel(t: Messages, source: string): string {
  if (source === 'jar') return t.sourceJar;
  if (source === 'commit') return t.sourceCommit;
  return t.sourceBulk;
}

/**
 * 保存せずに描画した結果の一覧。
 * @param images レシピIDからデータURLへの対応
 */
export function PreviewView(props: WithMessages & {
  ids: string[];
  images: Record<string, string | null>;
  onDownload: () => void;
}) {
  const { t } = props;
  const shown = props.ids.filter((id) => props.images[id]);
  if (shown.length === 0) return <Typography variant="body2" color="text.secondary">{t.previewEmpty}</Typography>;

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        <Chip size="small" variant="outlined" label={shown.length} />
        <Button size="small" variant="outlined" onClick={props.onDownload}>
          {t.previewDownload}
        </Button>
      </Stack>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        {shown.map((id) => (
          <Box key={id}>
            <img
              src={props.images[id]!}
              alt={id}
              loading="lazy"
              style={{ width: '100%', height: 'auto', imageRendering: 'pixelated' }}
            />
            <Typography variant="caption" color="text.secondary" noWrap title={id} sx={{ display: 'block' }}>
              {id}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
