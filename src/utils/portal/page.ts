/**
 * @fileoverview 投稿ポータルのHTML。
 *
 * 文言はサーバ側で選んだ表を埋め込み、スクリプトはそれを参照するだけにしています。
 * ページ内に日本語も英語も書かないため、言語を増やしても触るのは messages.ts だけです。
 */

import { messagesFor, type Messages } from '../i18n/portal';

/**
 * 投稿ポータルのページを組み立てます。
 * @param locale 表示言語
 * @returns HTML文字列
 */
export function portalPage(locale: string): string {
  const t: Messages = messagesFor(locale);
  return /* html */ `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${t.title}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0f172a; color: #e2e8f0;
         font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 40rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
  p.lead { color: #94a3b8; margin: 0 0 2rem; line-height: 1.7; }
  section { border: 1px solid #1e293b; border-radius: .5rem; padding: 1.25rem; margin-bottom: 1rem; }
  button { background: #38bdf8; color: #0f172a; border: 0; border-radius: .375rem;
           padding: .5rem 1rem; font-size: .9rem; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  button.ghost { background: transparent; color: #94a3b8; border: 1px solid #334155; }
  .row { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
  .muted { color: #94a3b8; font-size: .85rem; }
  .badge { font-size: .7rem; padding: .15rem .5rem; border-radius: 999px; border: 1px solid #334155; }
  .badge.verified { color: #4ade80; border-color: #14532d; }
  .badge.unverified { color: #fbbf24; border-color: #78350f; }
  .error { color: #f87171; }
  input[type=file] { color: #94a3b8; font-size: .85rem; }
  ul { list-style: none; padding: 0; margin: .75rem 0 0; }
  li { display: flex; align-items: center; gap: .75rem; padding: .5rem 0; border-top: 1px solid #1e293b; }
  code { font-family: ui-monospace, monospace; }
</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
<script src="/extractor.js"></script>
</head>
<body>
<main>
  <h1>${t.title}</h1>
  <p class="lead">${t.lead}</p>
  <section id="app"></section>
</main>
<script>
window.MPR_MESSAGES = ${JSON.stringify(t)};
${PORTAL_SCRIPT}
</script>
</body>
</html>`;
}

/**
 * ページ側のスクリプト。
 *
 * 文言は `window.MPR_MESSAGES` からのみ取ります。ここに文字列を直接書くと言語が増やせません。
 */
const PORTAL_SCRIPT = /* js */ `
(function () {
  var t = window.MPR_MESSAGES;
  var app = document.getElementById('app');
  var TOKEN_KEY = 'mpr_token';

  // コールバックは #token=... を付けて戻ってくる。URLに残すと共有時に漏れるので消す。
  if (location.hash.indexOf('#token=') === 0) {
    localStorage.setItem(TOKEN_KEY, location.hash.slice(7));
    history.replaceState(null, '', location.pathname + location.search);
  }

  var token = localStorage.getItem(TOKEN_KEY);

  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'class') node.className = props[k];
      else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), props[k]);
      else node.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) {
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function clear() { app.innerHTML = ''; }

  function signInView(providers) {
    clear();
    app.appendChild(el('p', { class: 'muted' }, [t.signInLead]));
    if (providers.length === 0) {
      app.appendChild(el('p', { class: 'error' }, [t.noProviders]));
      return;
    }
    providers.forEach(function (p) {
      app.appendChild(el('button', {
        onclick: function () { location.href = '/auth/' + p.id + '/start?redirect=/upload'; }
      }, [t.signInWith.replace('{provider}', p.name)]));
    });
  }

  function uploadView(me) {
    clear();
    app.appendChild(el('div', { class: 'row' }, [
      el('span', { class: 'muted' }, [t.signedInAs + ': ' + me.displayName]),
      el('span', { class: 'muted' }, [t.remaining + ': ' + me.remaining]),
      el('button', { class: 'ghost', onclick: function () {
        localStorage.removeItem(TOKEN_KEY); location.reload();
      } }, [t.signOut])
    ]));

    var file = el('input', { type: 'file', accept: '.jar' });
    var status = el('p', { class: 'muted' }, []);
    var submit = el('button', { onclick: function () { send(file, submit, status); } }, [t.upload]);

    app.appendChild(el('p', { class: 'muted' }, [t.chooseFile]));
    app.appendChild(el('div', { class: 'row' }, [file, submit]));
    app.appendChild(status);
  }

  function send(file, submit, status) {
    if (!file.files || !file.files[0]) return;
    submit.disabled = true;
    status.className = 'muted';
    status.textContent = t.uploading;

    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        JSZip.loadAsync(e.target.result)
          .then(function (zip) {
            return analyzeJar(zip);
          })
          .then(function (result) {
            if (result.namespaces.length === 0) throw new Error(t.errorGeneric);
            var promises = result.namespaces.map(function (ns) {
              return fetch('/api/' + ns + '/bulk', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify(result.data)
              }).then(function (res) {
                if (res.status === 429) throw new Error(t.errorLimit);
                if (!res.ok) throw new Error(t.errorGeneric);
                return res.json();
              });
            });
            return Promise.all(promises).then(function (bodies) {
              var totalCount = bodies.reduce(function (sum, b) {
                return sum + (b.recipes || 0) + (b.textures || 0) + (b.models || 0) + (b.tags || 0) + (b.langs || 0);
              }, 0);
              return { count: totalCount, namespaces: result.namespaces };
            });
          })
          .then(function (summary) {
            resultView(summary);
          })
          .catch(function (err) {
            console.warn('Client extraction failed, falling back to server side:', err);
            fallbackToServer(file.files[0], submit, status);
          });
      } catch (err) {
        fallbackToServer(file.files[0], submit, status);
      }
    };
    reader.onerror = function () {
      fallbackToServer(file.files[0], submit, status);
    };
    reader.readAsArrayBuffer(file.files[0]);
  }

  function fallbackToServer(fileBlob, submit, status) {
    status.textContent = t.uploading + ' (サーバー処理中...)';
    var body = new FormData();
    body.append('jar', fileBlob);
    fetch('/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: body })
      .then(function (res) {
        if (res.status === 429) throw new Error(t.errorLimit);
        if (res.status === 400) throw new Error(t.errorTooLarge);
        if (!res.ok) throw new Error(t.errorGeneric);
        return res.json();
      })
      .then(function (result) {
        resultView(result);
      })
      .catch(function (err) {
        submit.disabled = false;
        status.className = 'error';
        status.textContent = err.message || t.errorGeneric;
      });
  }

  function resultView(result) {
    var box = el('section', {}, [
      el('h2', {}, [t.resultTitle]),
      el('p', { class: 'muted' }, [t.extracted + ': ' + result.count])
    ]);
    var list = el('ul', {}, []);
    (result.namespaces || []).forEach(function (ns) { list.appendChild(namespaceRow(ns)); });
    box.appendChild(el('p', { class: 'muted' }, [t.namespaces]));
    box.appendChild(list);
    app.parentNode.appendChild(box);
  }

  function namespaceRow(ns) {
    var badge = el('span', { class: 'badge' }, []);
    var action = el('button', { class: 'ghost', onclick: function () { claim(ns, badge, action); } }, [t.claim]);
    var row = el('li', {}, [el('code', {}, [ns]), badge, action]);

    fetch('/api/' + ns + '/owner.json').then(function (r) { return r.json(); }).then(function (owner) {
      if (!owner.claimed) return;
      showTrust(badge, owner.trust);
      action.remove();
    });
    return row;
  }

  function claim(ns, badge, action) {
    action.disabled = true;
    action.textContent = t.claiming;
    fetch('/api/' + ns + '/claim', { method: 'POST', headers: { Authorization: 'Bearer ' + token } })
      .then(function (res) {
        if (res.status === 409) throw new Error(t.errorOwned);
        if (!res.ok) throw new Error(t.errorGeneric);
        return res.json();
      })
      .then(function (claimed) { showTrust(badge, claimed.trust); action.remove(); })
      .catch(function (err) {
        action.disabled = false;
        action.className = 'ghost error';
        action.textContent = err.message || t.errorGeneric;
      });
  }

  function showTrust(badge, trust) {
    badge.className = 'badge ' + trust;
    badge.textContent = trust === 'verified' ? t.trustVerified : t.trustUnverified;
  }

  if (!token) {
    fetch('/auth/providers.json').then(function (r) { return r.json(); })
      .then(function (body) { signInView(body.providers || []); });
    return;
  }

  fetch('/auth/me', { headers: { Authorization: 'Bearer ' + token } })
    .then(function (res) {
      if (!res.ok) throw new Error('unauthenticated');
      return res.json();
    })
    .then(uploadView)
    .catch(function () {
      localStorage.removeItem(TOKEN_KEY);
      location.reload();
    });
})();
`;
