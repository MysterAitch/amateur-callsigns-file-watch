// @ts-check
// Progressive enhancement for the generated event-time timeline page
// (issue #726): fetches the pre-aggregated per-bucket JSON built at deploy by
// src/ci/build-timeline.ts and lays an input[type=range] SCRUBBER over it. As
// the reader drags the slider, a linked readout updates instantly (the
// crossfilter linked-view / d3-brush range-selection idioms, hand-built with no
// dependency) with what the mirror can say AS AT that instant: callsigns with a
// surviving start by then, reservation windows stated to still be open, and the
// leading prefix series — each figure naming its asserting vintages and its
// caveats, so nothing renders bare (issue #861).
//
// The static histograms and cumulative table on the page are the complete no-JS
// baseline; this script only ever ADDS the scrubber, and injects it into an
// empty placeholder so a no-JS reader never meets a dead control.
//
// The two time axes are never conflated: a bucket's figures are EVENT time, and
// their "asserted by" list is ASSERTION time (dataset + vintage). Everything
// data-derived is written with textContent, never innerHTML.

import { dateTime } from './datetime.js';

// ---------------------------------------------------------------------------
// Shapes (mirroring src/ci/build-timeline.ts — the two must be kept in step).

/**
 * @typedef {object} TimelineDataset
 * @property {string} lane
 * @property {string} key
 * @property {string} vintage
 * @property {string} title
 * @property {string} href
 */

/**
 * @typedef {object} TimelineBucket
 * @property {string} year
 * @property {Record<string, number>} perKind
 * @property {number} startsToDate
 * @property {number} activeReservations
 * @property {Array<[string, number]>} topSeries
 * @property {number[]} datasetIdxs
 * @property {string[]} caveats
 */

/**
 * @typedef {object} TimelineData
 * @property {number} schemaVersion
 * @property {string} asAt
 * @property {{ id: string, label: string, contribution: string }[]} kinds
 * @property {{ id: string, label: string, gloss: string }[]} caveats
 * @property {TimelineDataset[]} datasets
 * @property {TimelineBucket[]} buckets
 */

// ---------------------------------------------------------------------------
// DOM helpers (textContent everywhere).

/**
 * @param {string} tag
 * @param {string | null} [cls]
 * @param {string | null} [txt]
 */
const el = (tag, cls, txt) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (txt != null) node.textContent = txt;
  return node;
};

// The attrs-object element factory the shared datetime wrapper expects.
/**
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 * @returns {HTMLElement}
 */
const elAttrs = (tag, attrs = {}) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  return node;
};

/** @param {string} href @param {string} label */
const link = (href, label) => {
  const a = el('a', null, label);
  a.setAttribute('href', href);
  return a;
};

// An assertion-time vintage, day- or month-keyed as published.
/** @param {string} vintage */
const vintageEl = (vintage) => dateTime(elAttrs, vintage, { precision: 'full-date', exactLabel: 'Assertion time (vintage)' });

// ---------------------------------------------------------------------------
// The readout (pure DOM over one bucket; exported for the jsdom unit tests).

/**
 * Render the per-instant figures for one bucket into `host`.
 * @param {HTMLElement} host
 * @param {TimelineBucket} bucket
 * @param {TimelineData} data
 */
export function renderReadout(host, bucket, data) {
  host.textContent = '';
  const kindLabels = new Map(data.kinds.map(k => [k.id, k.label]));
  const caveatById = new Map(data.caveats.map(c => [c.id, c]));

  const head = el('h3', 'tl-year');
  head.append(`As at end of ${bucket.year}`);
  host.appendChild(head);

  const starts = el('p', 'tl-figure');
  const startsBadge = el('span', 'tb d', 'derived');
  starts.appendChild(startsBadge);
  starts.append(` ${bucket.startsToDate.toLocaleString('en-GB')} ${bucket.startsToDate === 1 ? 'callsign has' : 'callsigns have'} `
    + `a surviving licence-start dated on or before end of ${bucket.year}.`);
  host.appendChild(starts);

  const reservations = el('p', 'tl-figure');
  reservations.append(`${bucket.activeReservations.toLocaleString('en-GB')} reservation `
    + `${bucket.activeReservations === 1 ? 'window is' : 'windows are'} stated to still be open at end of ${bucket.year} `
    + '(stated end on or after then, stating vintage proven by then) — a reading of the stated bound, never a status.');
  host.appendChild(reservations);

  // This year's own activity (event time), if any.
  const kindEntries = Object.entries(bucket.perKind);
  if (kindEntries.length > 0) {
    const activity = el('p', 'tl-figure');
    activity.append(`New dated events in ${bucket.year}: `);
    kindEntries.forEach(([kindId, n], i) => {
      if (i > 0) activity.append('; ');
      activity.append(`${kindLabels.get(kindId) ?? kindId} × ${n.toLocaleString('en-GB')}`);
    });
    activity.append('.');
    host.appendChild(activity);
  }

  // The leading prefix series by cumulative starts at this instant.
  if (bucket.topSeries.length > 0) {
    const seriesP = el('p', 'tl-figure');
    seriesP.append('Leading prefix series by starts to date: ');
    bucket.topSeries.forEach(([series, n], i) => {
      if (i > 0) seriesP.append(', ');
      seriesP.appendChild(link(`series/${encodeURIComponent(series)}.html`, series));
      seriesP.append(` (${n.toLocaleString('en-GB')})`);
    });
    seriesP.append('.');
    host.appendChild(seriesP);
  }

  // The assertion-time axis: which datasets/vintages state this year's events.
  const assert = el('p', 'tl-assert');
  if (bucket.datasetIdxs.length === 0) {
    assert.append(`No new dated event is asserted in ${bucket.year} — the figures above carry forward from earlier years.`);
  } else {
    assert.append('This year’s events are asserted by ');
    bucket.datasetIdxs.forEach((idx, i) => {
      const dataset = data.datasets[idx];
      if (dataset === undefined) return;
      if (i > 0) assert.append('; ');
      assert.appendChild(link(dataset.href, dataset.title));
      assert.append(' (vintage ');
      assert.appendChild(vintageEl(dataset.vintage));
      assert.append(')');
    });
    assert.append('.');
  }
  host.appendChild(assert);

  // Caveats: labelled and glossed (never a bare id — issue #861), linking to
  // the page's own folded explainer.
  if (bucket.caveats.length > 0) {
    const cav = el('p', 'tl-caveats');
    cav.append('Caveats: ');
    bucket.caveats.forEach((id, i) => {
      if (i > 0) cav.append('; ');
      const caveat = caveatById.get(id);
      // A caveat missing from the legend must never render as a bare machine id
      // (issue #861): fall back to a humanised label and flag the gap in the
      // title, still linking to the page's explainer.
      const label = caveat === undefined ? id.replace(/-/g, ' ') : caveat.label;
      const a = link('#reading-this-timeline', label);
      a.setAttribute('title', caveat === undefined ? 'This caveat is not in the page legend; see the explainer.' : caveat.gloss);
      cav.appendChild(a);
    });
    cav.append('.');
    host.appendChild(cav);
  }
}

// ---------------------------------------------------------------------------
// The scrubber (slider + linked readout; exported for the jsdom unit tests).

/**
 * The bucket the scrubber opens on: the corpus's latest PROVEN assertion year
 * (asAt), not the maximum event year — event dates run past today (future-dated
 * reservations, the odd outlier), so opening on the last bucket would anchor on
 * a year that has not happened. Mirrors anchorBucketIndex in build-timeline.ts.
 * @param {TimelineData} data
 * @returns {number}
 */
export function anchorIndex(data) {
  if (data.buckets.length === 0) return -1;
  const anchorYear = (data.asAt || '').slice(0, 4);
  const idx = data.buckets.findIndex(b => b.year === anchorYear);
  if (idx !== -1) return idx;
  // asAt outside the span: below it opens on the first bucket, above it (the
  // usual case) on the last. Mirrors anchorBucketIndex in build-timeline.ts.
  return anchorYear < data.buckets[0].year ? 0 : data.buckets.length - 1;
}

/**
 * Build the range scrubber and its linked readout into `slot`, opening on the
 * corpus "as at" instant (see anchorIndex).
 * @param {HTMLElement} slot
 * @param {TimelineData} data
 * @returns {{ input: HTMLInputElement, readout: HTMLElement }}
 */
export function buildScrubber(slot, data) {
  slot.textContent = '';
  const wrap = el('div', 'tl-scrubber');
  const label = el('label');
  label.setAttribute('for', 'tl-range');
  label.append('Scrub the timeline — as at the end of a year');
  wrap.appendChild(label);

  const input = /** @type {HTMLInputElement} */ (el('input'));
  input.id = 'tl-range';
  input.type = 'range';
  input.min = '0';
  input.max = String(data.buckets.length - 1);
  input.step = '1';
  input.value = String(anchorIndex(data));
  input.setAttribute('aria-label', 'Timeline position (year)');
  wrap.appendChild(input);

  const readout = el('div', 'tl-readout');
  readout.id = 'tl-readout';
  readout.setAttribute('aria-live', 'polite');
  wrap.appendChild(readout);
  slot.appendChild(wrap);

  const show = () => {
    const idx = Math.min(Math.max(Number(input.value) | 0, 0), data.buckets.length - 1);
    const bucket = data.buckets[idx];
    if (bucket !== undefined) renderReadout(readout, bucket, data);
  };
  input.addEventListener('input', show);
  show();
  return { input, readout };
}

// ---------------------------------------------------------------------------
// The fetch-and-enhance entry point.

const DEFAULT_SRC = 'timeline/data.json';

/**
 * Apply the enhancement: find the scrubber slot, fetch its data, and build the
 * slider. A failure renders a calm in-slot note and never throws — the static
 * page beneath is unaffected.
 * @param {Document} doc
 * @param {{ fetch?: typeof fetch }} [opts]
 * @returns {Promise<{ buckets: number } | { error: string } | null>}
 */
export async function enhanceTimeline(doc, opts = {}) {
  const root = doc.querySelector('[data-page="timeline"]');
  const slot = doc.getElementById('timeline-scrubber');
  if (root === null || slot === null) return null;
  const src = slot.getAttribute('data-timeline-src') || DEFAULT_SRC;
  const fetchFn = opts.fetch ?? fetch;
  try {
    const res = await fetchFn(new URL(src, doc.baseURI).toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    /** @type {unknown} */
    const parsed = JSON.parse(text);
    const data = /** @type {TimelineData} */ (parsed);
    if (!Array.isArray(data.buckets) || data.buckets.length === 0) {
      throw new Error('the timeline data carries no buckets');
    }
    buildScrubber(slot, data);
    return { buckets: data.buckets.length };
  } catch (err) {
    slot.textContent = '';
    const note = el('p', 'muted');
    note.append(`Could not load the timeline data (${err instanceof Error ? err.message : String(err)}). `
      + 'The histograms and the cumulative table below are the complete record; you can also read the ');
    note.appendChild(link('on-this-day.html', 'on-this-day calendar'));
    note.append('.');
    slot.appendChild(note);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

if (typeof document !== 'undefined' && document.querySelector('[data-page="timeline"]') !== null) {
  void enhanceTimeline(document);
}
