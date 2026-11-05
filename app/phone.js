/* Phone mode: on a narrow screen the top bar keeps only what's needed every moment (search, full screen, the side
 * bar's button), and everything else (the site's pages, who you are, logging out, rejoining as a player) moves into
 * a menu behind ☰. Shared by the site and the table: both have a #topbar. Nothing changes on a wider screen. */
'use strict';
(function () {
  const bar = document.getElementById('topbar'); if (!bar) return;
  if (/[?&]embed\b/.test(location.search)) return;   // (the site inside the table: the table's own bar does this)
  const mq = matchMedia('(max-width: 700px)');
  const MOVE = ['#views', '#me', '#roleBtn', '#logout'];
  const btn = document.createElement('button');
  btn.id = 'menuBtn'; btn.title = 'Menu'; btn.setAttribute('aria-label', 'Menu'); btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  bar.prepend(btn);
  const menu = document.createElement('div'); menu.id = 'phoneMenu'; menu.hidden = true;
  document.body.append(menu);
  const homes = new Map();   // element → the placeholder where it lives on a wide screen
  function gather() {
    for (const sel of MOVE) {
      const el = document.querySelector(sel); if (!el || menu.contains(el)) continue;
      const ph = document.createComment('phone:' + sel); el.before(ph); homes.set(el, ph);
      menu.append(el);
    }
  }
  function restore() { for (const [el, ph] of homes) { ph.replaceWith(el); } homes.clear(); }
  function open(on) {
    if (on) gather();
    menu.hidden = !on; btn.classList.toggle('on', on); btn.setAttribute('aria-expanded', String(on));
    document.body.classList.toggle('menu-open', on);
  }
  btn.addEventListener('click', e => { e.stopPropagation(); open(menu.hidden); });
  // a choice in the menu closes it; so does a tap anywhere else
  menu.addEventListener('click', e => { if (e.target.closest('a, button[data-view], [data-page], #logout, #roleBtn')) setTimeout(() => open(false), 0); });
  document.addEventListener('pointerdown', e => { if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) open(false); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) open(false); });
  function apply() {
    document.documentElement.classList.toggle('phone', mq.matches);
    if (mq.matches) gather(); else { open(false); restore(); }
  }
  (mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply));
  apply();
  // things that appear later (the table adds "Rejoin as player" once a campaign opens)
  new MutationObserver(() => { if (mq.matches && MOVE.some(s => { const el = document.querySelector(s); return el && !menu.contains(el); })) gather(); })
    .observe(bar, { childList: true });
})();
