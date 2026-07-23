// @ts-check
// v1 ON-THIS-DAY sections (issue #932): renders the event-time calendar of
// dated licensing callouts from the root-served on-this-day manifest, and
// layers the viewer's own "today" signpost on top. Event time leads — each
// entry is a dated event the record states happened — and its assertion-time
// provenance (which publications state it) rides one affordance beneath, in the
// shared assertedByFold. The entries are a build-derived projection, never
// hand-authored; the static page's framing and reading notes are the complete
// no-script baseline.

import { V1_COPY } from './copy.js';
import { el, link, fill, ledeWithCue, assertedByFold, caveatLinks, explainer } from './history-common.js';
import { wireTermPopovers } from './glossary.js';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const EXPLAINER_ID = 'reading-these-dates';

/**
 * @typedef {import('./history-common.js').HistoryDataset} HistoryDataset
 * @typedef {import('./history-common.js').HistoryCaveat} HistoryCaveat
 */

/**
 * @typedef {object} OnThisDayEntry
 * @property {string} monthDay
 * @property {string} year
 * @property {string} day
 * @property {string} series
 * @property {'first-start' | 'first-cancellation'} event
 * @property {string[]} callsigns
 * @property {string[]} kindLabels
 * @property {number[]} datasetIdxs
 * @property {string[]} caveatIds
 * @property {string} seriesIntroduced
 * @property {boolean} predatesSeriesIntroduction
 */

/**
 * @typedef {object} OnThisDayData
 * @property {number} schemaVersion
 * @property {string} asAt
 * @property {HistoryDataset[]} datasets
 * @property {HistoryCaveat[]} caveats
 * @property {OnThisDayEntry[]} entries
 * @property {number} count
 * @property {number} days
 */

/** @param {string} monthDay 'mm-dd' @returns {string} e.g. '15 January' */
export function dayHeading(monthDay) {
  const [month, day] = monthDay.split('-').map(Number);
  return `${day} ${MONTH_NAMES[month - 1] ?? '?'}`;
}

/** @param {string} monthDay @returns {string} the stable per-day anchor */
export function dayAnchor(monthDay) {
  return `d-${monthDay}`;
}

/**
 * The viewer's calendar day as 'mm-dd' (local time — "today" is the reader's
 * day; the manifest is day-of-year keyed either way).
 * @param {Date} [now]
 * @returns {string}
 */
export function todayMonthDay(now = new Date()) {
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

/**
 * The `unknown`-shaped manifest, validated enough to render safely; returns null
 * on a wrong shape so the page degrades to its honest baseline rather than
 * mis-rendering.
 * @param {unknown} parsed
 * @returns {OnThisDayData | null}
 */
export function parseOnThisDay(parsed) {
  if (parsed === null || typeof parsed !== 'object') return null;
  const d = /** @type {Record<string, unknown>} */ (parsed);
  if (!Array.isArray(d.entries) || !Array.isArray(d.datasets) || !Array.isArray(d.caveats)) return null;
  return /** @type {OnThisDayData} */ (parsed);
}

/**
 * One entry as a rail line inside its day-group's track.
 * @param {OnThisDayEntry} entry
 * @param {OnThisDayData} data
 * @param {Map<string, HistoryCaveat>} legend
 * @returns {HTMLElement}
 */
function entryLine(entry, data, legend) {
  const copy = V1_COPY.history.onThisDay;
  const evt = el('div', 'evt');
  const ttl = el('div', 'ttl');
  const lead = entry.event === 'first-start' ? copy.leadStart : copy.leadCancellation;
  ttl.append(`${entry.year} – ${lead} for a ${entry.series}-series callsign`);
  evt.appendChild(ttl);

  const body = el('p', 'dsc');
  entry.callsigns.forEach((cs, i) => {
    if (i > 0) body.append(' ');
    body.appendChild(el('span', 'cs', cs));
  });
  if (entry.callsigns.length > 1) body.append(` (${fill(copy.tie, { count: entry.callsigns.length })})`);
  const what = entry.event === 'first-start' ? 'a start' : 'a cancellation';
  body.append(`, ${what} dated ${entry.day}`);
  if (entry.kindLabels.length > 0) body.append(` – as asserted (${entry.kindLabels.join('; ')})`);
  body.append('.');
  evt.appendChild(body);

  // Carried licence history (issues #915/#918): the more interesting reading,
  // never a hedge on the date.
  if (entry.predatesSeriesIntroduction && entry.seriesIntroduced !== '') {
    evt.appendChild(el('p', 'dsc hx-carried', fill(copy.carriedHistory, { series: entry.series, month: introductionLabel(entry.seriesIntroduced) })));
  }

  // The assertion-time provenance, one affordance away.
  const datasets = entry.datasetIdxs.map((i) => data.datasets[i]).filter((x) => x !== undefined);
  if (datasets.length > 0) evt.appendChild(assertedByFold(datasets, copy.assertedByFold));

  const caveats = caveatLinks(entry.caveatIds, legend, `#${EXPLAINER_ID}`, V1_COPY.history.timeline.readoutCaveats);
  if (caveats !== null) evt.appendChild(caveats);
  return evt;
}

/** @param {string} iso yyyy-mm @returns {string} e.g. 'October 2018' */
function introductionLabel(iso) {
  const m = /^(\d{4})-(\d{2})$/.exec(iso);
  if (m === null) return iso;
  return `${MONTH_NAMES[Number(m[2]) - 1] ?? '?'} ${m[1]}`;
}

/**
 * Render the whole calendar into `root` (the page's #sections host).
 * @param {HTMLElement} root
 * @param {OnThisDayData} data
 */
export function renderOnThisDay(root, data) {
  const copy = V1_COPY.history.onThisDay;
  root.textContent = '';
  const surface = el('section', 'surface');
  surface.appendChild(ledeWithCue(copy.lede));

  // The today slot, filled by the enhancement below.
  const todaySlot = el('div', null);
  todaySlot.id = 'today-slot';
  surface.appendChild(todaySlot);

  surface.appendChild(explainer(EXPLAINER_ID, copy.explainerLabel, copy.explainerLead, data.caveats,
    [copy.explainerCarriedHistory, copy.explainerUnparsedSeries, copy.explainerFurtherWorking]));

  if (data.entries.length === 0) {
    surface.appendChild(el('p', 'note', copy.empty));
    root.appendChild(surface);
    return;
  }

  const legend = new Map(data.caveats.map((c) => [c.id, c]));
  /** @type {Map<string, OnThisDayEntry[]>} */
  const byMonthDay = new Map();
  for (const entry of data.entries) {
    const list = byMonthDay.get(entry.monthDay);
    if (list === undefined) byMonthDay.set(entry.monthDay, [entry]);
    else list.push(entry);
  }

  const calendar = el('div', 'otd-calendar');
  for (let month = 1; month <= 12; month += 1) {
    const mm = String(month).padStart(2, '0');
    const monthDays = [...byMonthDay.keys()].filter((md) => md.startsWith(`${mm}-`)).sort();
    if (monthDays.length === 0) continue;
    const h2 = el('h2', 'otd-month', MONTH_NAMES[month - 1]);
    h2.id = `m-${mm}`;
    calendar.appendChild(h2);
    for (const monthDay of monthDays) {
      const dayEntries = byMonthDay.get(monthDay) ?? [];
      const tl = el('div', 'tl');
      const when = el('div', 'when', dayHeading(monthDay));
      when.id = dayAnchor(monthDay);
      when.appendChild(el('small', null, 'event'));
      tl.appendChild(when);
      const track = el('div', 'track');
      for (const entry of dayEntries) track.appendChild(entryLine(entry, data, legend));
      tl.appendChild(track);
      calendar.appendChild(tl);
    }
  }
  surface.appendChild(calendar);
  surface.appendChild(el('p', 'note otd-count', fill(copy.countFoot, { count: data.count, days: data.days })));
  root.appendChild(surface);
  wireTermPopovers(root);
}

/**
 * Layer the viewer's "today" signpost into #today-slot. Pure over the data
 * (never the build clock); returns what was decided, for the jsdom tests.
 * @param {Document} doc
 * @param {OnThisDayData} data
 * @param {Date} [now]
 * @returns {{ monthDay: string, found: boolean, entries: number } | null}
 */
export function enhanceToday(doc, data, now = new Date()) {
  const slot = doc.getElementById('today-slot');
  if (slot === null) return null;
  const copy = V1_COPY.history.onThisDay;
  const monthDay = todayMonthDay(now);
  const human = dayHeading(monthDay);
  const entries = data.entries.filter((e) => e.monthDay === monthDay).length;

  const callout = el('p', 'callout otd-today-note');
  if (entries > 0) {
    callout.append(`${fill(copy.todayLead, { day: human })} – `);
    const a = link(`#${dayAnchor(monthDay)}`, fill(copy.todayEntriesLink, { count: `${entries} ${entries === 1 ? 'entry' : 'entries'}` }));
    callout.appendChild(a);
    callout.append(copy.todayIn);
    slot.replaceChildren(callout);
    return { monthDay, found: true, entries };
  }
  callout.append(fill(copy.todayNone, { day: human }));
  slot.replaceChildren(callout);
  return { monthDay, found: false, entries: 0 };
}
