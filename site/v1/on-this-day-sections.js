// @ts-check
// v1 ON-THIS-DAY component (issues #932, #965, #966; ADR 0022): the event-time
// calendar of dated licensing callouts. Event time leads — each entry is a
// dated event the record states happened — and its assertion-time provenance
// (which publications state it) rides one affordance beneath, in the shared
// assertedByFold. The entries are a build-derived projection, never
// hand-authored.
//
// ONE RENDER IMPLEMENTATION. renderStatic() below is the component's single
// source of content: the deploy (src/ci/build-v1-history-static.ts) serialises
// it under the jsdom build backend into the page's served HTML, so the calendar
// is real content in the first byte a crawler or a web archive receives, and
// the browser runs the SAME function only where a page was served un-stamped.
// There is no second, parallel markup builder to police.
//
// enhance() ADDS THE ONE GENUINELY VIEWER-DEPENDENT THING — the reader's own
// "today" signpost — and reads its count OUT OF THE RENDERED CALENDAR rather
// than from any second copy of the data. The enhanced page therefore cannot
// state a number the static page does not: the number it states IS the number
// of entries standing in the static DOM.

import { V1_COPY } from './copy.js';
import { el, link, fill, ledeWithCue, assertedByFold, caveatLinks, explainer, calmNote } from './history-common.js';
import { wireTermPopovers } from './glossary.js';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const EXPLAINER_ID = 'reading-these-dates';

// The registry name this component's root carries (ADR 0022): the load-time
// enhance walk finds the island by it, and the build asserts every emitted name
// has an enhancer registered behind it.
export const COMPONENT = 'on-this-day';

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
 * The component's authoritative content: the whole calendar as a detached
 * element, complete and readable with no script. Synchronous and PURE — a
 * function of the manifest alone, with no clock, environment value or random
 * source in it — so the build-time HTML is reproducible byte for byte.
 * @param {OnThisDayData} data
 * @returns {HTMLElement}
 */
export function renderStatic(data) {
  const copy = V1_COPY.history.onThisDay;
  const surface = el('section', 'surface');
  surface.setAttribute('data-component', COMPONENT);
  surface.appendChild(ledeWithCue(copy.lede));
  surface.appendChild(calmNote(copy.enhanceNote));

  // The today slot: empty in the static HTML because "today" is the READER's
  // day, not the build's. Rendered-then-filled rather than inserted from
  // nothing, so the enhancement only ever writes into an element that is
  // already in the served markup.
  const todaySlot = el('div', null);
  todaySlot.id = 'today-slot';
  surface.appendChild(todaySlot);

  surface.appendChild(explainer(EXPLAINER_ID, copy.explainerLabel, copy.explainerLead, data.caveats,
    [copy.explainerCarriedHistory, copy.explainerUnparsedSeries, copy.explainerFurtherWorking]));

  if (data.entries.length === 0) {
    surface.appendChild(el('p', 'note', copy.empty));
    return surface;
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
      // The day key rides as an attribute VALUE, so the enhancement matches on
      // it by comparison rather than by building a selector out of data.
      tl.setAttribute('data-day', monthDay);
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
  return surface;
}

/**
 * Render the calendar into `root` (the page's #sections host). This is the
 * FALLBACK path only — it exists for a page served without its build-time
 * stamp — and it renders through the very same renderStatic the build uses, so
 * the two contexts cannot produce different content.
 * @param {HTMLElement} root
 * @param {OnThisDayData} data
 * @returns {HTMLElement} the rendered component root
 */
export function renderOnThisDay(root, data) {
  const surface = renderStatic(data);
  root.replaceChildren(surface);
  return surface;
}

/**
 * The calendar's progressive enhancement, over the EXISTING static DOM: the
 * glossary popovers become a well-mannered set, and the reader's own "today"
 * signpost is written into the slot the static render left for it. Nothing is
 * re-rendered and nothing is re-fetched.
 * @param {HTMLElement} root  the component root
 * @returns {void}
 */
export function enhance(root) {
  wireTermPopovers(root);
  enhanceToday(root);
}

/**
 * How many entries the RENDERED calendar carries for a calendar day. The count
 * is read from the static DOM — the entries standing on the page — so the
 * signpost can never state a figure the page itself does not show.
 * @param {HTMLElement} root
 * @param {string} monthDay 'mm-dd'
 * @returns {number}
 */
export function renderedEntriesOnDay(root, monthDay) {
  // Matched by comparing the attribute VALUE, never by building a selector out
  // of it: a day key is data, and data never becomes a selector.
  const day = [...root.querySelectorAll('.tl')].find((t) => t.getAttribute('data-day') === monthDay);
  return day === undefined ? 0 : day.querySelectorAll('.evt').length;
}

/**
 * Write the viewer's "today" signpost into the slot the static render left.
 * Returns what was decided, for the jsdom tests.
 * @param {HTMLElement} root  the component root
 * @param {Date} [now]
 * @returns {{ monthDay: string, found: boolean, entries: number } | null}
 */
export function enhanceToday(root, now = new Date()) {
  const slot = root.querySelector('#today-slot');
  if (slot === null) return null;
  const copy = V1_COPY.history.onThisDay;
  const monthDay = todayMonthDay(now);
  const human = dayHeading(monthDay);
  const entries = renderedEntriesOnDay(root, monthDay);

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
