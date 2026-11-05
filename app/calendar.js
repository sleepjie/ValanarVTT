/* The Calendar (#/calendar, a sheet over the map): the world's months laid out as a grid, today marked, events on their days
 * (GM-only ones for admins), and the admin's settings: the months, weekdays, names of the years, daylight.
 * ValanarCalendar(ctx) → { show() }; ctx.sky() gives the current calendar and setCalendar for updates. */
'use strict';
window.ValanarCalendar = function (ctx) {
  const { h, $, toast } = ctx;
  const SV = window.VALANAR_SERVER || {};
  const Cal = window.WorldCalendar;
  const admin = !!SV.admin;
  let viewMonth = null, viewYear = null, selDay = null;   // the month on screen, and the day picked (dayN)

  const api = (url, body, method) => fetch('/api/site' + url, { method: method || 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; });
  const cur = () => ctx.sky() && ctx.sky().calendar;
  const update = c => { ctx.sky().setCalendar(c.calendar || c); render(); };

  function eventsOn(c, dayN) {
    const YD = Cal.yearDays(c.cal), doy = ((dayN % YD) + YD) % YD;
    return (c.events || []).filter(e => { const n = Math.floor(e.t / 1440); return n === dayN || (e.yearly && ((n % YD) + YD) % YD === doy && dayN >= n); })
      .sort((a, b) => (a.t % 1440) - (b.t % 1440));
  }

  function render() {
    const root = $('#calendar'); if (!root) return;
    const c = cur();
    if (!c) { root.replaceChildren(h('p', { class: 'calempty' }, 'Loading the calendar…')); return; }
    const C = c.cal, today = Cal.date(C, c.t);
    if (viewMonth == null) { viewMonth = today.month; viewYear = today.year; }
    const first = Cal.toT(C, viewYear, viewMonth, 1) / 1440, days = C.months[viewMonth].days;
    const yname = Cal.date(C, first * 1440).yearName;
    const go = (dm) => { viewMonth += dm; while (viewMonth < 0) { viewMonth += C.months.length; viewYear--; } while (viewMonth >= C.months.length) { viewMonth -= C.months.length; viewYear++; } render(); };
    // the grid: weeks if the calendar has weekdays, otherwise rows of ten (or seven) days
    const cols = C.weekdays.length || (days >= 40 ? 10 : 7);
    const lead = C.weekdays.length ? ((first % cols) + cols) % cols : 0;
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(h('div', { class: 'cday blank' }));
    for (let d = 1; d <= days; d++) {
      const dayN = first + d - 1, evs = eventsOn(c, dayN), isToday = dayN === today.dayN;
      cells.push(h('button', { class: 'cday' + (isToday ? ' today' : '') + (dayN === selDay ? ' sel' : '') + (evs.length ? ' has' : ''), onclick: () => { selDay = dayN; render(); } },
        h('span', { class: 'cn' }, d), isToday ? h('span', { class: 'cnow' }, Cal.clock(today)) : null,
        ...evs.slice(0, 3).map(e => h('span', { class: 'cev' + (e.gmOnly ? ' gm' : '') }, e.title)), evs.length > 3 ? h('span', { class: 'cmore' }, `+${evs.length - 3} more`) : null));
    }
    const grid = h('div', { class: 'cgrid', style: `grid-template-columns: repeat(${cols}, minmax(0, 1fr))` },
      ...(C.weekdays.length ? C.weekdays.map(w => h('div', { class: 'cwk' }, w.slice(0, 3))) : []), ...cells);
    const head = h('div', { class: 'chead' },
      h('button', { class: 'btn sm', title: 'Previous month', onclick: () => go(-1) }, '‹'),
      h('div', { class: 'ctitle' }, h('h1', null, `${C.months[viewMonth].name} ${Cal.yearLabel ? Cal.yearLabel(C, viewYear) : viewYear + (C.era ? ' ' + C.era : '')}`), yname ? h('span', null, yname) : null),
      h('button', { class: 'btn sm', title: 'Next month', onclick: () => go(1) }, '›'),
      h('button', { class: 'btn sm', onclick: () => { viewMonth = today.month; viewYear = today.year; selDay = today.dayN; render(); } }, 'Today'),
      h('div', { class: 'grow' }),
      admin ? h('button', { class: 'btn sm', onclick: settings }, 'Calendar settings') : null,
      ctx.close ? h('button', { class: 'btn sm cclose', title: 'Back to the map (Esc)', onclick: ctx.close }, '×') : null);
    // the side: today, then the day picked
    const side = h('aside', { class: 'cside' },
      h('div', { class: 'cnowbox' }, h('div', { class: 'big' }, Cal.clock(today)), h('div', null, Cal.label(C, c.t)), today.yearName ? h('div', { class: 'muted' }, today.yearName) : null,
        h('div', { class: 'muted' }, (Cal.WEATHER.find(w => w[0] === c.weather.kind) || [])[1]),
        admin ? h('button', { class: 'btn sm', style: 'margin-top:8px', onclick: () => ctx.openClock ? ctx.openClock() : ctx.sky().openClock() }, 'Move the clock on…') : null),
      selDay != null ? dayPanel(c, selDay) : h('p', { class: 'muted' }, 'Pick a day to see what happens on it' + (admin ? ', or to add an event.' : '.')),
      upcoming(c));
    root.replaceChildren(h('div', { class: 'cmain' }, head, grid), side);
  }

  function dayPanel(c, dayN) {
    const C = c.cal, evs = eventsOn(c, dayN), when = dayN * 1440;
    const box = h('div', { class: 'cdaybox' }, h('h2', null, Cal.label(C, when)));
    for (const e of evs) box.append(h('div', { class: 'cevent' + (e.gmOnly ? ' gm' : '') },
      h('div', { class: 'cet' }, h('b', null, e.title), e.gmOnly ? h('span', { class: 'gmtag' }, 'GM') : null, e.yearly ? h('span', { class: 'muted small' }, ' every year') : null),
      e.text ? h('div', { class: 'cetext' }, e.text) : null,
      admin ? h('div', { class: 'ceacts' }, h('button', { class: 'linkbtn', onclick: () => editEvent(e, dayN) }, 'Edit'),
        h('button', { class: 'linkbtn danger', onclick: () => { if (confirm(`Delete “${e.title}”?`)) api('/calendar/events/' + e.id, undefined, 'DELETE').then(update).catch(err => toast(err.message, true)); } }, 'Delete')) : null));
    if (!evs.length) box.append(h('p', { class: 'muted' }, 'Nothing written down for this day.'));
    if (admin) box.append(h('div', { class: 'row', style: 'margin-top:10px;gap:6px;flex-wrap:wrap' },
      h('button', { class: 'btn sm primary', onclick: () => editEvent(null, dayN) }, 'Add an event'),
      h('button', { class: 'btn sm', title: 'Move the world’s clock to this day (same time of day)', onclick: () => api('/calendar', { t: dayN * 1440 + (((c.t % 1440) + 1440) % 1440) }, 'PUT').then(update).catch(err => toast(err.message, true)) }, 'Make this today')));
    return box;
  }
  function upcoming(c) {
    const today = Math.floor(c.t / 1440), list = [];
    for (let d = today + 1; d <= today + 120 && list.length < 6; d++) for (const e of eventsOn(c, d)) list.push([d, e]);
    if (!list.length) return null;
    return h('div', { class: 'cup' }, h('h3', null, 'Coming up'), ...list.slice(0, 6).map(([d, e]) => h('button', { class: 'cupi', onclick: () => { const dd = Cal.date(c.cal, d * 1440); viewMonth = dd.month; viewYear = dd.year; selDay = d; render(); } },
      h('span', { class: 'muted' }, Cal.label(c.cal, d * 1440, { short: true })), h('b', null, e.title))));
  }

  function editEvent(e, dayN) {
    const modal = $('#modal'), close = () => { modal.hidden = true; modal.replaceChildren(); };
    const c = cur();
    const title = h('input', { value: e ? e.title : '', placeholder: 'The Harvest Fair, the king’s coronation…' });
    const text = h('textarea', { rows: 5 }, e ? e.text : '');
    const time = h('input', { type: 'time', value: e ? Cal.clock(Cal.date(c.cal, e.t)) : '12:00' });
    const gm = h('input', { type: 'checkbox', checked: e ? e.gmOnly : false });
    const yearly = h('input', { type: 'checkbox', checked: e ? e.yearly : false });
    modal.replaceChildren(h('div', { class: 'dialog' },
      h('div', { class: 'dh' }, h('h2', null, (e ? 'Edit event · ' : 'New event · ') + Cal.label(c.cal, dayN * 1440, { short: true })), h('button', { onclick: close }, '×')),
      h('div', { class: 'db' }, h('label', null, 'What'), title, h('label', null, 'Notes'), text, h('label', null, 'Time of day'), time,
        h('label', { class: 'inline' }, gm, 'GM only (players don’t see it)'), h('label', { class: 'inline' }, yearly, 'Every year on this day')),
      h('div', { class: 'df' }, h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => {
        const [hh, mm] = time.value.split(':').map(Number);
        const body = { title: title.value.trim(), text: text.value, gmOnly: gm.checked, yearly: yearly.checked, t: dayN * 1440 + (hh || 0) * 60 + (mm || 0) };
        (e ? api('/calendar/events/' + e.id, body, 'PUT') : api('/calendar/events', body)).then(r => { close(); update(r); }).catch(err => toast(err.message, true));
      } }, 'Save'))));
    modal.hidden = false; title.focus();
  }

  function settings() {
    const modal = $('#modal'), close = () => { modal.hidden = true; modal.replaceChildren(); };
    const c = cur(), C = JSON.parse(JSON.stringify(c.cal));
    const rows = h('div', { class: 'cmonths' });
    const drawRows = () => rows.replaceChildren(...C.months.map((m, i) => h('div', { class: 'row' },
      h('span', { class: 'muted', style: 'width:22px' }, i + 1),
      h('input', { value: m.name, oninput: ev => { m.name = ev.target.value; }, style: 'flex:1' }),
      h('input', { type: 'number', min: 1, max: 400, value: m.days, oninput: ev => { m.days = +ev.target.value || 1; }, style: 'width:72px' }), h('span', { class: 'muted small' }, 'days'),
      h('button', { class: 'linkbtn danger', title: 'Remove this month', onclick: () => { if (C.months.length > 1) { C.months.splice(i, 1); drawRows(); } } }, '×'))),
      h('button', { class: 'btn sm', onclick: () => { C.months.push({ name: 'New month', days: 30 }); drawRows(); } }, '+ Month'));
    drawRows();
    const list = (a) => h('input', { value: (a || []).join(', '), style: 'width:100%' });
    const wk = list(C.weekdays), yrs = list(C.years);
    // the eras: the suffixes the years are written with ("1247 AR", "312 BR"), each from the year it begins
    const eras = (C.eras && C.eras.length ? C.eras : C.era ? [{ abbr: C.era, name: '', start: null, count: 'keep' }] : []).map(e => Object.assign({}, e));
    const nowYear = Cal.date(c.cal, c.t).year;
    const eraBox = h('div', { class: 'ceras' }), eraPrev = h('p', { class: 'muted small' });
    const preview = () => {
      const tmp = Object.assign({}, C, { era: '', eras: eras.filter(e => e.abbr || e.name).map(e => Object.assign({}, e)).sort((a, b) => (a.start == null ? -Infinity : a.start) - (b.start == null ? -Infinity : b.start)) });
      const ys = [...new Set([nowYear, ...tmp.eras.filter(e => e.start != null).flatMap(e => [e.start - 1, e.start])])].sort((a, b) => a - b).slice(0, 8);
      eraPrev.textContent = tmp.eras.length ? 'So: ' + ys.map(y => `year ${y} → ${Cal.yearLabel(tmp, y)}${y === nowYear ? ' (now)' : ''}`).join(' · ') : 'No eras: the years are plain numbers.';
    };
    const drawEras = () => {
      eraBox.replaceChildren(...eras.map((e, i) => h('div', { class: 'row cera' },
        h('input', { value: e.abbr, placeholder: 'AR', title: 'Written after the year', style: 'width:64px', oninput: ev => { e.abbr = ev.target.value.trim(); preview(); } }),
        h('input', { value: e.name, placeholder: 'After the Rending', title: 'What it stands for', style: 'flex:1;min-width:120px', oninput: ev => { e.name = ev.target.value; } }),
        h('label', { class: 'small', title: 'The calendar year it begins in (empty: from the beginning of time)' }, 'from year ', h('input', { type: 'number', value: e.start == null ? '' : e.start, placeholder: 'the start', style: 'width:84px', oninput: ev => { e.start = ev.target.value === '' ? null : Math.round(+ev.target.value); preview(); } })),
        h('select', { class: 'small', title: 'How its years are numbered', onchange: ev => { e.count = ev.target.value; preview(); } },
          ...[['up', 'counts up from 1'], ['keep', 'keeps the year’s number'], ['down', 'counts down to the next']].map(([k, l]) => h('option', { value: k, selected: (e.count || (e.down ? 'down' : 'up')) === k || null }, l))),
        h('button', { class: 'linkbtn danger', title: 'Remove this era', onclick: () => { eras.splice(i, 1); drawEras(); } }, '×'))),
        h('button', { class: 'btn sm', onclick: () => { eras.push({ abbr: '', name: '', start: eras.length ? nowYear : null, count: 'up' }); drawEras(); } }, '+ An era'));
      preview();
    };
    drawEras();
    const fy = h('input', { type: 'number', value: C.firstYear, style: 'width:90px' });
    const long = h('input', { type: 'number', min: 4, max: 24, step: 0.5, value: C.sun.long, style: 'width:70px' });
    const short = h('input', { type: 'number', min: 0, max: 20, step: 0.5, value: C.sun.short, style: 'width:70px' });
    // the longest day as a month and day
    let acc = 0, sm = 0, sd = 1;
    for (let i = 0; i < C.months.length; i++) { if (C.sun.summer < acc + C.months[i].days) { sm = i; sd = C.sun.summer - acc + 1; break; } acc += C.months[i].days; }
    const smSel = h('select', null, ...C.months.map((m, i) => h('option', { value: i, selected: i === sm || null }, m.name)));
    const sdIn = h('input', { type: 'number', min: 1, max: 400, value: sd, style: 'width:64px' });
    const nightIn = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: C.night });
    modal.replaceChildren(h('div', { class: 'dialog wide' },
      h('div', { class: 'dh' }, h('h2', null, 'Calendar settings'), h('button', { onclick: close }, '×')),
      h('div', { class: 'db calset' },
        h('h3', null, 'Months'), rows,
        h('h3', null, 'Days of the week'), h('p', { class: 'muted small' }, 'Separated by commas; leave empty for none (the calendar then shows each month in rows of days).'), wk,
        h('h3', null, 'Names of the years'), h('p', { class: 'muted small' }, 'A cycle the years go round, like a zodiac: “Year of the Dawn, Year of the Lamprey…”. The first is the first year below.'), yrs,
        h('div', { class: 'row', style: 'gap:16px;margin-top:10px;flex-wrap:wrap' }, h('label', null, 'First year ', fy)),
        h('h3', null, 'Eras'), h('p', { class: 'muted small' }, 'The letters written after a year, like AR or BR, each from the year its era begins. Its years can count up from 1, keep the calendar’s own number, or count down to the next era (the year before it is 1), like BC.'), eraBox, eraPrev,
        h('h3', null, 'Daylight'),
        h('div', { class: 'row', style: 'gap:12px;flex-wrap:wrap' }, h('label', null, 'Longest day: ', sdIn, ' ', smSel), h('label', null, long, ' hours of daylight then, ', short, ' at midwinter')),
        h('label', { style: 'margin-top:8px' }, 'How dark scenes that follow the clock get at night'), nightIn),
      h('div', { class: 'df' }, h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => {
        const split = el => el.value.split(',').map(x => x.trim()).filter(Boolean);
        let summer = 0; for (let i = 0; i < +smSel.value; i++) summer += C.months[i].days; summer += Math.max(0, (+sdIn.value || 1) - 1);
        const next = { months: C.months, weekdays: split(wk), years: split(yrs), era: '', eras: eras.filter(e => e.abbr || e.name), firstYear: +fy.value || 1, sun: { long: +long.value, short: +short.value, summer }, night: +nightIn.value };
        api('/calendar', { cal: next }, 'PUT').then(r => { close(); viewMonth = null; update(r); }).catch(err => toast(err.message, true));
      } }, 'Save'))));
    modal.hidden = false;
  }

  // inside the table, the date is the campaign's (pushed in by the table): nothing to fetch
  return { show() { render(); if (ctx.sky() && !ctx.sky().pushed) ctx.sky().reload().then(render); },
    // the date changed under it (a campaign's pushed in from the table): show its month
    refresh(jump) { if (jump) { viewMonth = viewYear = null; selDay = null; } if (!document.getElementById('calendar').hidden) render(); } };
};
