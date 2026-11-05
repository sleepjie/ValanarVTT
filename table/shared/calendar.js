/* The world's calendar and clock, shared by the server and both pages (the map site and the table).
 *
 * A calendar: { months: [{ name, days }], weekdays: [names] (may be empty), years: [names] (a cycle, e.g. a zodiac;
 *               may be empty), era: 'AR' (after the year), firstYear: 1,
 *               eras: [{ abbr: 'BR', name: 'Before the Rending', start: null, count: 'down' }, { abbr: 'AR', name: 'After the Rending', start: 1 }]
 *                 (each from the year it begins, counting 'up' from 1, or 'keep'ing the calendar's number, or 'down' towards the next era),
 *               sun: { long: 16, short: 8, summer: <day of the year with the longest day, 0-based> },
 *               night: 0.85 (how dark a scene that follows the clock gets at night, 0..1) }
 * The time: t = minutes since the first minute of year `firstYear`.
 * Weather: { kind: 'clear' | 'cloudy' | 'overcast' | 'fog' | 'rain' | 'storm' | 'snow' | 'blizzard', wind: 0..1, dir: degrees (where it blows to) }
 */
(function (root) {
  'use strict';
  const DEFAULT = {
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
      .map((name, i) => ({ name, days: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][i] })),
    weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    years: [], era: '', firstYear: 1, sun: { long: 16, short: 8, summer: 171 }, night: 0.85
  };
  const WEATHER = [['clear', 'Clear'], ['cloudy', 'Some cloud'], ['overcast', 'Overcast'], ['fog', 'Fog'], ['rain', 'Rain'], ['storm', 'Storm'], ['snow', 'Snow'], ['blizzard', 'Blizzard']];

  function clean(c) {
    c = c && typeof c === 'object' ? c : {};
    const months = Array.isArray(c.months) && c.months.length ? c.months.slice(0, 40).map(m => ({ name: String(m.name || '').slice(0, 40) || 'Month', days: Math.max(1, Math.min(400, Math.round(+m.days || 30))) })) : DEFAULT.months.map(m => Object.assign({}, m));
    const list = (a, n) => Array.isArray(a) ? a.slice(0, n).map(x => String(x || '').slice(0, 40)).filter(Boolean) : [];
    const sun = c.sun && typeof c.sun === 'object' ? c.sun : {};
    return {
      months, weekdays: 'weekdays' in c ? list(c.weekdays, 20) : DEFAULT.weekdays.slice(), years: list(c.years, 60), era: String(c.era || '').slice(0, 20),
      firstYear: Math.round(+c.firstYear || 1),
      eras: (Array.isArray(c.eras) ? c.eras : []).slice(0, 20).filter(e => e && typeof e === 'object').map(e => ({ abbr: String(e.abbr || '').slice(0, 12).trim(), name: String(e.name || '').slice(0, 60).trim(),
        start: e.start === null || e.start === '' || e.start === undefined || !isFinite(+e.start) ? null : Math.round(+e.start), count: ['up', 'keep', 'down'].includes(e.count) ? e.count : e.down ? 'down' : 'up' })).filter(e => e.abbr || e.name)
        .sort((a, b) => (a.start == null ? -Infinity : a.start) - (b.start == null ? -Infinity : b.start)),
      sun: { long: clampN(sun.long, 4, 24, 16), short: clampN(sun.short, 0, 20, 8), summer: Math.round(clampN(sun.summer, 0, 10000, 171)) },
      night: clampN(c.night, 0, 1, 0.85)
    };
  }
  function clampN(v, a, b, d) { v = +v; return isFinite(v) ? Math.min(b, Math.max(a, v)) : d; }
  const yearDays = cal => cal.months.reduce((s, m) => s + m.days, 0);

  // t → the date: { year, doy (0-based), month (0-based), day (1-based), weekday, hour, minute, ... }
  function date(cal, t) {
    t = Math.floor(+t || 0);
    const YD = yearDays(cal), dayN = Math.floor(t / 1440);
    const y = Math.floor(dayN / YD), doy = ((dayN % YD) + YD) % YD;
    let m = 0, left = doy;
    while (m < cal.months.length - 1 && left >= cal.months[m].days) { left -= cal.months[m].days; m++; }
    const mins = ((t % 1440) + 1440) % 1440;
    const year = cal.firstYear + y;
    const yearText = yearLabel(cal, year);
    return { t, year, doy, dayN, month: m, monthName: cal.months[m].name, day: left + 1, hour: Math.floor(mins / 60), minute: mins % 60,
      weekday: cal.weekdays.length ? cal.weekdays[((dayN % cal.weekdays.length) + cal.weekdays.length) % cal.weekdays.length] : '',
      yearText, yearName: cal.years.length ? cal.years[((y % cal.years.length) + cal.years.length) % cal.years.length] : '' };
  }
  // the date back to t (minute 0 of that day unless hour/minute are given)
  function toT(cal, year, month, day, hour, minute) {
    const YD = yearDays(cal);
    let doy = 0; for (let i = 0; i < month && i < cal.months.length; i++) doy += cal.months[i].days;
    doy += Math.max(0, day - 1);
    return ((year - cal.firstYear) * YD + doy) * 1440 + (hour || 0) * 60 + (minute || 0);
  }
  // a year as the world writes it: "1247 AR", or "312 BR" counting down to the next era (the eras the GM set; else the one suffix)
  function yearLabel(cal, year) {
    const E = cal.eras || [];
    let i = -1; for (let k = 0; k < E.length; k++) if (E[k].start == null || E[k].start <= year) i = k;
    if (i < 0) return `${year}${cal.era ? ' ' + cal.era : ''}`;
    const e = E[i], next = E[i + 1];
    const n = e.count === 'down' && next && next.start != null ? next.start - year : e.count === 'keep' || e.start == null ? year : year - e.start + 1;
    return `${n}${e.abbr ? ' ' + e.abbr : ''}`;
  }
  const eraOf = (cal, year) => { const E = cal.eras || []; let i = -1; for (let k = 0; k < E.length; k++) if (E[k].start == null || E[k].start <= year) i = k; return i < 0 ? null : E[i]; };
  const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const two = n => String(n).padStart(2, '0');
  function clock(d) { return `${two(d.hour)}:${two(d.minute)}`; }
  // "Tuesday, 14th of Summit, 1247 AR"
  function label(cal, t, o) {
    const d = date(cal, t); o = o || {};
    const main = `${o.short ? d.day : ord(d.day)} ${o.short ? d.monthName : 'of ' + d.monthName}, ${d.yearText}`;
    return (d.weekday && !o.short ? d.weekday + ', ' : '') + main;
  }

  // ───────── the sun ─────────
  // daylight hours on day `doy`, and how light it is at a moment: 0 night … 1 full day, with twilight in between
  function dayLength(cal, doy) {
    const YD = yearDays(cal), s = cal.sun;
    return s.short + (s.long - s.short) * (0.5 + 0.5 * Math.cos(2 * Math.PI * (doy - s.summer) / YD));
  }
  // The sun through the day. elev: 1 at noon, 0 at sunrise and sunset, -1 at midnight (each half by the clock, so long
  // winter nights still deepen slowly to midnight and lighten again towards dawn).
  // light: 1 in full day, 0 at the dead of night, with golden hour, twilight and evening in between.
  const KEYS_DAY = [[0, 0.8], [0.15, 0.93], [0.4, 1]];
  const KEYS_NIGHT = [[0, 0.8], [0.06, 0.62], [0.16, 0.42], [0.32, 0.24], [0.55, 0.11], [0.8, 0.04], [1, 0]];
  function curve(keys, x) {
    if (x <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) if (x <= keys[i][0]) {
      const [x0, y0] = keys[i - 1], [x1, y1] = keys[i], k = (x - x0) / (x1 - x0), sm = k * k * (3 - 2 * k);
      return y0 + (y1 - y0) * sm;
    }
    return keys[keys.length - 1][1];
  }
  function sun(cal, t) {
    const d = date(cal, t), L = dayLength(cal, d.doy);
    const rise = 12 - L / 2, set = 12 + L / 2, h = d.hour + d.minute / 60;
    // measured in time, so the steps are even through the evening however long the night is
    const fromNoon = Math.abs(h - 12), halfDay = L / 2, halfNight = (24 - L) / 2;
    const elev = fromNoon <= halfDay ? 1 - fromNoon / (halfDay || 1) : -Math.min(1, (fromNoon - halfDay) / (halfNight || 1));
    const light = elev >= 0 ? curve(KEYS_DAY, elev) : curve(KEYS_NIGHT, -elev);
    const phase = elev >= 0.15 ? 'day' : elev <= -0.3 ? 'night' : h < 12 ? 'dawn' : 'dusk';
    // where the sun (or moon) is across the sky: 0 at rising, 1 at setting
    const arc = (h - rise) / (set - rise);
    return { light, elev, phase, rise, set, arc, hours: L };
  }
  // how dark a scene that follows the clock should be now
  const darkness = (cal, t) => Math.round((1 - sun(cal, t).light) * cal.night * 100) / 100;
  // the next sunrise after t
  function nextDawn(cal, t) {
    const d = date(cal, t), L = dayLength(cal, d.doy), rise = Math.round((12 - L / 2) * 60);
    const today = d.dayN * 1440 + rise;
    if (today > t) return today;
    const L2 = dayLength(cal, (d.doy + 1) % yearDays(cal));
    return (d.dayN + 1) * 1440 + Math.round((12 - L2 / 2) * 60);
  }

  function cleanWeather(w) {
    w = w && typeof w === 'object' ? w : {};
    return { kind: WEATHER.some(x => x[0] === w.kind) ? w.kind : 'clear', wind: clampN(w.wind, 0, 1, 0.3), dir: Math.round(clampN(w.dir, 0, 360, 60)) % 360 };
  }

  const api = { DEFAULT, WEATHER, clean, cleanWeather, yearDays, date, toT, label, yearLabel, eraOf, clock, ord, sun, dayLength, darkness, nextDawn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.WorldCalendar = api;
})(this);
