/**
 * @fileoverview 投稿ポータルの表示部品（クライアントに埋め込むJS片）。
 *
 * 見た目は検索ページと同じ MUI テーマに乗せます。文言は `window.MPR_MESSAGES` からのみ取ります。
 */

/** 表示部品を定義するJS片。 */
export const PORTAL_PARTS = /* js */ `
  /** 区画の見出し。下線1本だけで区切る（カード・影は使わない）。 */
  function SectionHead(props) {
    return e(Box, { sx: { display: 'flex', alignItems: 'center', gap: 1, pb: 0.75, mb: 1.5, borderBottom: 1, borderColor: 'divider' } },
      e(Typography, { variant: 'subtitle2' }, props.title),
      props.badge);
  }

  function Section(props) {
    return e(Box, { sx: { mt: 3 } }, e(SectionHead, { title: props.title, badge: props.badge }), props.children);
  }

  function SignInView(props) {
    if (props.providers === null) return e(CircularProgress, { size: 20 });
    if (props.providers.length === 0) return e(Typography, { variant: 'body2', color: 'error' }, t.noProviders);
    return e(Stack, { direction: 'row', spacing: 1.5, flexWrap: 'wrap', useFlexGap: true },
      props.providers.map(p => e(Button, {
        key: p.id, variant: 'contained', onClick: () => props.onSignIn(p)
      }, t.signInWith.replace('{provider}', p.name))));
  }

  function AccountRow(props) {
    return e(Stack, { direction: 'row', spacing: 1.5, alignItems: 'center' },
      e(Typography, { variant: 'body2', sx: { flexGrow: 1, minWidth: 0 } }, props.me.displayName),
      e(Chip, { size: 'small', variant: 'outlined', label: t.remaining.replace('{remaining}', props.me.remaining) }),
      e(Button, { size: 'small', variant: 'outlined', onClick: props.onSignOut }, t.signOut));
  }

  function JarPicker(props) {
    return e(Box, null,
      e(Stack, { direction: 'row', spacing: 1.5, alignItems: 'center' },
        e(Button, { variant: 'contained', component: 'label', disabled: props.busy },
          props.fileName || t.chooseJar,
          e('input', { type: 'file', accept: '.jar', hidden: true, onChange: ev => props.onPick(ev.target.files[0]) })),
        props.busy && e(CircularProgress, { size: 18 })),
      props.status && e(Typography, { variant: 'caption', color: 'text.secondary', sx: { display: 'block', mt: 1 } }, props.status),
      props.error && e(Typography, { variant: 'caption', color: 'error', sx: { display: 'block', mt: 1 } }, props.error));
  }

  /** 取り込んだ namespace の1行。所有権の確認と主張をここで完結させる。 */
  function NamespaceRow(props) {
    const [owner, setOwner] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState('');

    React.useEffect(() => {
      fetch('/api/' + props.ns + '/owner.json')
        .then(r => r.ok ? r.json() : {})
        .then(setOwner)
        .catch(() => setOwner({}));
    }, [props.ns]);

    function claim() {
      setBusy(true);
      setError('');
      props.onClaim(props.ns)
        .then(claimed => setOwner({ claimed: true, trust: claimed.trust }))
        .catch(err => setError(err.message || t.errorGeneric))
        .then(() => setBusy(false));
    }

    const claimed = !!(owner && owner.claimed);
    return e(Stack, { direction: 'row', spacing: 1.5, alignItems: 'center', sx: { py: 1, borderBottom: 1, borderColor: 'divider' } },
      e(Typography, { variant: 'body2', sx: { fontFamily: 'monospace', flexGrow: 1, minWidth: 0 } }, props.ns),
      error && e(Typography, { variant: 'caption', color: 'error' }, error),
      claimed
        ? e(Chip, { size: 'small', variant: 'outlined', label: owner.trust === 'verified' ? t.trustVerified : t.trustUnverified })
        : e(Button, { size: 'small', variant: 'outlined', disabled: busy || owner === null, onClick: claim }, busy ? t.claiming : t.claim));
  }

  function ResultView(props) {
    return e(Section, { title: t.resultTitle },
      e(Typography, { variant: 'body2', color: 'text.secondary', sx: { mb: 1 } }, t.extracted + ': ' + props.result.count),
      (props.result.namespaces || []).map(ns => e(NamespaceRow, { key: ns, ns: ns, onClaim: props.onClaim })));
  }

  function HistoryView(props) {
    if (props.rows === null) return e(Section, { title: t.historyTitle }, e(CircularProgress, { size: 20 }));
    if (props.rows.length === 0) {
      return e(Section, { title: t.historyTitle }, e(Typography, { variant: 'body2', color: 'text.secondary' }, t.historyEmpty));
    }
    return e(Section, { title: t.historyTitle },
      props.rows.map(row => e(HistoryRow, { key: row.id, row: row })));
  }

  function HistoryRow(props) {
    const row = props.row;
    return e(Stack, { direction: 'row', spacing: 1.5, alignItems: 'center', sx: { py: 1, borderBottom: 1, borderColor: 'divider' } },
      e(Typography, { variant: 'body2', sx: { fontFamily: 'monospace', flexGrow: 1, minWidth: 0 } }, row.ns),
      e(Chip, { size: 'small', variant: 'outlined', label: sourceLabel(row.source) }),
      e(Typography, { variant: 'caption', color: 'text.secondary' }, t.historyItems.replace('{count}', row.items)),
      e(Typography, { variant: 'caption', color: 'text.secondary' }, new Date(row.createdAt + 'Z').toLocaleString()));
  }

  function sourceLabel(source) {
    if (source === 'jar') return t.sourceJar;
    if (source === 'commit') return t.sourceCommit;
    return t.sourceBulk;
  }
`;
