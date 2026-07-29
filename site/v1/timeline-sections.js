// @ts-check
// v1 TIMELINE component (issues #932, #965, #966; ADR 0022): the event-time
// histograms + cumulative table + year scrubber. Event time leads — each bar is
// a count of dated events the record states fell in a year — and every figure
// names the publications and vintages that assert it (assertion time), so the
// two clocks never merge. All data-derived DOM is textContent, never innerHTML;
// the v1 surface links only to itself, so dataset and series names render as
// plain text.
//
// ONE RENDER IMPLEMENTATION. renderStatic() below is the component's single
// source of content: the deploy (src/ci/build-v1-history-static.ts) serialises
// it under the jsdom build backend into the page's served HTML. With no script
// the page carries the whole substance — every histogram with its data table,
// the cumulative figures for every year, and the full readout for the corpus's
// own "as at" instant — not a shell and not a promise.
//
// enhance() ADDS THE SCRUBBER over that existing DOM, and reads the per-year
// figures from data EMBEDDED IN THE STATIC HTML, never from a second fetch.
// Two consequences, both deliberate:
//   - the scrubbed view cannot state a number the served page does not carry,
//     because the numbers travel in the page and both views are filled by the
//     same fillReadout();
//   - an archived copy of this page is SELF-SUFFICIENT. Nothing links to
//     timeline.json, so a crawler has no reason to capture it; a page that
//     fetched it would scrub to nothing once archived.
// The embedded form is INDEX-ENCODED against the page's own kind, caveat and
// dataset tables (encodeReadoutData below): measured against this corpus that
// is ~28 KB where the whole manifest is ~88 KB, for the same figures.
//
// Scrubbing UPDATES VALUE NODES IN PLACE — the readout skeleton is emitted once
// by renderStatic and every later year refills its slots — rather than clearing
// a host and re-rendering it, so focus, listeners and assistive-technology
// context survive a scrub.

import { V1_COPY } from './copy.js';
import { el, fill, ledeWithCue, caveatLinks, explainer, calmNote } from './history-common.js';
import { inlineTerm, termCue, wireTermPopovers } from './glossary.js';

const EXPLAINER_ID = 'reading-this-timeline';

// The registry name this component's root carries (ADR 0022).
export const COMPONENT = 'timeline';

// Where the static render parks the figures the scrubber needs.
const EMBEDDED_ATTRIBUTE = 'data-readout';

/**
 * @typedef {import('./history-common.js').HistoryDataset} HistoryDataset
 * @typedef {import('./history-common.js').HistoryCaveat} HistoryCaveat
 */

/**
 * @typedef {object} TimelineBucket
 * @property {string} year
 * @property {Record<string, number>} perKind
 * @property {number} startsToDate
 * @property {number} activeReservations
 * @property {Array<[string, number]>} topSeries
 * @property {number[]} datasetIdxs
 * @property {string[]} caveatIds
 */

/**
 * @typedef {object} TimelineData
 * @property {number} schemaVersion
 * @property {string} asAt
 * @property {HistoryDataset[]} datasets
 * @property {{ id: string, label: string }[]} kinds
 * @property {HistoryCaveat[]} caveats
 * @property {Record<string, Array<[string, number]>>} histograms
 * @property {Record<string, number>} totals
 * @property {TimelineBucket[]} buckets
 */

/**
 * Validate the untrusted manifest enough to render safely; null on a wrong shape
 * so the page degrades to its honest baseline rather than mis-rendering.
 * @param {unknown} parsed
 * @returns {TimelineData | null}
 */
export function parseTimeline(parsed) {
  if (parsed === null || typeof parsed !== 'object') return null;
  const d = /** @type {Record<string, unknown>} */ (parsed);
  if (!Array.isArray(d.buckets) || !Array.isArray(d.kinds) || !Array.isArray(d.datasets) || !Array.isArray(d.caveats)) return null;
  return /** @type {TimelineData} */ (parsed);
}

/**
 * The bucket the scrubber opens on: the corpus's latest PROVEN assertion year
 * (asAt), not the maximum event year — event dates run past today (future-dated
 * reservations, the odd outlier), so opening on the last bucket would anchor on
 * a year that has not happened. Mirrors anchorBucketIndex in build-timeline.ts.
 * @param {{ asAt: string, buckets: TimelineBucket[] }} data  the manifest or the
 *   embedded readout data — both carry the two fields the anchor is read from.
 * @returns {number}
 */
export function anchorIndex(data) {
  if (data.buckets.length === 0) return -1;
  const anchorYear = (data.asAt || '').slice(0, 4);
  const idx = data.buckets.findIndex((b) => b.year === anchorYear);
  if (idx !== -1) return idx;
  return anchorYear < data.buckets[0].year ? 0 : data.buckets.length - 1;
}

// ---------------------------------------------------------------------------
// The per-instant readout. The skeleton is emitted ONCE by the static render;
// every year — the anchor year at build, each scrubbed year in the browser —
// refills the same value nodes. Slots are addressed by a fixed `data-slot`
// name, so the build and the browser target the same elements by construction.

// The readout's value slots, in render order. Every slot is ALWAYS emitted, so
// a year with no leading series or no caveats hides its slot rather than
// removing it — the scrubber then only ever fills and unhides existing
// elements, never inserts from nothing (ADR 0022's content-vs-command
// protocol: null is a reversible hide at runtime, never a removal).
const READOUT_SLOTS = /** @type {const} */ ([
  ['year', 'h3', 'tl-year'],
  ['starts', 'p', 'tl-figure'],
  ['reservations', 'p', 'tl-figure'],
  ['activity', 'p', 'tl-figure'],
  ['series', 'p', 'tl-figure'],
  // A <div>, not a <p>: the assertion line carries vintage popovers, which are
  // <details> — a start tag that implicitly ENDS an open paragraph, so as static
  // HTML the citations would reparse as siblings of the line rather than part
  // of it.
  ['assert', 'div', 'tl-assert'],
  ['caveats', 'p', 'hx-caveats tl-caveats'],
]);

/**
 * The empty readout skeleton: one element per slot, in reading order.
 * @returns {HTMLElement}
 */
function readoutSkeleton() {
  const host = el('div', 'tl-readout');
  for (const [slot, tag, cls] of READOUT_SLOTS) {
    const node = el(tag, cls);
    node.setAttribute('data-slot', slot);
    host.appendChild(node);
  }
  return host;
}

/**
 * The host's slot elements by name; missing where a host was not built by
 * readoutSkeleton (a page whose markup predates this shape), so filling
 * degrades to doing nothing for that slot rather than throwing.
 * @param {HTMLElement} host
 * @returns {Map<string, HTMLElement>}
 */
function readoutSlots(host) {
  /** @type {Map<string, HTMLElement>} */
  const slots = new Map();
  // Duck-typed on the attribute rather than `instanceof HTMLElement`: this runs
  // in the Node build too, where that constructor is not a global.
  for (const node of host.querySelectorAll('[data-slot]')) {
    const name = node.getAttribute('data-slot');
    if (name !== null) slots.set(name, /** @type {HTMLElement} */ (node));
  }
  return slots;
}

/**
 * Fill one slot: `null` children mean "not applicable" and hide the slot
 * reversibly, so the next year can unhide and refill it.
 * @param {Map<string, HTMLElement>} slots
 * @param {string} name
 * @param {(Node | string)[] | null} children
 */
function fillSlot(slots, name, children) {
  const node = slots.get(name);
  if (node === undefined) return;
  if (children === null) {
    node.replaceChildren();
    node.hidden = true;
    return;
  }
  node.replaceChildren(...children);
  node.hidden = false;
}

/**
 * @typedef {object} ReadoutData  what the readout needs to state one year — the
 *   subset of the manifest the static HTML embeds for the scrubber.
 * @property {string} asAt
 * @property {HistoryDataset[]} datasets
 * @property {{ id: string, label: string }[]} kinds
 * @property {HistoryCaveat[]} caveats
 * @property {TimelineBucket[]} buckets
 */

/**
 * Fill the readout for one bucket, in place. The ONLY function that writes the
 * readout's figures — the build calls it for the anchor year and the scrubber
 * calls it for every year, so an enhanced view cannot state a figure the served
 * page would not have stated for the same year.
 * @param {HTMLElement} host
 * @param {TimelineBucket} bucket
 * @param {ReadoutData} data
 */
export function fillReadout(host, bucket, data) {
  const copy = V1_COPY.history.timeline;
  const slots = readoutSlots(host);
  const kindLabels = new Map(data.kinds.map((k) => [k.id, k.label]));
  const legend = new Map(data.caveats.map((c) => [c.id, c]));

  fillSlot(slots, 'year', [fill(copy.readoutAsAt, { year: bucket.year })]);

  fillSlot(slots, 'starts', [
    el('span', 'tb d', 'derived'),
    ' ' + fill(copy.readoutStarts, {
      count: bucket.startsToDate.toLocaleString('en-GB'),
      subject: bucket.startsToDate === 1 ? 'callsign has' : 'callsigns have',
      year: bucket.year,
    }),
  ]);

  fillSlot(slots, 'reservations', [fill(copy.readoutReservations, {
    count: bucket.activeReservations.toLocaleString('en-GB'),
    subject: bucket.activeReservations === 1 ? 'window is' : 'windows are',
    year: bucket.year,
  })]);

  const kindEntries = Object.entries(bucket.perKind);
  if (kindEntries.length === 0) {
    fillSlot(slots, 'activity', null);
  } else {
    /** @type {(Node | string)[]} */
    const parts = [fill(copy.readoutActivity, { year: bucket.year })];
    kindEntries.forEach(([kindId, n], i) => {
      if (i > 0) parts.push('; ');
      parts.push(`${kindLabels.get(kindId) ?? kindId} × ${n.toLocaleString('en-GB')}`);
    });
    parts.push('.');
    fillSlot(slots, 'activity', parts);
  }

  // Leading prefix series — plain text (series pages are not part of the v1
  // surface yet, so the record names them without linking off-surface).
  if (bucket.topSeries.length === 0) {
    fillSlot(slots, 'series', null);
  } else {
    /** @type {(Node | string)[]} */
    const parts = [copy.readoutSeries];
    bucket.topSeries.forEach(([series, n], i) => {
      if (i > 0) parts.push(', ');
      parts.push(`${series} (${n.toLocaleString('en-GB')})`);
    });
    parts.push('.');
    fillSlot(slots, 'series', parts);
  }

  // The assertion-time axis: which publications/vintages state this year's events.
  /** @type {(Node | string)[]} */
  const assert = [];
  if (bucket.datasetIdxs.length === 0) {
    assert.push(fill(copy.readoutAssertedNone, { year: bucket.year }));
  } else {
    assert.push(copy.readoutAssertedLead);
    bucket.datasetIdxs.forEach((idx, i) => {
      const dataset = data.datasets[idx];
      if (dataset === undefined) return;
      if (i > 0) assert.push('; ');
      const span = el('span', null, dataset.title);
      if (dataset.key !== '') span.setAttribute('title', dataset.key);
      assert.push(span);
      if (dataset.vintage !== '') {
        assert.push(' (vintage ');
        assert.push(inlineTerm('vintage', dataset.vintage));
        assert.push(')');
      }
    });
    assert.push('.');
  }
  fillSlot(slots, 'assert', assert);

  const caveats = caveatLinks(bucket.caveatIds, legend, `#${EXPLAINER_ID}`, copy.readoutCaveats);
  fillSlot(slots, 'caveats', caveats === null ? null : [...caveats.childNodes]);
}

/**
 * Render one bucket's readout into a host, building the skeleton first where
 * the host is empty. Kept for callers that want a readout on its own.
 * @param {HTMLElement} host
 * @param {TimelineBucket} bucket
 * @param {ReadoutData} data
 */
export function renderReadout(host, bucket, data) {
  if (readoutSlots(host).size === 0) host.replaceChildren(...readoutSkeleton().childNodes);
  fillReadout(host, bucket, data);
}

// ---------------------------------------------------------------------------
// The embedded readout data: the figures the scrubber needs, travelling IN the
// static HTML rather than in a second fetch (ADR 0022). Encoded positionally and
// INDEX-ENCODED against the page's own kind/caveat/dataset tables, because an
// attribute value pays six bytes for every quotation mark the serialiser
// escapes — the compact form is roughly a third of the manifest for the same
// figures. It is plain JSON, never a bespoke grammar: a series prefix or a
// publication title carrying a separator character can therefore never split a
// record.

/**
 * @param {ReadoutData} data
 * @returns {string}
 */
export function encodeReadoutData(data) {
  const kindIds = data.kinds.map((k) => k.id);
  const caveatIdx = new Map(data.caveats.map((c, i) => [c.id, i]));
  return JSON.stringify([
    data.asAt,
    data.datasets.map((d) => [d.key, d.vintage, d.title]),
    data.kinds.map((k) => [k.id, k.label]),
    data.caveats.map((c) => [c.id, c.label, c.gloss]),
    data.buckets.map((b) => [
      b.year,
      b.startsToDate,
      b.activeReservations,
      kindIds.map((id) => b.perKind[id] ?? 0),
      b.topSeries,
      b.datasetIdxs,
      b.caveatIds.map((id) => caveatIdx.get(id) ?? -1).filter((i) => i >= 0),
    ]),
  ]);
}

/** @param {unknown} v @returns {string} */
const asString = (v) => (typeof v === 'string' ? v : '');
/** A finite number, or null where the value is not one — never a stand-in zero.
 * @param {unknown} v @returns {number | null} */
const asNumber = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** @param {unknown} v @returns {unknown[]} */
const asArray = (v) => (Array.isArray(v) ? v : []);

/**
 * Decode the embedded payload.
 *
 * Every field is VALIDATED rather than coerced, and a value that is not what it
 * should be rejects the whole payload rather than standing in for it. Coercing a
 * missing count to zero, or a missing citation index to the first publication,
 * would put a WRONG FIGURE or a WRONG SOURCE in front of a reader — worse than
 * no scrubber at all, because the static readout beneath is intact and correct.
 * Returning null degrades the page to exactly that.
 * @param {string} json
 * @returns {ReadoutData | null}
 */
export function decodeReadoutData(json) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length < 5) return null;
  const kinds = asArray(parsed[2]).map((k) => ({ id: asString(asArray(k)[0]), label: asString(asArray(k)[1]) }));
  const caveats = asArray(parsed[3]).map((c) => ({
    id: asString(asArray(c)[0]),
    label: asString(asArray(c)[1]),
    gloss: asString(asArray(c)[2]),
  }));
  const datasets = asArray(parsed[1]).map((d) => ({
    key: asString(asArray(d)[0]),
    vintage: asString(asArray(d)[1]),
    title: asString(asArray(d)[2]),
  }));

  /** @type {TimelineBucket[]} */
  const buckets = [];
  for (const raw of asArray(parsed[4])) {
    const b = asArray(raw);
    const startsToDate = asNumber(b[1]);
    const activeReservations = asNumber(b[2]);
    const year = asString(b[0]);
    if (year === '' || startsToDate === null || activeReservations === null) return null;

    /** @type {Record<string, number>} */
    const perKind = {};
    const counts = asArray(b[3]);
    for (let i = 0; i < counts.length; i += 1) {
      const n = asNumber(counts[i]);
      const kind = kinds[i];
      if (n === null) return null;
      if (kind !== undefined && n !== 0) perKind[kind.id] = n;
    }

    /** @type {Array<[string, number]>} */
    const topSeries = [];
    for (const s of asArray(b[4])) {
      const series = asString(asArray(s)[0]);
      const n = asNumber(asArray(s)[1]);
      if (series === '' || n === null) return null;
      topSeries.push([series, n]);
    }

    // A citation index that does not resolve is dropped rather than guessed at:
    // naming the wrong publication is the one failure this surface must not
    // have. The static readout already carries the correct citations.
    /** @type {number[]} */
    const datasetIdxs = [];
    for (const idx of asArray(b[5])) {
      const i = asNumber(idx);
      if (i === null) return null;
      if (datasets[i] !== undefined) datasetIdxs.push(i);
    }

    /** @type {string[]} */
    const caveatIds = [];
    for (const idx of asArray(b[6])) {
      const i = asNumber(idx);
      if (i === null) return null;
      const caveat = caveats[i];
      if (caveat !== undefined && caveat.id !== '') caveatIds.push(caveat.id);
    }

    buckets.push({ year, startsToDate, activeReservations, perKind, topSeries, datasetIdxs, caveatIds });
  }
  if (buckets.length === 0) return null;
  return { asAt: asString(parsed[0]), datasets, kinds, caveats, buckets };
}

// How long to wait after the last scrub before announcing, so dragging the
// slider does not queue one announcement per step.
const ANNOUNCE_DELAY_MS = 400;

/**
 * Add the year slider ABOVE the readout the static render already carries, and
 * wire it to refill that readout in place. Nothing is cleared and nothing is
 * re-fetched: the readout element, its position and its slots are the ones the
 * page was served with.
 *
 * Accessibility follows the WAI-ARIA slider pattern: a native
 * `input[type=range]` whose `aria-valuetext` carries the YEAR (a bucket index
 * announced alone would be meaningless), and ONE controller-owned polite status
 * region that announces the AGGREGATE outcome, debounced. The readout itself is
 * deliberately NOT a live region — announcing every value node on every step
 * floods a screen reader.
 * @param {HTMLElement} slot   the scrubber slot from the static render
 * @param {ReadoutData} data
 * @returns {{ input: HTMLInputElement, readout: HTMLElement } | null}
 */
export function buildScrubber(slot, data) {
  const copy = V1_COPY.history.timeline;
  const readout = slot.querySelector('.tl-readout');
  const status = slot.querySelector('.tl-status');
  if (!(readout instanceof HTMLElement)) return null;

  const wrap = el('div', 'tl-scrubber');
  const label = el('label', null, copy.scrubberLabel);
  label.setAttribute('for', 'tl-range');
  wrap.appendChild(label);

  const input = /** @type {HTMLInputElement} */ (el('input'));
  input.id = 'tl-range';
  input.type = 'range';
  input.min = '0';
  input.max = String(Math.max(data.buckets.length - 1, 0));
  input.step = '1';
  input.value = String(Math.max(anchorIndex(data), 0));
  input.setAttribute('aria-label', copy.scrubberLabel);
  wrap.appendChild(input);
  readout.parentElement?.insertBefore(wrap, readout);

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let announceTimer;
  const show = () => {
    const idx = Math.min(Math.max(Number(input.value) | 0, 0), data.buckets.length - 1);
    const bucket = data.buckets[idx];
    if (bucket === undefined) return;
    fillReadout(readout, bucket, data);
    input.setAttribute('aria-valuetext', fill(copy.readoutAsAt, { year: bucket.year }));
    if (status === null) return;
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
      status.textContent = fill(copy.scrubberAnnouncement, {
        year: bucket.year,
        starts: bucket.startsToDate.toLocaleString('en-GB'),
        reservations: bucket.activeReservations.toLocaleString('en-GB'),
      });
    }, ANNOUNCE_DELAY_MS);
  };
  input.addEventListener('input', show);
  // Set aria-valuetext without announcing: the page has not changed yet, and
  // the readout on screen is already the one the static HTML carried.
  input.setAttribute('aria-valuetext', fill(copy.readoutAsAt, {
    year: data.buckets[Math.max(anchorIndex(data), 0)]?.year ?? '',
  }));
  return { input, readout };
}

// ---------------------------------------------------------------------------
// The static per-kind histograms (the substance, complete without interaction).

/**
 * A CSS bar chart over one kind's [year, count] series, with a data table as
 * the accessible, complete content beneath. Colour is never the sole cue — the
 * table carries every figure.
 * @param {string} kindLabel
 * @param {Array<[string, number]>} series
 * @param {number} total
 * @returns {HTMLElement}
 */
export function renderHistogram(kindLabel, series, total) {
  const copy = V1_COPY.history.timeline;
  const fig = el('figure', 'hx-chart');
  const cap = el('figcaption');
  cap.append(kindLabel);
  cap.appendChild(el('span', 'hx-total', fill(copy.histogramTotal, { count: total.toLocaleString('en-GB') })));
  fig.appendChild(cap);

  const max = series.reduce((m, [, n]) => (n > m ? n : m), 0);
  const bars = el('div', 'hx-bars');
  bars.setAttribute('role', 'img');
  bars.setAttribute('aria-label', `${kindLabel}: ${total.toLocaleString('en-GB')} dated events by year (figures in the table below)`);
  for (const [year, n] of series) {
    const col = el('div', 'hx-bar');
    const fillEl = el('div', 'hx-bar-fill');
    fillEl.style.height = max > 0 ? `${Math.round((n / max) * 100)}%` : '0';
    if (n === 0) col.classList.add('zero');
    col.setAttribute('title', `${year}: ${n.toLocaleString('en-GB')} dated ${n === 1 ? 'event' : 'events'}`);
    col.appendChild(fillEl);
    bars.appendChild(col);
  }
  const wrap = el('div', 'hx-bars-wrap');
  wrap.appendChild(bars);
  fig.appendChild(wrap);

  const details = el('details', 'hx-data');
  details.appendChild(el('summary', null, 'Data table (the years with events behind the chart)'));
  const table = el('table');
  const thead = el('thead');
  const htr = el('tr');
  const th1 = el('th', null, 'year (event time)');
  th1.setAttribute('scope', 'col');
  const th2 = el('th', 'n', 'dated events');
  th2.setAttribute('scope', 'col');
  htr.appendChild(th1);
  htr.appendChild(th2);
  thead.appendChild(htr);
  table.appendChild(thead);
  const tbody = el('tbody');
  for (const [year, n] of series) {
    if (n === 0) continue;
    const tr = el('tr');
    tr.appendChild(el('td', null, year));
    tr.appendChild(el('td', 'n', n.toLocaleString('en-GB')));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  details.appendChild(table);
  fig.appendChild(details);
  return fig;
}

/**
 * The full per-year cumulative table — the scrubber's figures, complete without
 * interaction.
 * @param {TimelineData} data
 * @returns {HTMLElement}
 */
export function renderCumulativeTable(data) {
  const details = el('details', 'hx-data');
  details.appendChild(el('summary', null, 'Cumulative figures by year (the scrubber’s figures, complete without interaction)'));
  const table = el('table');
  const thead = el('thead');
  const htr = el('tr');
  for (const [txt, cls] of [['as at year end', ''], ['starts to date', 'n'], ['active reservation windows', 'n']]) {
    const th = el('th', cls || null, txt);
    th.setAttribute('scope', 'col');
    htr.appendChild(th);
  }
  thead.appendChild(htr);
  table.appendChild(thead);
  const tbody = el('tbody');
  for (const b of data.buckets) {
    const tr = el('tr');
    tr.appendChild(el('td', null, b.year));
    tr.appendChild(el('td', 'n', b.startsToDate.toLocaleString('en-GB')));
    tr.appendChild(el('td', 'n', b.activeReservations.toLocaleString('en-GB')));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  details.appendChild(table);
  return details;
}

/**
 * The component's authoritative content: the whole timeline surface as a
 * detached element, complete and readable with no script. Synchronous and PURE
 * — a function of the manifest alone, with no clock, environment value or
 * random source in it — so the build-time HTML is reproducible byte for byte.
 *
 * The readout is filled from the DECODED embedded payload rather than from the
 * manifest directly, so the figures on the served page are literally the ones
 * the page carries for the scrubber: the encode/decode round trip is exercised
 * on every build rather than trusted.
 * @param {TimelineData} data
 * @returns {HTMLElement}
 */
export function renderStatic(data) {
  const copy = V1_COPY.history.timeline;
  const surface = el('section', 'surface');
  surface.setAttribute('data-component', COMPONENT);
  surface.appendChild(ledeWithCue(copy.lede));
  surface.appendChild(calmNote(copy.enhanceNote));
  surface.appendChild(explainer(EXPLAINER_ID, copy.explainerLabel, copy.explainerLead, data.caveats,
    [copy.explainerCarriedHistory, copy.explainerUnparsedSeries, copy.explainerFurtherWorking]));

  if (data.kinds.length === 0 || data.buckets.length === 0) {
    surface.appendChild(el('p', 'note', copy.empty));
    return surface;
  }

  const embedded = encodeReadoutData(data);
  const readoutData = decodeReadoutData(embedded) ?? data;
  surface.setAttribute(EMBEDDED_ATTRIBUTE, embedded);

  // The readout first (the surface's lede figure), then the charts and
  // cumulative table beneath (the substance). With no script the readout states
  // the corpus's own "as at" instant; with script the slider lands above it.
  const scrubberSlot = el('div', null);
  scrubberSlot.id = 'timeline-scrubber';
  // The announcement region is for assistive technology only: the readout
  // beneath already SHOWS the same figures, so announcing them a second time on
  // screen would be redundant. Visually hidden rather than display:none, which
  // some assistive technology treats as not present and never announces.
  const status = el('p', 'tl-status visually-hidden');
  status.setAttribute('role', 'status');
  scrubberSlot.appendChild(status);
  const readout = readoutSkeleton();
  readout.id = 'tl-readout';
  const anchor = readoutData.buckets[Math.max(anchorIndex(readoutData), 0)];
  if (anchor !== undefined) fillReadout(readout, anchor, readoutData);
  scrubberSlot.appendChild(readout);
  surface.appendChild(scrubberSlot);

  const chartsLbl = el('div', 'lbl');
  chartsLbl.append(copy.histogramsLabel);
  const ax = el('span', 'ax', 'event-time');
  ax.appendChild(termCue('eventTime'));
  chartsLbl.appendChild(ax);
  surface.appendChild(chartsLbl);
  surface.appendChild(el('p', 'note', copy.histogramsNote));
  for (const kind of data.kinds) {
    surface.appendChild(renderHistogram(kind.label, data.histograms[kind.id] ?? [], data.totals[kind.id] ?? 0));
  }

  surface.appendChild(el('div', 'lbl', copy.cumulativeLabel));
  surface.appendChild(renderCumulativeTable(data));

  return surface;
}

/**
 * Render the timeline into `root` (the page's #sections host). This is the
 * FALLBACK path only — it exists for a page served without its build-time
 * stamp — and it renders through the very same renderStatic the build uses.
 * @param {HTMLElement} root
 * @param {TimelineData} data
 * @returns {HTMLElement} the rendered component root
 */
export function renderTimeline(root, data) {
  const surface = renderStatic(data);
  root.replaceChildren(surface);
  return surface;
}

/**
 * The timeline's progressive enhancement, over the EXISTING static DOM: the
 * glossary popovers become a well-mannered set, and the year slider is added
 * above the readout the page was served with. The figures come from the payload
 * EMBEDDED in that same static HTML — never a second fetch — so a scrubbed year
 * and the served year are two fills of one readout from one body of data.
 * @param {HTMLElement} root  the component root
 * @returns {void}
 */
export function enhance(root) {
  wireTermPopovers(root);
  const embedded = root.getAttribute(EMBEDDED_ATTRIBUTE);
  if (embedded === null) return;
  const data = decodeReadoutData(embedded);
  const slot = root.querySelector('#timeline-scrubber');
  if (data === null || !(slot instanceof HTMLElement)) return;
  buildScrubber(slot, data);
}
