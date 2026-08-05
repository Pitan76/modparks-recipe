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
  const leadHtml = t.lead ? `<p class="lead">${t.lead}</p>` : '';
  return /* html */ `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${t.title}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0f172a; color: #e2e8f0;
         font-family: system-ui, -apple-system, "Segoe UI", sans-serif; padding: 2rem 1.25rem 4rem; }
  main { max-width: 32rem; margin: 0 auto; }
  h1 { font-size: 1.25rem; margin: 0 0 1.5rem; }
  p.lead { color: #94a3b8; margin: 0 0 1.5rem; line-height: 1.6; font-size: 0.9rem; }
  #app { margin-top: 1rem; }
  button { background: #38bdf8; color: #0f172a; border: 0;
           padding: .4rem .8rem; font-size: .85rem; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  button.ghost { background: transparent; color: #38bdf8; text-decoration: underline; padding: 0; }
  button.text-btn { background: transparent; color: #38bdf8; text-decoration: underline; padding: 0; }
  .row { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; margin-bottom: 1rem; }
  .muted { color: #94a3b8; font-size: .85rem; }
  .badge { font-size: .75rem; padding: .1rem .4rem; }
  .badge.verified { color: #4ade80; background: #14532d33; }
  .badge.unverified { color: #fbbf24; background: #78350f33; }
  .error { color: #f87171; font-size: .85rem; }
  input[type=file] { color: #e2e8f0; font-size: .85rem; }
  ul { list-style: none; padding: 0; margin: 1rem 0 0; }
  li { display: flex; align-items: center; gap: .75rem; padding: .5rem 0; }
  code { font-family: ui-monospace, monospace; }
</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
<script src="/extractor.js"></script>
</head>
<body>
<main>
  <h1>${t.title}</h1>
  ${leadHtml}
  <div id="app"></div>
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
    if (providers.length === 0) {
      app.appendChild(el('p', { class: 'error' }, [t.noProviders]));
      return;
    }
    var container = el('div', { class: 'row' }, []);
    providers.forEach(function (p) {
      container.appendChild(el('button', {
        onclick: function () { location.href = '/auth/' + p.id + '/start?redirect=/upload'; }
      }, [t.signInWith.replace('{provider}', p.name)]));
    });
    app.appendChild(container);
  }

  function uploadView(me) {
    clear();
    app.appendChild(el('div', { class: 'row' }, [
      el('span', { class: 'muted' }, [me.displayName]),
      el('span', { class: 'muted' }, ['(' + t.remaining.replace('{remaining}', me.remaining) + ')']),
      el('button', { class: 'text-btn', onclick: function () {
        localStorage.removeItem(TOKEN_KEY); location.reload();
      } }, [t.signOut])
    ]));

    var file = el('input', { type: 'file', accept: '.jar' });
    var status = el('p', { class: 'muted' }, []);

    file.addEventListener('change', function () {
      send(file, status);
    });

    app.appendChild(el('div', { class: 'row' }, [file]));
    app.appendChild(status);
  }

  function send(file, status) {
    if (!file.files || !file.files[0]) return;
    file.disabled = true;
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
                body: JSON.stringify(result.byNs[ns])
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
            file.disabled = false;
            file.value = '';
            status.textContent = '';
            resultView(summary);
          })
          .catch(function (err) {
            console.warn('Client extraction failed, falling back to server side:', err);
            fallbackToServer(file.files[0], file, status);
          });
      } catch (err) {
        fallbackToServer(file.files[0], file, status);
      }
    };
    reader.onerror = function () {
      fallbackToServer(file.files[0], file, status);
    };
    reader.readAsArrayBuffer(file.files[0]);
  }

  function fallbackToServer(fileBlob, file, status) {
    status.textContent = t.uploading;
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
        file.disabled = false;
        file.value = '';
        status.textContent = '';
        resultView(result);
      })
      .catch(function (err) {
        file.disabled = false;
        status.className = 'error';
        status.textContent = err.message || t.errorGeneric;
      });
  }

  function resultView(result) {
    var oldBox = document.getElementById('result-box');
    if (oldBox) oldBox.remove();

    var box = el('div', { id: 'result-box' }, [
      el('h2', {}, [t.resultTitle]),
      el('p', { class: 'muted' }, [t.extracted + ': ' + result.count])
    ]);
    var list = el('ul', {}, []);
    (result.namespaces || []).forEach(function (ns) { list.appendChild(namespaceRow(ns)); });
    box.appendChild(list);
    app.appendChild(box);
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
