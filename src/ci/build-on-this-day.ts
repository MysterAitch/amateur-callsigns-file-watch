#!/usr/bin/env node

/**
 * The "on this day" page (issue #726, surface 2): dated event-time callouts —
 * for each prefix series, the earliest held start evidence and the earliest
 * held cancellation evidence — arranged as a calendar of the year, each entry
 * carrying the canonical citation shape ("… dated <event day>, per <dataset>
 * (vintage <assertion time>)") and deep-linking into the evidence (the
 * per-callsign page's event strip, the series page, the dataset entry, the
 * ledger).
 *
 * Epistemic posture (binding):
 *  - Every entry is DERIVED from what the held vintages assert. "Earliest
 *    held" is a statement about THIS corpus, never "the first ever": coverage
 *    is only as complete as what sources attested, and the version-scoped
 *    start kinds mean "earliest start SURVIVING in the asserting vintage"
 *    (issue #800) — reissues and rolling retention drop or replace older rows.
 *  - The two time axes are never conflated: the calendar day is EVENT time;
 *    the citation names the ASSERTION time (the vintage) beside it, always.
 *  - A day with no entry is NON-OBSERVATION, never "nothing ever happened on
 *    this day" — the page says so in its own words.
 *
 * Progressive enhancement: the page is fully static, build-rendered (the
 * issue #712 front-door idiom); site/on-this-day.js layers a "today" callout
 * on top and the calendar remains the no-JS baseline.
 *
 * Deliberately NOT here (recorded remainders on issue #726): forbidden-list
 * changes (their dates are assertion-time publication events — the issue #461
 * change-history cousin — and rendering them as event-time days would conflate
 * the axes this page exists to keep apart), and reservation-window ends (the
 * reserved-until column carries three cohort meanings, so a per-day callout
 * would need the cohort reading before it could be honest).
 */

import * as fs from 'fs';
import * as path from 'path';
import { contributionOf, EARLIEST_SURVIVING_KINDS, isMonthPrecisionVintage, type StateCaveat } from './state-at-t.ts';
import { CAVEAT_LABELS, caveatLabelOf, kindLabelOf } from './build-callsign-event-shards.ts';
import { datasetIndexOf, type EventDatasetRef, type EventTimeProjection } from './event-time-projection.ts';
import { parseCallsign, loadReferenceData, type ReferenceData } from '../sources/ofcom-amateur/components.ts';
import { htmlPage, escapeHtml, callsignPill, dateTime, epistemicsPill, glossaryTerm, REPO_URL, externalLink } from './site-render.ts';

export type OnThisDayEvent = 'first-start' | 'first-cancellation';

export interface OnThisDayEntry {
  // 'mm-dd' — the calendar slot (event time).
  monthDay: string;
  year: string;
  // The full event day, yyyy-mm-dd.
  day: string;
  series: string;
  event: OnThisDayEvent;
  // Every callsign tied on the series' earliest day, sorted.
  callsigns: string[];
  // The event kinds asserted at that day (authored vocabulary order).
  kinds: string[];
  // Indices into the projection's dataset list — the assertion-time citation.
  datasetIdxs: number[];
  caveats: StateCaveat[];
  // The month the series was introduced (ISO yyyy-mm), from the reference data;
  // '' when the reference data records none. Only meaningful for a start entry.
  seriesIntroduced: string;
  // True when this is an earliest-START entry whose event day predates the
  // series' own recorded introduction: the licence-version original start is
  // then carried licence history (the licence chain's origin), NOT the
  // callsign's issuance — the callsign did not exist that early (issues
  // #915/#918). A superlative rendered without this reads as "the series had a
  // start that year", which is false at callsign level.
  predatesSeriesIntroduction: boolean;
}

interface SeriesAcc {
  day: string;
  callsigns: Set<string>;
  kinds: Set<string>;
  datasetIdxs: Set<number>;
}

const CONTRIBUTION_OF_EVENT: Record<OnThisDayEvent, 'licence-start' | 'licence-end'> = {
  'first-start': 'licence-start',
  'first-cancellation': 'licence-end',
};

// Fold the projection into the per-series first-evidence entries. Pure and
// deterministic: series accumulate over the sorted subject map, ties merge,
// and every output list is sorted.
export function computeOnThisDayEntries(projection: EventTimeProjection, ref: ReferenceData = loadReferenceData()): OnThisDayEntry[] {
  const accs = new Map<string, SeriesAcc>(); // "<event>\n<series>"
  for (const [subject, rows] of projection.rows) {
    // The series read is the build-time parser's, over the cleaned form alone —
    // no product/date anchoring needed for the prefix series. Subjects the
    // parser reads no series from (visitor forms, special-event GB forms,
    // unparseable tokens) have no series slot; the page says so.
    const components = parseCallsign(subject, '', ref, '');
    if (components.prefixSeries === '') continue;
    for (const event of ['first-start', 'first-cancellation'] as const) {
      const contribution = CONTRIBUTION_OF_EVENT[event];
      const relevant = rows.filter(row => contributionOf(row.kind) === contribution);
      if (relevant.length === 0) continue;
      const minDay = relevant.reduce((min, row) => (row.day < min ? row.day : min), relevant[0].day);
      const atMin = relevant.filter(row => row.day === minDay);
      const key = `${event}\n${components.prefixSeries}`;
      let acc = accs.get(key);
      if (acc === undefined || minDay < acc.day) {
        acc = { day: minDay, callsigns: new Set(), kinds: new Set(), datasetIdxs: new Set() };
        accs.set(key, acc);
      }
      if (minDay > acc.day) continue;
      acc.callsigns.add(subject);
      for (const row of atMin) {
        acc.kinds.add(row.kind);
        acc.datasetIdxs.add(datasetIndexOf(projection.datasets, row.lane, row.dataset));
      }
    }
  }

  const entries: OnThisDayEntry[] = [];
  for (const [key, acc] of accs) {
    const [event, series] = key.split('\n');
    // Cross-surface caveat parity (#861): the same evidence must carry the
    // same caveats wherever it renders, so this attachment mirrors the
    // engine's — the date-derived pair (earliest-surviving/pre-1977) exactly
    // as the start findings carry them, cancellation-sparsity on every
    // cancellation entry (the engine's coverage table records cancellation
    // evidence as confined to very few vintages, so an "earliest held"
    // cancellation is especially weakly bounded), and month-precision under
    // the engine's own reading of the vintage grammar.
    const caveats: StateCaveat[] = [];
    if ([...acc.kinds].some(kind => EARLIEST_SURVIVING_KINDS.has(kind))) caveats.push('earliest-surviving');
    if (acc.day < '1977-01-01' && event === 'first-start') caveats.push('pre-1977');
    if (event === 'first-cancellation') caveats.push('cancellation-sparsity');
    if ([...acc.datasetIdxs].some((idx) => {
      const ref = projection.datasets[idx];
      if (ref === undefined) throw new Error(`computeOnThisDayEntries: dataset index ${idx} outside the projection's dataset list`);
      return isMonthPrecisionVintage(ref.vintage);
    })) caveats.push('month-precision-vintage');
    // Series-introduction awareness (issues #915/#918): an earliest-start day
    // that falls before the series' own recorded introduction month is carried
    // licence history — the licence chain's origin surviving onto a callsign
    // introduced far later — never the callsign's own issuance. Month-grained
    // comparison, matching the reference data's month-precision introduction.
    const seriesIntroduced = ref.prefixSeries.get(series)?.introduced ?? '';
    const predatesSeriesIntroduction = event === 'first-start'
      && seriesIntroduced !== ''
      && acc.day.slice(0, 7) < seriesIntroduced;
    entries.push({
      monthDay: acc.day.slice(5),
      year: acc.day.slice(0, 4),
      day: acc.day,
      series,
      event: event as OnThisDayEvent,
      callsigns: [...acc.callsigns].sort(),
      kinds: [...acc.kinds].sort(),
      datasetIdxs: [...acc.datasetIdxs].sort((a, b) => a - b),
      caveats,
      seriesIntroduced,
      predatesSeriesIntroduction,
    });
  }
  return entries.sort((a, b) =>
    a.monthDay.localeCompare(b.monthDay) || a.day.localeCompare(b.day)
    || a.event.localeCompare(b.event) || a.series.localeCompare(b.series));
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function dayHeading(monthDay: string): string {
  const [month, day] = monthDay.split('-').map(Number);
  return `${day} ${MONTH_NAMES[month - 1]}`;
}

// A reference-data introduction month (ISO yyyy-mm) as reader-facing prose:
// "2025-10" -> "October 2025". Any other shape renders verbatim (defensive:
// the reference data is hand-curated, so an unexpected value stays visible
// rather than being silently dropped).
function introductionLabel(iso: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(iso);
  if (match === null) return iso;
  return `${MONTH_NAMES[Number(match[2]) - 1]} ${match[1]}`;
}

// The stable anchor for one calendar day: #d-mm-dd (the enhancement script
// resolves today's date against the same shape).
export function dayAnchor(monthDay: string): string {
  return `d-${monthDay}`;
}

function citation(datasets: readonly EventDatasetRef[], idx: number): string {
  const ref = datasets[idx];
  if (ref === undefined) throw new Error(`renderOnThisDay: dataset index ${idx} outside the projection's dataset list`);
  return `<a href="${escapeHtml(ref.href)}">${escapeHtml(ref.title)}</a> (${glossaryTerm('vintage', 0)} ${dateTime(ref.vintage, { precision: 'full-date', exactLabel: 'Assertion time (vintage)' })})`;
}

function entryHtml(entry: OnThisDayEntry, datasets: readonly EventDatasetRef[]): string {
  const lead = entry.event === 'first-start'
    ? 'earliest held start evidence'
    : 'earliest held cancellation evidence';
  const callsigns = entry.callsigns.map(cs => callsignPill(cs, 0)).join(' ');
  const kinds = entry.kinds.map(kind => escapeHtml(kindLabelOf(kind))).join('; ');
  const cite = entry.datasetIdxs.map(idx => citation(datasets, idx)).join('; ');
  const caveats = entry.caveats.length === 0
    ? ''
    : ` <span class="otd-caveats">Caveats: ${entry.caveats.map(caveat =>
      `<a href="#reading-these-dates">${escapeHtml(caveatLabelOf(caveat))}</a>`).join('; ')}.</span>`;
  const tie = entry.callsigns.length > 1 ? ` (${entry.callsigns.length} callsigns tie on this day)` : '';
  // Series-introduction context (issues #915/#918): when the earliest held
  // start predates the series' own introduction, the date is carried licence
  // history, not the callsign's issuance. Rendered as the MORE interesting
  // reading (the record is exemplary of a policy), never a hedge on the date.
  const carriedHistory = entry.predatesSeriesIntroduction
    ? ` <span class="otd-carried">This start predates the ${escapeHtml(entry.series)}-series’ own introduction (${escapeHtml(introductionLabel(entry.seriesIntroduced))}): it is <b>carried licence history</b> — the original start of the holder’s licence chain, which this later-introduced callsign inherited, not the callsign’s own issuance (the callsign did not exist this early). See <a href="series/${encodeURIComponent(entry.series)}.html">the series page</a> for its introduction.</span>`
    : '';
  return `<li id="otd-${escapeHtml(entry.event)}-${escapeHtml(entry.series)}">`
    + `<b>${escapeHtml(entry.year)}</b> ${epistemicsPill('derived', 0)} — the ${lead} for a `
    + `<a href="series/${encodeURIComponent(entry.series)}.html">${escapeHtml(entry.series)}-series</a> callsign: `
    + `${callsigns}${tie}, ${escapeHtml(entry.event === 'first-start' ? 'a start' : 'a cancellation')} dated `
    + `${dateTime(entry.day, { precision: 'full-date', exactLabel: 'Event day (as asserted)' })} — as asserted (${kinds}) per ${cite}.`
    + carriedHistory
    + caveats
    + ` <span class="otd-links"><a href="callsign.html?c=${encodeURIComponent(entry.callsigns[0])}">event strip</a> · `
    + `<a href="ledger.html?c=${encodeURIComponent(entry.callsigns[0])}">ledger</a></span>`
    + '</li>';
}

export function renderOnThisDayPage(entries: readonly OnThisDayEntry[], projection: EventTimeProjection): string {
  const { datasets, asAt } = projection;
  const byMonthDay = new Map<string, OnThisDayEntry[]>();
  for (const entry of entries) {
    const list = byMonthDay.get(entry.monthDay);
    if (list === undefined) byMonthDay.set(entry.monthDay, [entry]);
    else list.push(entry);
  }

  const body: string[] = [
    '<div data-page="on-this-day">',
    '<h1>On this day in the record</h1>',
    '<p>Dated licensing events, arranged by calendar day: for each '
    + `${glossaryTerm('prefix-series', 0)}, the earliest start evidence and the earliest cancellation `
    + 'evidence the held corpus carries. Each entry is <b>derived</b> from what the archived publications '
    + 'assert, and always cites the dataset (and its vintage — the assertion time) beside the event date — '
    + 'the two time axes are never merged. “Earliest held” describes this mirror’s holdings'
    + `${asAt === '' ? '' : ` (assertions up to ${dateTime(asAt, { precision: 'full-date' })})`}, never “the first ever”. `
    + 'For the whole record along the time axis — a scrubbable count of activity by year — see the '
    + '<a href="timeline.html">timeline</a>.</p>',
    // The today slot: filled by the enhancement script (site/on-this-day.js);
    // without JavaScript the calendar below is the complete page.
    '<div id="today-slot"></div>',
    // The mechanism explainer: always present, folded — the conditional-
    // prominence pattern. On this page it is uniformly applicable background
    // (every entry is an "earliest held" reading), so it stays folded rather
    // than shouting on each entry; the per-entry caveat labels link here.
    '<details id="reading-these-dates">',
    '<summary>How to read these dates (earliest-surviving semantics, reissues, coverage)</summary>',
    '<ul>',
    `<li><b>${escapeHtml(caveatLabelOf('earliest-surviving'))}</b> — a version-scoped start date is the earliest start `
    + 'surviving in the asserting vintage. Rolling retention and reissues drop or replace older rows, so earlier '
    + 'starts may have existed and left no surviving trace; a later vintage can even carry <em>less</em> early '
    + 'history than an earlier one.</li>',
    `<li><b>${escapeHtml(caveatLabelOf('pre-1977'))}</b> — original start dates before 1977 are attested-unreliable `
    + '(OARC, citing an administrative glitch by the then regulator).</li>',
    '<li><b>carried licence history</b> — the start dates are the <em>licence chain’s</em> original start '
    + '(Ofcom’s own Licence-View field dictionary, 2014/15 FOI), never the callsign’s issuance date. A '
    + 'recently-introduced series (M8 and M9 from October 2025, M7 from October 2018) inherits the holder’s '
    + 'existing licence history, so its earliest held start can predate the series’ own introduction by decades. '
    + 'Where it does, the entry says so — the carried origin is the interesting fact, not a flaw in the date.</li>',
    `<li><b>${escapeHtml(caveatLabelOf('availability-trap'))}</b> — a day with no entry means the held sources attest `
    + 'nothing for it: non-observation, never “nothing happened”.</li>',
    `<li><b>${escapeHtml(caveatLabelOf('cancellation-sparsity'))}</b> — cancellation dates are attested by very few `
    + 'held vintages, so an “earliest held cancellation” is especially weakly bounded: earlier cancellations may '
    + 'simply be unrecorded in what is held.</li>',
    `<li><b>${escapeHtml(caveatLabelOf('month-precision-vintage'))}</b> — a month-keyed vintage’s assertion time is `
    + 'only proven to lie somewhere inside its month, so citations against it read the whole month conservatively.</li>',
    '<li>Series whose callsigns our parser reads no prefix series from (visitor <code>M/…</code> renderings, '
    + 'special-event <code>GB…</code> forms) have no slot here; their records remain on the '
    + '<a href="callsign.html">per-callsign page</a> and the <a href="ledger.html">ledger</a>.</li>',
    `<li>The full working lives in the committed reports: ${externalLink(`${REPO_URL}/blob/main/reports/state-at-t.md`, 'state-at-t (the inference rules)')} and ${externalLink(`${REPO_URL}/blob/main/reports/event-time-coherency.md`, 'event-time coherency (cross-vintage revisions)')}.</li>`,
    '</ul>',
    '</details>',
  ];

  if (entries.length === 0) {
    body.push('<p><b>No entries.</b> The held corpus carries no per-series licensing-event evidence to place on a '
      + 'calendar — which is a statement about these holdings, not about history.</p>');
  } else {
    for (let month = 1; month <= 12; month += 1) {
      const mm = String(month).padStart(2, '0');
      const monthDays = [...byMonthDay.keys()].filter(md => md.startsWith(`${mm}-`)).sort();
      if (monthDays.length === 0) continue;
      body.push(`<h2 id="m-${mm}">${MONTH_NAMES[month - 1]}</h2>`);
      for (const monthDay of monthDays) {
        const dayEntries = byMonthDay.get(monthDay);
        if (dayEntries === undefined) continue; // unreachable: keys come from the map
        body.push(`<h3 id="${dayAnchor(monthDay)}">${escapeHtml(dayHeading(monthDay))}</h3>`);
        body.push('<ul class="otd-day">');
        for (const entry of dayEntries) body.push(entryHtml(entry, datasets));
        body.push('</ul>');
      }
    }
    body.push(`<p class="otd-count">${entries.length} entries across ${byMonthDay.size} calendar days, covering `
      + 'the series the held corpus carries start or cancellation evidence for. Days not listed carry no held '
      + 'evidence — non-observation, never “nothing happened”.</p>');
  }

  body.push('<script type="module" src="on-this-day.js"></script>', '</div>');

  return htmlPage('On this day — UK amateur callsign data mirror', 0, body, {
    currentNav: 'On this day',
    sourcePath: 'src/ci/build-on-this-day.ts',
  });
}

export interface OnThisDaySummary {
  outputPath: string;
  entries: number;
  days: number;
}

export function buildOnThisDay(projection: EventTimeProjection, outputPath: string, ref: ReferenceData = loadReferenceData()): OnThisDaySummary {
  const entries = computeOnThisDayEntries(projection, ref);
  const html = renderOnThisDayPage(entries, projection);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html);
  return { outputPath, entries: entries.length, days: new Set(entries.map(e => e.monthDay)).size };
}

// Drift guard used by the tests: every caveat this page can attach carries an
// authored label (the labels live with the shard builder so both surfaces
// speak one vocabulary).
export const ON_THIS_DAY_CAVEATS: readonly StateCaveat[] = [...CAVEAT_LABELS.keys()];
