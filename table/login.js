/* Log in, or join with an invite link (/join/<token>). */
'use strict';
(async function () {
  const $ = s => document.querySelector(s);
  const join = /^\/join\/([a-f0-9]+)/.exec(location.pathname);
  const next = new URLSearchParams(location.search).get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/table/';
  const show = (el, text) => { el.textContent = text || ''; el.hidden = !text; };
  const site = (window.VALANAR_SERVER || {}).siteName || 'the table';
  for (const b of document.querySelectorAll('.brand')) b.textContent = site;
  document.title = `${site} · Log in`;
  // an open site: visitors can go back to reading (and watching) without an account
  if (!join && window.VALANAR_SERVER && !window.VALANAR_SERVER.private) {
    $('#alt').hidden = false;
    if (next && next.startsWith('/') && !next.startsWith('//')) $('#alt a').href = next;
  }

  if (join) {
    const r = await fetch('/api/invite/' + join[1]).then(r => r.json()).catch(() => ({ error: 'The table can’t be reached.' }));
    $('#ttl').textContent = r.error ? 'Invite link' : 'Join the table';
    if (r.error) { show($('#err'), r.error); $('#form').hidden = true; return; }
    $('#sub').textContent = r.campaign ? `You’ve been invited to ${r.campaign}${r.role === 'gm' ? ' as a GM' : ''}.` : `You’ve been invited to ${site}.`;
    $('#password').autocomplete = 'new-password';
    show($('#hint'), 'Choose the name the table will call you and a password (six characters or more). Already have an account? Use your usual name and password.');
    $('#go').textContent = 'Join';
  }

  $('#form').addEventListener('submit', async e => {
    e.preventDefault();
    show($('#err'), '');
    $('#go').disabled = true;
    const body = { name: $('#name').value.trim(), password: $('#password').value };
    if (join) body.token = join[1];
    const r = await fetch(join ? '/api/join' : '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => r.json()).catch(() => ({ error: 'The table can’t be reached.' }));
    $('#go').disabled = false;
    if (r.error) return show($('#err'), r.error);
    location.href = join ? ('/table/' + (r.campaign ? '?c=' + r.campaign : '')) : safeNext;
  });
})();
