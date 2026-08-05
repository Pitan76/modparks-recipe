/**
 * @fileoverview 検索ページの表示部品（クライアントに埋め込むJS片）。
 *
 * 状態を持たない見た目だけの部品を集めています。状態と操作は `script.ts` 側にあります。
 */

/** 言語切替リンクの表示先。 */
interface LangToggle {
  /** 切り替え先の言語コード */
  lang: string;
  /** リンクに出す表示名 */
  label: string;
}

/**
 * 表示部品を定義するJS片を組み立てます。
 * @param toggle 言語切替リンクの内容
 */
export function searchParts(toggle: LangToggle): string {
  return /* js */ `
  function splitId(full) {
    const i = full.indexOf(':');
    return i === -1 ? { ns: 'minecraft', id: full } : { ns: full.slice(0, i), id: full.slice(i + 1) };
  }

  function imagePath(recipeId, fmt) {
    const p = splitId(recipeId);
    return '/api/' + encodeURIComponent(p.ns) + '/' + encodeURIComponent(p.id) + '.' + fmt;
  }

  function ImageTile(props) {
    const [st, setSt] = React.useState('loading');
    const p = splitId(props.recipeId);
    return e('div', { className: 'recipe-item' },
      st === 'loading' && e(CircularProgress, { size: 20, sx: { my: 1 } }),
      st === 'error' && e(Typography, { variant: 'caption', color: 'error' }, props.recipeId + ' ' + t.cannotDisplay),
      e('img', {
        src: imagePath(props.recipeId, props.fmt) + '?t=' + props.nonce, alt: props.recipeId, className: 'recipe-img',
        onLoad: () => setSt('ok'), onError: () => setSt('error'), onClick: props.onClick, title: props.title,
        style: { display: st === 'ok' ? 'block' : 'none' }
      }),
      st === 'ok' && props.name && props.name !== props.recipeId && e('div', { className: 'recipe-name' }, props.name),
      st === 'ok' && e('div', { className: 'recipe-label' }, p.ns + ':' + p.id));
  }

  function AppBar(props) {
    return e('header', { className: 'app-bar' },
      e('div', { className: 'app-bar-inner' },
        e('div', { className: 'app-title' }, t.title),
        e('nav', { className: 'app-nav' },
          e('a', { href: '/?lang=${toggle.lang}' + (props.selected ? '&id=' + encodeURIComponent(props.selected) : '') }, '${toggle.label}'),
          e('a', { href: '/upload' }, t.publish),
          e('a', { href: 'https://github.com/Pitan76/modparks-recipe', target: '_blank', rel: 'noreferrer', 'aria-label': 'GitHub' },
            e('i', { className: 'fa-brands fa-github', style: { fontSize: 18 } })))));
  }

  function SearchForm(props) {
    const clearAdornment = props.q
      ? e(InputAdornment, { position: 'end' },
          e(IconButton, { size: 'small', onClick: () => props.setQ(''), title: t.clear, 'aria-label': t.clear },
            e('i', { className: 'fa-solid fa-xmark', style: { fontSize: 13 } })))
      : null;
    return e('form', { onSubmit: props.onSubmit },
      e(Stack, { direction: { xs: 'column', sm: 'row' }, spacing: 1, alignItems: { sm: 'center' }, sx: { mb: 1.5 } },
        e(TextField, {
          label: t.search, value: props.q, onChange: x => props.setQ(x.target.value), autoFocus: true, fullWidth: true, size: 'small',
          placeholder: 'namespace:id', InputProps: { endAdornment: clearAdornment },
          sx: { maxWidth: { sm: 360 } }
        }),
        e(TextField, { label: 'Mod', select: true, value: props.selNs, onChange: x => props.setSelNs(x.target.value), sx: { width: { sm: 200 } }, size: 'small' },
          props.nss.map(ns => e(MenuItem, { key: ns, value: ns },
            (ns === 'all' ? 'All' : ns) + ' (' + props.nsCounts[ns] + ')'))),
        e(TextField, { label: t.format, select: true, value: props.fmt, onChange: x => props.setFmt(x.target.value), sx: { width: { sm: 110 } }, size: 'small' },
          e(MenuItem, { value: 'png' }, 'PNG'), e(MenuItem, { value: 'gif' }, 'GIF'), e(MenuItem, { value: 'jpg' }, 'JPG')),
        e(Button, { type: 'submit', variant: 'contained', sx: { px: 3, height: 40, minWidth: 88, flexShrink: 0 } }, t.show)));
  }

  function ItemRow(props) {
    return e('div', { className: 'item-row' + (props.selected ? ' selected' : ''), onClick: props.onSelect },
      e(Typography, { variant: 'body2', fontWeight: props.selected ? 500 : 400, noWrap: true }, props.name),
      e(Typography, { variant: 'caption', color: 'text.secondary', display: 'block', noWrap: true, sx: { fontFamily: 'monospace' } }, props.item),
      e('div', { className: 'item-actions' },
        e(IconButton, { size: 'small', onClick: props.onDownload, title: t.download }, e('i', { className: 'fa-solid fa-download', style: { fontSize: 11 } })),
        e(IconButton, { size: 'small', onClick: props.onCopy, title: props.copied ? t.copySuccess : t.copyLink },
          e('i', { className: props.copied ? 'fa-solid fa-check' : 'fa-regular fa-copy', style: { fontSize: 11 } }))));
  }
`;
}
