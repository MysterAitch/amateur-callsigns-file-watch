// @ts-check
// v1 TIMELINE sections (issue #932): the event-time histogram + scrubber, from
// the root-served timeline manifest. Event time leads — each bar is a count of
// dated events the record states fell in a year — and every figure names the
// publications and vintages that assert it (assertion time), so the two clocks
// never merge. The per-year charts and cumulative table are the substance; the
// scrubber is the interactive layer over the same pre-aggregated buckets. All
// data-derived DOM is textContent, never innerHTML; the v1 surface links only to
// itself, so dataset and series names render as plain text.

import { V1_COPY } from './copy.js';
import { el, fill, ledeWithCue, caveatLinks, explainer } from './history-common.js';
import { inlineTerm, termCue, wireTermPopovers } from './glossary.js';

const EXPLAINER_ID = 'reading-this-timeline';

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
 * @param {TimelineData} data
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
// The per-instant readout (pure DOM over one bucket; exported for jsdom tests).

/**
 * @param {HTMLElement} host
 * @param {TimelineBucket} bucket
 * @param {TimelineData} data
 */
export function renderReadout(host, bucket, data) {
  const copy = V1_COPY.history.timeline;
  host.textContent = '';
  const kindLabels = new Map(data.kinds.map((k) => [k.id, k.label]));
  const legend = new Map(data.caveats.map((c) => [c.id, c]));

  host.appendChild(el('h3', 'tl-year', fill(copy.readoutAsAt, { year: bucket.year })));

  const starts = el('p', 'tl-figure');
  starts.appendChild(el('span', 'tb d', 'derived'));
  starts.append(' ' + fill(copy.readoutStarts, {
    count: bucket.startsToDate.toLocaleString('en-GB'),
    subject: bucket.startsToDate === 1 ? 'callsign has' : 'callsigns have',
    year: bucket.year,
  }));
  host.appendChild(starts);

  host.appendChild(el('p', 'tl-figure', fill(copy.readoutReservations, {
    count: bucket.activeReservations.toLocaleString('en-GB'),
    subject: bucket.activeReservations === 1 ? 'window is' : 'windows are',
    year: bucket.year,
  })));

  const kindEntries = Object.entries(bucket.perKind);
  if (kindEntries.length > 0) {
    const activity = el('p', 'tl-figure');
    activity.append(fill(copy.readoutActivity, { year: bucket.year }));
    kindEntries.forEach(([kindId, n], i) => {
      if (i > 0) activity.append('; ');
      activity.append(`${kindLabels.get(kindId) ?? kindId} × ${n.toLocaleString('en-GB')}`);
    });
    activity.append('.');
    host.appendChild(activity);
  }

  // Leading prefix series — plain text (series pages are not part of the v1
  // surface yet, so the record names them without linking off-surface).
  if (bucket.topSeries.length > 0) {
    const seriesP = el('p', 'tl-figure');
    seriesP.append(copy.readoutSeries);
    bucket.topSeries.forEach(([series, n], i) => {
      if (i > 0) seriesP.append(', ');
      seriesP.append(`${series} (${n.toLocaleString('en-GB')})`);
    });
    seriesP.append('.');
    host.appendChild(seriesP);
  }

  // The assertion-time axis: which publications/vintages state this year's events.
  const assert = el('p', 'tl-assert');
  if (bucket.datasetIdxs.length === 0) {
    assert.append(fill(copy.readoutAssertedNone, { year: bucket.year }));
  } else {
    assert.append(copy.readoutAssertedLead);
    bucket.datasetIdxs.forEach((idx, i) => {
      const dataset = data.datasets[idx];
      if (dataset === undefined) return;
      if (i > 0) assert.append('; ');
      const span = el('span', null, dataset.title);
      if (dataset.key !== '') span.setAttribute('title', dataset.key);
      assert.appendChild(span);
      if (dataset.vintage !== '') {
        assert.append(' (vintage ');
        assert.appendChild(inlineTerm('vintage', dataset.vintage));
        assert.append(')');
      }
    });
    assert.append('.');
  }
  host.appendChild(assert);

  const caveats = caveatLinks(bucket.caveatIds, legend, `#${EXPLAINER_ID}`);
  if (caveats !== null) {
    caveats.classList.add('tl-caveats');
    host.appendChild(caveats);
  }
}

/**
 * The slider + linked readout, opening on the corpus "as at" instant.
 * @param {HTMLElement} slot
 * @param {TimelineData} data
 * @returns {{ input: HTMLInputElement, readout: HTMLElement }}
 */
export function buildScrubber(slot, data) {
  const copy = V1_COPY.history.timeline;
  slot.textContent = '';
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
 * Render the whole timeline surface into `root` (the page's #sections host).
 * @param {HTMLElement} root
 * @param {TimelineData} data
 */
export function renderTimeline(root, data) {
  const copy = V1_COPY.history.timeline;
  root.textContent = '';
  const surface = el('section', 'surface');
  surface.appendChild(ledeWithCue(copy.lede));
  surface.appendChild(explainer(EXPLAINER_ID, copy.explainerLabel, copy.explainerLead, data.caveats));

  if (data.kinds.length === 0 || data.buckets.length === 0) {
    surface.appendChild(el('p', 'note', copy.empty));
    root.appendChild(surface);
    return;
  }

  // The scrubber first (the interactive lede of the surface), then the static
  // charts and cumulative table beneath (the substance).
  const scrubberSlot = el('div', null);
  scrubberSlot.id = 'timeline-scrubber';
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

  root.appendChild(surface);
  buildScrubber(scrubberSlot, data);
  wireTermPopovers(root);
}
