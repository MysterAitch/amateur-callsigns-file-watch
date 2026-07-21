// @ts-check
// Progressive enhancement for the generated "on this day" page (issue #726):
// finds the viewer's own calendar day among the build-rendered day sections
// and surfaces it in the #today-slot callout — or states, in the page's own
// availability-trap wording, that the held corpus places nothing on this day.
// The static calendar below is the complete no-JS baseline; this script only
// ever ADDS a signpost.

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * The viewer's calendar day as 'mm-dd' (local time — "today" is the reader's
 * day, not the server's; the page's data is day-of-year keyed either way).
 * @param {Date} [now]
 * @returns {string}
 */
export function todayMonthDay(now = new Date()) {
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

/**
 * @param {string} monthDay 'mm-dd'
 * @returns {string} e.g. '15 January'
 */
export function humanMonthDay(monthDay) {
  const [month, day] = monthDay.split('-').map(Number);
  return `${day} ${MONTH_NAMES[month - 1] ?? '?'}`;
}

/**
 * Apply the enhancement. Returns what was decided, for the jsdom tests.
 * @param {Document} doc
 * @param {Date} [now]
 * @returns {{ monthDay: string, found: boolean, entries: number } | null}
 */
export function enhanceOnThisDay(doc, now = new Date()) {
  const root = doc.querySelector('[data-page="on-this-day"]');
  const slot = doc.getElementById('today-slot');
  if (root === null || slot === null) return null;

  const monthDay = todayMonthDay(now);
  const heading = doc.getElementById(`d-${monthDay}`);
  const human = humanMonthDay(monthDay);

  const callout = doc.createElement('p');
  callout.className = 'callout otd-today-note';

  if (heading !== null) {
    heading.classList.add('otd-today');
    const list = heading.nextElementSibling;
    const entries = list === null ? 0 : list.querySelectorAll('li').length;
    const a = doc.createElement('a');
    a.setAttribute('href', `#d-${monthDay}`);
    a.textContent = `${entries} ${entries === 1 ? 'entry' : 'entries'} on this day`;
    callout.append(`Today is ${human} — `);
    callout.appendChild(a);
    callout.append(' in the held record.');
    slot.appendChild(callout);
    return { monthDay, found: true, entries };
  }

  callout.append(`Today is ${human}. The held corpus places no first-of-series event on this day — `
    + 'non-observation, never “nothing ever happened on this day”.');
  slot.appendChild(callout);
  return { monthDay, found: false, entries: 0 };
}

if (typeof document !== 'undefined' && document.querySelector('[data-page="on-this-day"]') !== null) {
  enhanceOnThisDay(document);
}
