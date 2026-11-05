/* Admin: the site's name and front page, who may see it, people and their roles, backups. Only admins get here.
 * Address: #/admin */
'use strict';
window.ValanarAdmin = function (ctx) {
  const { h, $, toast } = ctx;
  const api = (url, opts) => fetch('/api/site' + url, Object.assign({ credentials: 'same-origin' }, opts)).then(async r => {
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j;
  });
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // if drawing the page goes wrong, say what happened (never a blank page): the error, or a server that doesn't answer
  const problem = (msg) => $('#admin').replaceChildren(h('div', { class: 'adwrap' }, h('h1', null, 'Admin'), h('p', null, msg),
    h('p', { class: 'muted' }, 'Trying again usually fixes this. If it doesn’t, send that message to whoever looks after the site.'),
    h('button', { class: 'btn', onclick: () => show() }, 'Try again'), ' ', h('button', { class: 'btn', onclick: () => location.reload() }, 'Reload the page')));
  let showing = 0;
  async function show() {
    const my = ++showing, root = $('#admin');
    root.replaceChildren(h('div', { class: 'adwrap' }, h('h1', null, 'Admin'), h('p', { class: 'muted adloading' }, 'Loading…')));
    const slow = setTimeout(() => { if (my === showing && root.querySelector('.adloading')) problem('The server hasn’t answered yet (it may be busy, or the connection dropped).'); }, 12000);
    try { await draw(); } catch (e) { console.error(e); if (my === showing) problem('The admin page couldn’t be shown: ' + (e && e.message || e)); }
    finally { clearTimeout(slow); }
    if (my === showing && !root.textContent.trim()) problem('The admin page came out empty.');
  }
  // anything that goes wrong elsewhere while the admin page is empty shows here too
  const caught = e => { const r = $('#admin'); if (r && !r.hidden && !r.textContent.trim()) problem('Something went wrong: ' + ((e.error || e.reason || {}).message || e.message || e.reason || 'unknown error')); };
  window.addEventListener('error', caught); window.addEventListener('unhandledrejection', caught);
  async function draw() {
    const root = $('#admin');
    let st, users;
    try { [st, users] = await Promise.all([api('/admin/settings'), api('/admin/users')]); } catch (e) { root.replaceChildren(h('div', { class: 'adwrap' }, h('h1', null, 'Admin'), h('p', null, e.message))); return; }
    const s = st.settings, me = (window.VALANAR_SERVER || {}).user || {};
    const name = h('input', { value: s.siteName }), tag = h('input', { value: s.tagline });
    const main = h('select', null, h('option', { value: '' }, '(the index page)'), ...ctx.pages().map(p => h('option', { value: p.path, selected: p.path === s.mainPage || null }, p.path)));
    const priv = h('input', { type: 'checkbox', checked: !!s.private });
    const saveSite = () => api('/admin/settings', json('POST', { siteName: name.value.trim(), tagline: tag.value.trim(), mainPage: main.value, private: priv.checked }))
      .then(() => { toast('Saved. Reloading…'); setTimeout(() => location.reload(), 600); }).catch(e => toast(e.message, true));
    // what to send someone: the address, their name and password, in one block to copy
    const loginCard = (title, u, password) => {
      const text = `${s.siteName}: ${location.origin}/\nName: ${u.name}\nPassword: ${password}\n(Log in, then you can change the password in the table's Players tab.)`;
      const box = h('textarea', { class: 'adcopy', rows: 4, readonly: true }, text);
      const card = h('div', { class: 'adcard' }, h('b', null, title), h('p', { class: 'muted' }, 'Send them this. The password isn’t shown again (you can always give them a new one).'), box,
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => { box.select(); try { navigator.clipboard.writeText(text); toast('Copied'); } catch (e) { document.execCommand('copy'); } } }, 'Copy'),
          h('button', { class: 'btn', onclick: () => card.remove() }, 'Done')));
      return card;
    };
    const camps = () => users.campaigns || [];
    const campBoxes = (u, onChange) => camps().length ? h('div', { class: 'adcamps' }, ...camps().map(c => h('label', { class: 'inline', title: u && u.role === 'gm' ? 'Admins see every campaign' : '' },
      h('input', { type: 'checkbox', checked: (u ? c.members.includes(u.id) : false) || null, disabled: u && u.role === 'gm' ? true : null, onchange: e => onChange(c, e.target.checked, e.target) }), c.name))) : h('span', { class: 'muted' }, 'no campaigns yet');
    const peopleRows = () => users.users.map(u => h('tr', null,
      h('td', null, h('span', { class: 'dot', style: `background:${u.color}` }), u.name, u.id === me.id ? h('span', { class: 'muted' }, ' (you)') : null),
      h('td', null, h('select', { onchange: e => api('/admin/users/' + u.id, json('POST', { role: e.target.value })).then(r => { u.role = r.user.role; toast(`${u.name} is now ${u.role === 'gm' ? 'an admin' : 'a player'}`); show(); }).catch(err => { toast(err.message, true); e.target.value = u.role; }) },
        h('option', { value: 'gm', selected: u.role === 'gm' || null }, 'Admin (GM)'), h('option', { value: 'player', selected: u.role === 'player' || null }, 'Player'))),
      h('td', null, u.role === 'gm' ? h('span', { class: 'muted' }, 'all') : campBoxes(u, (c, on, box) => api('/admin/users/' + u.id, json('POST', { campaign: c.id, member: on }))
        .then(r => { users.campaigns = r.campaigns; toast(`${u.name} ${on ? 'joined' : 'left'} ${c.name}`); }).catch(err => { toast(err.message, true); box.checked = !on; }))),
      h('td', null, u.hasPassword ? 'set' : h('span', { class: 'warn' }, 'none')),
      h('td', null, new Date(u.created || 0).toLocaleDateString('en-GB')),
      h('td', null,
        h('button', { class: 'btn sm', onclick: () => { if (!confirm(`Give ${u.name} a new password? Their old one stops working and they're logged out everywhere.`)) return;
          api('/admin/users/' + u.id, json('POST', { resetPassword: true })).then(r => { u.hasPassword = true; $('#adNew').after(loginCard(`New password for ${u.name}`, u, r.password)); }).catch(e => toast(e.message, true)); } }, 'New password'),
        u.id === me.id ? null : h('button', { class: 'btn sm danger', onclick: () => { if (!confirm(`Remove ${u.name}? Their account goes; their characters stay.`)) return;
          api('/admin/users/' + u.id, { method: 'DELETE' }).then(() => { users.users = users.users.filter(x => x !== u); show(); }).catch(e => toast(e.message, true)); } }, 'Remove'))));
    // adding someone: name, role, campaigns → an account with a password to send them
    const nName = h('input', { placeholder: 'Their name, e.g. Sean' }), nRole = h('select', null, h('option', { value: 'player' }, 'Player'), h('option', { value: 'gm' }, 'Admin (GM)'));
    const nPass = h('input', { placeholder: 'Password (blank: one is made up)', type: 'text' });
    const picked = new Set();
    const addForm = h('div', { id: 'adNew', class: 'adnew' },
      h('div', { class: 'adgrid' }, h('label', null, 'Name', nName), h('label', null, 'Role', nRole), h('label', null, 'Password', nPass)),
      camps().length ? h('div', null, h('span', { class: 'muted' }, 'Campaigns they play in: '), campBoxes(null, (c, on) => { on ? picked.add(c.id) : picked.delete(c.id); })) : null,
      h('button', { class: 'btn primary', onclick: () => {
        if (!nName.value.trim()) return toast('Give them a name', true);
        if (nPass.value && nPass.value.length < 6) return toast('Passwords need at least six characters', true);
        api('/admin/users', json('POST', { name: nName.value.trim(), role: nRole.value, password: nPass.value, campaigns: [...picked] })).then(r => {
          users.users.push(r.user); users.campaigns = r.campaigns;
          show().then(() => $('#adNew').after(loginCard(`${r.user.name} can log in now`, r.user, r.password)));
        }).catch(e => toast(e.message, true));
      } }, 'Add person'));
    root.replaceChildren(h('div', { class: 'adwrap' },
      h('h1', null, 'Admin'),
      h('section', null, h('h2', null, 'The site'),
        h('div', { class: 'adgrid' },
          h('label', null, 'Name', name), h('label', null, 'Tagline', tag),
          h('label', null, 'Front page of the wiki', main),
          h('label', { class: 'inline' }, priv, h('span', null, h('b', null, 'Private'), h('br'), h('span', { class: 'muted' }, 'Only people who are logged in can see anything. Left off, anyone with the address can read the map, the wiki and the files that aren’t GM only, and watch the table (what the players see). Playing, chatting and editing always need a login.')))),
        h('button', { class: 'btn primary', onclick: saveSite }, 'Save')),
      h('section', null, h('h2', null, 'People'),
        h('p', { class: 'muted' }, 'Admins edit the map, the wiki and the files, and run the table. Players log in to read GM-free pages (if the site isn’t open to visitors) and to play in the campaigns ticked for them. You can also send an invite link from the table’s Players tab.'),
        h('h3', null, 'Add someone'), addForm,
        h('table', { class: 'adtable' }, h('tr', null, ...['Name', 'Role', 'Campaigns', 'Password', 'Joined', ''].map(t => h('th', null, t))), peopleRows())),
      h('section', null, h('h2', null, 'Backups'),
        h('p', null, 'Everything the site keeps (accounts, the map, the wiki and its history, files, campaigns) in one .zip. Keep a copy somewhere safe now and then.'),
        h('div', { class: 'row' }, h('a', { class: 'btn primary', href: '/api/site/admin/backup' }, 'Download a full backup'),
          h('a', { class: 'btn', href: '/api/site/wiki/export' }, 'Download the wiki as Markdown files'))),
      h('section', null, h('h2', null, 'Bring in a wiki'),
        h('p', null, 'Got pages already, say an Obsidian vault or another wiki’s Markdown export? Zip the folder and upload it: every .md file becomes a page in the same folders. Pages whose title is already taken in that folder are left out.'),
        h('input', { type: 'file', accept: '.zip,application/zip', onchange: e => {
          const f = e.target.files[0]; if (!f) return;
          toast('Importing…');
          fetch('/api/site/wiki/import-zip', { method: 'POST', body: f, headers: { 'Content-Type': 'application/zip' } }).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; })
            .then(j => { toast(`Made ${j.made} page${j.made === 1 ? '' : 's'}${j.skipped ? `, left out ${j.skipped}` : ''}.`); return ctx.reload(); }).catch(err => toast(err.message, true));
        } })),
      h('section', null, h('h2', null, 'The map'),
        h('p', null, 'Map edits (places, borders, icon types, the ruler’s scale) save to the server as you make them, with the last 30 versions kept. Switch Edit map on from the map’s top bar. To add icons, upload pictures into a ',
          h('a', { href: '#/files/' }, 'Files'), ' folder called “Map icons”.'))));
  }
  return { show };
};
