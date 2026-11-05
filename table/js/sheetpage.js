/* The character sheet page: /table/sheet.html?c=<campaign>&ch=<character>[&embed=1]
 * Opened inside the table as a floating panel (embed) or in its own window (pop out). */
'use strict';
(async function () {
  const { $, h } = V;
  const p = new URLSearchParams(location.search);
  const cid = p.get('c'), chid = p.get('ch'), embed = p.has('embed');
  document.body.classList.toggle('embed', embed);
  if (!cid || !chid) { $('#sheet').textContent = 'No character chosen.'; return; }
  let reg;
  try { reg = await fetch('/table/sheets/registry.json').then(r => r.json()); } catch (e) { reg = {}; }
  let built = false, pending = null, builtSheet = null;
  V.on('charSheet', m => { if (m.char === chid && m.sheet !== builtSheet) location.reload(); });   // switched to the other sheet

  V.on('conn', ok => { $('#conn').classList.toggle('bad', !ok); if (ok) open(); });
  V.on('charState', c => {
    if (c.id !== chid) return;
    document.title = c.name + ' · Sheet';
    $('#charName').textContent = c.name;
    $('#sheetKind').textContent = (reg[c.sheet] && reg[c.sheet].name) || c.sheet;
    $('#readonly').hidden = !!c.canEdit;
    $('#avatar').style.backgroundImage = c.avatar ? `url("${c.avatar}")` : '';
    if (!built) { pending = c; builtSheet = c.sheet; build(c.sheet); } else if (c.sheet !== builtSheet) location.reload(); else RS.load(c);
  });
  V.on('charAttrs', m => { if (m.char === chid) { RS.remote(m); if (m.name) { $('#charName').textContent = m.name; document.title = m.name + ' · Sheet'; } } });
  V.on('charGone', id => { if (id === chid) { $('#sheet').replaceChildren(h('p', { class: 'muted', style: 'padding:20px' }, 'This character was deleted.')); } });
  RS.onName = n => { $('#charName').textContent = n; document.title = n + ' · Sheet'; };

  async function build(sheet) {
    built = true;
    try {
      const base = `/table/sheets/${sheet}/`;
      const [html, css, us, tr] = await Promise.all([
        fetch(base + 'sheet.html').then(r => { if (!r.ok) throw new Error('Sheet not found: ' + sheet); return r.text(); }),
        fetch(base + 'sheet.css').then(r => r.ok ? r.text() : ''),
        fetch('/table/vendor/underscore-min.js').then(r => r.text()),
        reg[sheet] && reg[sheet].i18n ? fetch(base + 'translation.json').then(r => r.ok ? r.json() : {}).catch(() => ({})) : {}]);
      RS.underscore = us;
      RS.build(html, css, tr);
      RS.load(pending);
      if (p.get('run') || p.get('warm')) {   // opened hidden, to roll its buttons (a link in the chat, the action bar)
        document.body.classList.add('runonly');
        RS.onRolled = () => parent.postMessage({ t: 'ranButton' }, location.origin);
        // a roll that asks a question (?{...}) needs to be seen: the table shows this frame until it's answered
        new MutationObserver(() => { if (!$('#modal').hidden) parent.postMessage({ t: 'runNeedsUI' }, location.origin); else setTimeout(() => parent.postMessage({ t: 'ranButton' }, location.origin), 1500); })
          .observe($('#modal'), { attributes: true, attributeFilter: ['hidden'] });
        setTimeout(() => { if (!p.get('run') || !RS.runButton(p.get('run'))) parent.postMessage({ t: 'ranButton' }, location.origin); }, 300);
      }
    } catch (e) { $('#sheet').replaceChildren(h('p', { class: 'err', style: 'padding:20px' }, e.message)); }
  }
  function open() { V.send({ t: 'charOpen', char: chid }).catch(e => $('#sheet').replaceChildren(h('p', { class: 'err', style: 'padding:20px' }, e.message))); }

  if (embed) {
    $('#popout').hidden = false;
    $('#popout').onclick = () => {
      const url = location.pathname + '?c=' + cid + '&ch=' + chid;
      window.open(url, 'sheet-' + chid, 'width=920,height=960');
      parent.postMessage({ t: 'sheetPoppedOut', ch: chid }, location.origin);
    };
  }
  window.addEventListener('message', e => {
    if (e.origin === location.origin && e.data && e.data.t === 'runButton' && built) RS.runButton(e.data.ref);
    if (e.origin === location.origin && e.data && e.data.t === 'night') applyNight();
  });
  // night mode: remembered in this browser; the table's ☾ button and this one share it
  const night = () => { let v = null; try { v = localStorage.getItem('vtt-sheet-night'); } catch (e) { /* blocked */ } return v == null ? matchMedia('(prefers-color-scheme: dark)').matches : v === '1'; };
  const applyNight = () => document.body.classList.toggle('night', night());
  applyNight();
  window.addEventListener('storage', e => { if (e.key === 'vtt-sheet-night') applyNight(); });
  $('#nightBtn').onclick = () => { try { localStorage.setItem('vtt-sheet-night', night() ? '0' : '1'); } catch (e) { /* blocked */ } applyNight(); };
  V.connect(cid, null, { lite: true });
})();
