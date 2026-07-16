#!/usr/bin/env node

/**
 * Builds the forbidden-suffix site section (issue #291 phases 2 + 3): a
 * discrete, STATIC, Wayback-crawlable section for the forbidden-suffix lists,
 * mirroring the dataset/FOI entry-page information architecture. A section
 * index, one page per forbidden-list disclosure, and (phase 3) one detail page
 * per ever-forbidden union suffix, with the notable-change suffixes on the
 * index and disclosure pages now linked into those detail pages.
 *
 * Reuses the committed phase-1 data foundation (buildForbiddenSuffixHistory in
 * src/ci/forbidden-suffix-history.ts) and the phase-3 suffix -> callsigns index
 * (buildSuffixCallsignIndex in src/ci/forbidden-suffix-callsigns.ts, built ONCE
 * per build, not per page): it does NOT re-parse the archive per page. Every
 * figure traces back through those layers to the committed FOI `forbidden-list`
 * entries and the archived publications. Shared render helpers (nav, breadcrumb,
 * entry-page shell, download slots, breakdown bars, the a11y skip-link / <main>
 * pattern, the shared design tokens) are imported from site-render.ts,
 * so the section reads as one product with the site.
 *
 * Boundaries (deliberately): STATIC only — no interactive filtering, SQL, or
 * live browser (that is phase 3b), so the core content renders with no
 * JavaScript. Per-suffix callsign counts ALWAYS decompose by status (Allocated
 * / Reserved / Available / Forbidden / …), never a bare total — a rise in
 * matches could be a Reserved spike, or a batch of Forbidden prohibition rows,
 * rather than new Allocated issuance, a very different meaning. Row-level flags
 * are untouched here (that is phase 4 / #179): this phase is presentation +
 * cross-links only.
 *
 * Everything here is DECLARED, not verified; absence of a suffix from a
 * disclosure is not evidence it may be issued, and absence of a callsign is not
 * evidence a suffix may be issued.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  buildForbiddenSuffixHistory,
  type ForbiddenDisclosure,
  type ForbiddenSuffixHistory,
} from './forbidden-suffix-history.ts';
import {
  buildSuffixCallsignIndex,
  type SuffixCallsignIndex,
  type SuffixCallsignInfo,
  type SuffixCallsign,
} from './forbidden-suffix-callsigns.ts';
import { readFoiEntryMeta, type FoiEntryMeta } from '../shared/foi-archive.ts';
import { parseCallsign, loadReferenceData, type ReferenceData } from '../sources/ofcom-amateur/components.ts';
import {
  escapeHtml,
  sizeOf,
  breadcrumbHtml,
  htmlPage,
  entryPage,
  noticeStrip,
  downloadSlot,
  downloadTier,
  breakdownRows,
  callsignPill,
  statusField,
  humanDate,
  glossaryTerm,
  tableCaption,
} from './site-render.ts';
import { fidelityNudge, flagAnchor } from './render/fidelity.ts';
import { reportAffordance } from './render/report.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const DEFAULT_BASE_URL = 'https://mysteraitch.github.io/amateur-callsigns-file-watch';
const FOI_DIR = path.join(REPO_ROOT, 'archive', 'foi');

// Small enough to name every suffix in a breakdown row (the outlier
// last-modified date, the handful of drifting suffixes); larger buckets are
// counted only. Matches the phase-1 report's ENUMERATE_LIMIT.
const ENUMERATE_LIMIT = 25;
// How many suffixes to preview inline on a disclosure page before "+N more".
const PREVIEW_LIMIT = 24;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function num(n: number): string {
  return n.toLocaleString('en-GB');
}

// Humanise a disclosure vintage for headings and captions: '2024-12' ->
// 'December 2024'; '2019-08-12' -> '12 August 2019'; '2016-09' ->
// 'September 2016'. Falls back to the raw value for anything unrecognised.
function humanVintage(vintage: string): string {
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(vintage);
  if (ymd !== null) return `${Number(ymd[3])} ${MONTHS[Number(ymd[2]) - 1]} ${ymd[1]}`;
  const ym = /^(\d{4})-(\d{2})$/.exec(vintage);
  if (ym !== null) return `${MONTHS[Number(ym[2]) - 1]} ${ym[1]}`;
  return vintage;
}

// Suffixes as inline <code> spans, unlinked — kept for the few sites where a
// suffix is named incidentally (a duplicated-row artefact, a last-modified
// bucket label) rather than as a drill-down target.
function suffixCodes(suffixes: string[]): string {
  return suffixes.length === 0 ? '—' : suffixes.map(s => `<code>${escapeHtml(s)}</code>`).join(', ');
}

// Every ever-forbidden union suffix has its own detail page at
// forbidden/suffix/{SUFFIX}/index.html. These build the relative href to it
// from each depth the section renders at (index = forbidden/, disclosure =
// forbidden/{entry}/, suffix = forbidden/suffix/{SUFFIX}/).
type LinkOrigin = 'index' | 'disclosure' | 'suffix';
function suffixHref(suffix: string, from: LinkOrigin): string {
  const enc = encodeURIComponent(suffix);
  if (from === 'index') return `suffix/${enc}/index.html`;
  if (from === 'disclosure') return `../suffix/${enc}/index.html`;
  return `../${enc}/index.html`;
}

// Suffixes as linked <code> spans into their per-suffix detail pages — the
// phase-3 notable-change drill-downs. Every listed suffix is in the union, so
// every link resolves to a page that exists.
function suffixLinks(suffixes: string[], from: LinkOrigin): string {
  return suffixes.length === 0
    ? '—'
    : suffixes.map(s => `<a href="${suffixHref(s, from)}"><code>${escapeHtml(s)}</code></a>`).join(', ');
}

// The left timeline sidebar of forbidden-list disclosures, oldest first (the
// story is chronological), the current disclosure marked and not linked —
// mirroring the dataset/FOI entry sidebar's shape and classes.
function disclosureSidebar(currentEntry: string, disclosures: ForbiddenDisclosure[]): string {
  const item = (d: ForbiddenDisclosure): string => {
    const isCurrent = d.entry === currentEntry;
    const drift = [d.added.length > 0 ? `+${d.added.length}` : '', d.removed.length > 0 ? `−${d.removed.length}` : ''].filter(s => s !== '').join(' ');
    const caption = `${num(d.distinctCount)} suffixes${drift === '' ? '' : ` · ${drift}`}`;
    const inner = `<span class="dpitch"><small class="src">forbidden list</small> <b>${escapeHtml(humanVintage(d.vintage))}</b>${isCurrent ? ' <small class="gap">this page</small>' : ''}</span><small class="dcap">${escapeHtml(caption)}</small>`;
    return isCurrent
      ? `<li class="dcur" aria-current="page">${inner}</li>`
      : `<li><a href="../${escapeHtml(d.entry)}/index.html">${inner}</a></li>`;
  };
  return `<nav class="nav-side" aria-label="Forbidden-list disclosures"><h2>Disclosures</h2><ol class="dlist">${disclosures.map(item).join('')}</ol></nav>`;
}

// The At-a-glance sidebar for a disclosure: distinct-suffix headline, the row
// count with any duplicate surfaced honestly, and — where the source carries a
// per-suffix LastModifiedDate — the DISTRIBUTION as a small breakdown, never a
// single figure.
function atAGlance(d: ForbiddenDisclosure): string {
  const rowsNote = d.rowCount === d.distinctCount
    ? `${num(d.rowCount)} rows`
    : `${num(d.rowCount)} rows — ${suffixCodes(d.duplicates)} listed twice`;
  const lmTotal = d.lastModified.reduce((a, b) => a + b.count, 0);
  const lmRows: [string, number][] = d.lastModified.map(b => {
    const label = b.count <= ENUMERATE_LIMIT ? `${b.value} (${b.suffixes.join(', ')})` : b.value;
    return [label, b.count];
  });
  const lastModifiedBlock = d.lastModified.length > 0
    ? `<div class="bd"><h3>Last modified <small class="lvl">— distribution, not one date</small></h3>${breakdownRows(lmRows, lmTotal)}</div>`
    : `<div class="bd"><h3>Last modified</h3><div class="brow"><span class="lab gap">no per-suffix timestamp in this disclosure</span></div></div>`;
  return [
    '<section><h2>At a glance</h2>',
    `<div class="headline">${num(d.distinctCount)} <small>distinct suffixes</small></div>`,
    `<div class="bd"><h3>Rows</h3><div class="brow"><span class="lab">${rowsNote}</span></div>${d.duplicates.length > 0 ? '<p class="dcap">A within-disclosure data-quality artefact, surfaced — never silently deduplicated.</p>' : ''}</div>`,
    lastModifiedBlock,
    '<div class="attr">',
    `<div><b>Vintage</b> · ${escapeHtml(humanVintage(d.vintage))}</div>`,
    `<div>Source disclosure · <code>${escapeHtml(d.entry)}</code></div>`,
    '</div>',
    '</section>',
  ].join('\n');
}

// The Notable panel: the changes versus the previous disclosure — the "why you
// clicked through" finding. Changed suffixes are NAMED as text (phase-2
// boundary: no per-suffix drill-down links yet). The removals are flagged as
// the standout direction, and the source's own vintage note is surfaced (for
// the 2024 disclosure this carries the ~2020-currency caveat).
function notablePanel(d: ForbiddenDisclosure, prev: ForbiddenDisclosure | undefined, meta: FoiEntryMeta): string {
  const items: string[] = [];
  if (prev === undefined) {
    items.push(`<li><b>Baseline</b> — ${num(d.distinctCount)} suffixes; no earlier disclosure to diff against.</li>`);
  } else if (d.added.length === 0 && d.removed.length === 0) {
    items.push(`<li><b>No change</b> from ${escapeHtml(humanVintage(prev.vintage))} — the identical ${num(d.distinctCount)}-suffix set.</li>`);
  } else {
    const parts: string[] = [];
    if (d.added.length > 0) parts.push(`added ${suffixLinks(d.added, 'disclosure')}`);
    if (d.removed.length > 0) parts.push(`removed ${suffixLinks(d.removed, 'disclosure')}`);
    items.push(`<li><b>vs ${escapeHtml(humanVintage(prev.vintage))}:</b> ${parts.join('; ')} → ${num(d.distinctCount)} suffixes. <span class="gap">Each opens its per-suffix page.</span></li>`);
    if (d.removed.length > 0) {
      items.push(`<li class="rel"><b>The de-listing is the standout.</b> A removal means a previously-withheld suffix could now be issued — the notable direction. The working theory is that such removals (here ${suffixLinks(d.removed, 'disclosure')}) may be export artefacts rather than a deliberate policy change, so the ever-forbidden union keeps them flagged. Declared, not verified.</li>`);
    }
  }
  if (d.duplicates.length > 0) {
    items.push(`<li class="rel">${suffixCodes(d.duplicates)} ${d.duplicates.length === 1 ? 'appears on a duplicated row' : 'appear on duplicated rows'} — surfaced, not deduplicated.</li>`);
  }
  if (meta.dataVintageNote !== undefined) {
    items.push(`<li class="rel"><b>Vintage note:</b> ${escapeHtml(meta.dataVintageNote)}</li>`);
  }
  return `<div class="notable"><ul>${items.join('')}</ul></div>`;
}

// The middle "list" summary: what the list is, a preview of the vocabulary,
// and the phase-3 status-decomposition commitment in plain copy.
function listSection(d: ForbiddenDisclosure): string {
  const preview = d.distinctSuffixes.slice(0, PREVIEW_LIMIT);
  const more = d.distinctCount - preview.length;
  return [
    '<section><h2>The list</h2>',
    `<p class="lead">${num(d.distinctCount)} distinct three-letter ${glossaryTerm('forbidden-suffix', 2, { label: 'suffixes' })} withheld from issue in this disclosure. A callsign already carrying one predates the withholding — see the <a href="../index.html">ever-forbidden note</a> on the section index. Each suffix links to its detail page.</p>`,
    `<p>${suffixLinks(preview, 'disclosure')}${more > 0 ? ` … <span class="gap">and ${num(more)} more — download the full list below, or browse them from the <a href="../index.html">section index</a></span>` : ''}</p>`,
    `<p class="dcap">Each per-suffix page lists every callsign carrying the suffix, broken down by ${glossaryTerm('status-values', 2, { label: 'status' })} (Allocated / Reserved / Available / Forbidden) — never a bare total, since a rise could be a Reserved spike, or a batch of Forbidden prohibition rows, rather than new issuance.</p>`,
    '</section>',
  ].join('\n');
}

// "Get the data": the committed source file offered as a download (name +
// size), plus a navigate link to the full FOI disclosure entry for everything
// else (raw workbook, extracts, provenance, integrity hashes). Download slots
// carry a size; navigation links never do — the established pattern.
function getDataSection(d: ForbiddenDisclosure): string {
  const archiveFile = path.join(FOI_DIR, d.entry, d.sourceFile);
  const href = `../../datasets/foi/${encodeURIComponent(d.entry)}/${encodeURIComponent(d.sourceFile)}`;
  const slot = downloadSlot(d.sourceFile, href, `CSV${sizeOf(archiveFile)}`, 'normalised forbidden-suffix list — one suffix per row (with its last-modified date where the disclosure carries one)');
  return [
    '<section><h2>Get the data</h2>',
    downloadTier('Forbidden-suffix list', [slot]),
    `<a class="linkout" href="../../datasets/foi/${encodeURIComponent(d.entry)}/index.html">Browse the full disclosure → the complete FOI archive entry: raw source, extracts, and hash-pinned provenance.</a>`,
    '</section>',
  ].join('\n');
}

// One per-disclosure page, reusing the entry-page card shell at depth 2
// (forbidden/{entry}/): breadcrumb + H1 + provenance notice, then the
// three-region layout — left timeline sidebar, middle notable/list/downloads,
// right at-a-glance.
function disclosurePage(d: ForbiddenDisclosure, prev: ForbiddenDisclosure | undefined, disclosures: ForbiddenDisclosure[]): string {
  const meta = readFoiEntryMeta(FOI_DIR, d.entry);
  const title = `Forbidden suffixes — ${humanVintage(d.vintage)} disclosure`;
  const body = [
    breadcrumbHtml([['Forbidden suffixes', '../index.html'], [humanVintage(d.vintage), undefined]]),
    `<h1>${escapeHtml(title)}</h1>`,
    `<p class="subtitle">One of the forbidden-suffix disclosures the mirror holds. Source disclosure <code>${escapeHtml(d.entry)}</code> · <a href="../../datasets/foi/${encodeURIComponent(d.entry)}/index.html">full FOI entry</a>.</p>`,
    noticeStrip(false, 'Freedom-of-Information disclosure — a point-in-time snapshot, not a live feed. Every figure is <b>declared, not verified</b>; absence of a suffix is not evidence it may be issued.'),
    '<div class="main-region">',
    disclosureSidebar(d.entry, disclosures),
    '<div class="col">',
    `<section><h2>Notable — changes vs the previous disclosure</h2>${notablePanel(d, prev, meta)}</section>`,
    listSection(d),
    getDataSection(d),
    '</div>',
    `<div class="side">${atAGlance(d)}</div>`,
    '</div>',
  ];
  return entryPage(title, body, { currentNav: 'Forbidden suffixes', sourcePath: `archive/foi/${d.entry}` }, 2);
}

// The union's first-known-forbidden dates, bucketed by date part — a small
// distribution (an origin bulk plus a couple of later points), never a single
// figure. Small buckets are enumerated so the outliers are named.
function firstKnownDistribution(h: ForbiddenSuffixHistory): { dateKey: string; suffixes: string[] }[] {
  const buckets = new Map<string, string[]>();
  for (const suffix of h.everForbiddenUnion) {
    const key = h.firstKnownForbidden[suffix].dateKey;
    const list = buckets.get(key) ?? [];
    list.push(suffix);
    buckets.set(key, list);
  }
  return [...buckets.entries()]
    .map(([dateKey, suffixes]) => ({ dateKey, suffixes: [...suffixes].sort() }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

// The section index: what the list is, the disclosures timeline (each row
// linking to its page), the headline change counts, the ever-forbidden union,
// and the first-known-forbidden distribution. A plain-table page (no JS), like
// the dataset/series/reports index pages.
// The A–Z browse block: every union suffix as a link to its detail page,
// grouped by first letter so the ~1,466 links stay scannable and every
// per-suffix page is reachable by a crawler (no page is orphaned).
function browseAllSuffixes(h: ForbiddenSuffixHistory): string[] {
  const groups = new Map<string, string[]>();
  for (const suffix of h.everForbiddenUnion) {
    const letter = suffix.slice(0, 1);
    const list = groups.get(letter) ?? [];
    list.push(suffix);
    groups.set(letter, list);
  }
  const out: string[] = [];
  for (const letter of [...groups.keys()].sort()) {
    const links = (groups.get(letter) ?? []).sort().map(s => `<a href="${suffixHref(s, 'index')}"><code>${escapeHtml(s)}</code></a>`).join(' ');
    out.push(`<p><b>${escapeHtml(letter)}</b> — ${links}</p>`);
  }
  return out;
}

function indexPage(h: ForbiddenSuffixHistory, index: SuffixCallsignIndex): string {
  const timelineRows = h.disclosures.map(d =>
    `<tr><td><a href="${escapeHtml(d.entry)}/index.html">${escapeHtml(humanVintage(d.vintage))}</a><br><code>${escapeHtml(d.entry)}</code></td><td>${num(d.distinctCount)}</td><td>${num(d.rowCount)}</td><td>${suffixCodes(d.duplicates)}</td><td>${suffixLinks(d.added, 'index')}</td><td>${suffixLinks(d.removed, 'index')}</td></tr>`);

  const steady = h.disclosures.filter(d => d.added.length === 0 && d.removed.length === 0);
  const drift = h.disclosures.filter(d => d.added.length > 0 || d.removed.length > 0);
  const baseline = h.disclosures[0];
  const headline: string[] = [];
  if (baseline !== undefined && steady.length > 1) {
    const lastSteady = steady[steady.length - 1];
    headline.push(`<p>The withheld vocabulary held steady at <b>${num(baseline.distinctCount)}</b> suffixes across the ${steady.length} earliest disclosures (${escapeHtml(humanVintage(baseline.vintage))} to ${escapeHtml(humanVintage(lastSteady.vintage))}).</p>`);
  }
  for (const d of drift) {
    const parts: string[] = [];
    if (d.added.length > 0) parts.push(`added ${suffixLinks(d.added, 'index')}`);
    if (d.removed.length > 0) parts.push(`removed ${suffixLinks(d.removed, 'index')}`);
    let currency = '';
    const latestLm = d.lastModified.map(b => b.value).sort().at(-1);
    if (latestLm !== undefined) {
      currency = ` The list's own last-modified dates top out at <b>${escapeHtml(latestLm)}</b>, so its currency predates the ${escapeHtml(humanVintage(d.vintage))} publication (declared, not verified).`;
    }
    headline.push(`<p>The <b>${escapeHtml(humanVintage(d.vintage))}</b> disclosure is the first to differ: ${parts.join('; ')} → <b>${num(d.distinctCount)}</b> suffixes.${currency}</p>`);
  }

  const fkRows = firstKnownDistribution(h).map(b =>
    `<tr><td>${escapeHtml(b.dateKey)}</td><td>${num(b.suffixes.length)}</td><td>${b.suffixes.length <= ENUMERATE_LIMIT ? suffixLinks(b.suffixes, 'index') : `<span class="gap">${num(b.suffixes.length)} suffixes — not enumerated; browse them below</span>`}</td></tr>`);

  const body = [
    '<h1>Forbidden-suffix lists</h1>',
    `<p>The ${glossaryTerm('forbidden-suffix', 1, { label: 'forbidden-suffix' })} list is the set of three-letter callsign ${glossaryTerm('suffix', 1, { label: 'suffixes' })} Ofcom withholds from issue. This section tracks it as a first-class dataset, across every disclosure the mirror holds — built from the committed FOI <code>forbidden-list</code> entries, so a change in the data is a visible drift signal. Every figure below is <b>declared, not verified</b>; the absence of a suffix from a disclosure is not evidence that it may be issued.</p>`,
    '<p>The disallowed vocabulary is <b>not static</b>, and both invariance and drift are findings: it is unchanged from 2016 to 2019, then differs by the December 2024 disclosure.</p>',

    '<h2>Disclosures timeline</h2>',
    '<p>One row per forbidden-list disclosure, oldest first — each links to its own page. <b>Distinct</b> is the suffix vocabulary; <b>rows</b> exceeds it only where the source duplicated a row (surfaced, never silently deduplicated). <b>Added / removed</b> are the set difference against the previous disclosure.</p>',
    '<table>',
    tableCaption('Forbidden-suffix disclosures over time, oldest first'),
    '<tr><th scope="col">disclosure</th><th scope="col">distinct</th><th scope="col">rows</th><th scope="col">duplicated</th><th scope="col">added</th><th scope="col">removed</th></tr>',
    ...timelineRows,
    '</table>',

    '<h2>Headline changes</h2>',
    ...headline,

    '<h2>Ever-forbidden union</h2>',
    `<p>Across every disclosure held, <b>${num(h.everForbiddenUnion.length)}</b> distinct suffixes have been forbidden at some point. This union — not any single list — is the intended basis for the row-level <code>forbidden-suffix</code> flag: flagging against "ever forbidden" is robust to churn and to suspected omission errors. A suffix on the 2016/2019 lists but absent from 2024 (the working theory is that the <code>QNF</code>/<code>ZFJ</code> de-listing is an artefact, not a deliberate policy change) stays in the union, and so stays flagged.</p>`,
    '<h3>First known forbidden — distribution</h3>',
    '<p>For every suffix in the union, the earliest disclosure or <code>LastModifiedDate</code> at which it is known to have been forbidden, bucketed by date. The shape (an origin bulk plus a couple of later points) is the finding.</p>',
    '<table>',
    tableCaption('When each union suffix was first known to be forbidden'),
    '<tr><th scope="col">first known forbidden</th><th scope="col">suffixes</th><th scope="col">which</th></tr>',
    ...fkRows,
    '</table>',

    '<h2>Per-suffix detail</h2>',
    `<p>Every ever-forbidden union suffix has its own detail page: its forbidden-list history (which disclosures list it, first known forbidden, whether it was de-listed) plus every callsign carrying it, <b>broken down by ${glossaryTerm('status-values', 1, { label: 'status' })}</b> (Allocated / Reserved / Available / Forbidden), cross-linked to the register lookup and the FOI observations. A count is never bare: a rise could be a spike in <em>Reserved</em> rows, or a batch of <em>Forbidden</em> prohibition rows, rather than new <em>Allocated</em> issuance — a very different meaning.</p>`,
  ];

  // The surprise worth surfacing on the index: forbidden suffixes that
  // nonetheless carry Allocated (issued / in-use) callsigns. Status breakdown,
  // not a bare total — the whole point.
  const withAllocated = h.everForbiddenUnion
    .map(suffix => ({ suffix, info: index.get(suffix) }))
    .filter((x): x is { suffix: string; info: SuffixCallsignInfo } => x.info !== undefined)
    .map(x => ({ suffix: x.suffix, allocated: x.info.byStatus.find(b => b.status === 'Allocated')?.count ?? 0 }))
    .filter(x => x.allocated > 0)
    .sort((a, b) => b.allocated - a.allocated || a.suffix.localeCompare(b.suffix));
  if (withAllocated.length > 0) {
    body.push('<h3>Forbidden, yet carrying Allocated callsigns</h3>');
    body.push(`<p>${num(withAllocated.length)} union suffixes carry at least one <b>Allocated</b> callsign somewhere in the corpus — most predating the withholding, a few (notably <a href="${suffixHref('QNF', 'index')}"><code>QNF</code></a>) issued <em>after</em> the suffix was de-listed. Declared, not verified.</p>`);
    body.push('<table>');
    body.push(tableCaption('Forbidden suffixes that nonetheless carry Allocated callsigns'));
    body.push('<tr><th scope="col">suffix</th><th scope="col">Allocated callsigns</th></tr>');
    for (const x of withAllocated.slice(0, 40)) {
      body.push(`<tr><td><a href="${suffixHref(x.suffix, 'index')}"><code>${escapeHtml(x.suffix)}</code></a></td><td>${num(x.allocated)}</td></tr>`);
    }
    body.push('</table>');
    if (withAllocated.length > 40) body.push(`<p class="dcap">Showing the 40 with the most Allocated callsigns; the rest are reachable from the A–Z list below.</p>`);
  }

  body.push('<h3>Browse every forbidden suffix (A–Z)</h3>');
  body.push('<p>Each links to its per-suffix detail page. A suffix with no callsign in any snapshot the mirror holds is itself informative — withheld, and so far as the mirror can see, unused.</p>');
  body.push(...browseAllSuffixes(h));

  return htmlPage('Forbidden-suffix lists', 1, body, { currentNav: 'Forbidden suffixes', sourcePath: 'archive/foi' });
}

// ---- Per-suffix detail pages (phase 3) ----

// A YYYY-MM month key for chronological comparison; '' when the value is not a
// dated string (asserts nothing, so it can never satisfy an "after" test).
function monthOf(value: string): string {
  const m = value.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(m) ? m : '';
}

interface SuffixAnalysis {
  // Per disclosure, whether this suffix is on that list — the presence trail.
  presence: { disclosure: ForbiddenDisclosure; present: boolean }[];
  // Present on the most recent disclosure held.
  currentlyListed: boolean;
  // The disclosure that removed the suffix (if it was de-listed and not
  // re-added), else undefined.
  delisting: ForbiddenDisclosure | undefined;
  // Allocated callsigns whose original-start month is strictly after the
  // de-listing disclosure's vintage — the "de-listed, then issued" arc.
  issuedAfterDelisting: SuffixCallsign[];
}

function analyseSuffix(suffix: string, h: ForbiddenSuffixHistory, info: SuffixCallsignInfo): SuffixAnalysis {
  const presence = h.disclosures.map(d => ({ disclosure: d, present: d.distinctSuffixes.includes(suffix) }));
  const latest = h.disclosures[h.disclosures.length - 1];
  const currentlyListed = latest !== undefined && latest.distinctSuffixes.includes(suffix);
  // The de-listing event: the last disclosure whose `removed` set carries this
  // suffix and which was not followed by a re-addition (i.e. it is still off
  // the list now).
  let delisting: ForbiddenDisclosure | undefined;
  if (!currentlyListed) {
    for (const d of h.disclosures) if (d.removed.includes(suffix)) delisting = d;
  }
  const delistMonth = delisting !== undefined ? monthOf(delisting.vintage) : '';
  const issuedAfterDelisting = delistMonth === ''
    ? []
    : info.callsigns.filter(c => c.latestStatus === 'Allocated' && monthOf(c.startDate) !== '' && monthOf(c.startDate) > delistMonth);
  return { presence, currentlyListed, delisting, issuedAfterDelisting };
}

// The forbidden-list history for one suffix: which disclosures list it, first
// known forbidden, and the de-listing (with the currency caveat). Each
// disclosure links back to its own page.
function suffixHistorySection(suffix: string, h: ForbiddenSuffixHistory, a: SuffixAnalysis): string {
  const fk = h.firstKnownForbidden[suffix];
  const rows = a.presence.map(({ disclosure, present }) =>
    `<tr><td><a href="../../${escapeHtml(disclosure.entry)}/index.html">${escapeHtml(humanVintage(disclosure.vintage))}</a></td><td>${present ? 'on the list' : '<span class="gap">absent</span>'}</td></tr>`);
  const statusLine = a.currentlyListed
    ? `Still withheld as of the most recent disclosure held (${escapeHtml(humanVintage(h.disclosures[h.disclosures.length - 1].vintage))}).`
    : a.delisting !== undefined
      ? `<b>De-listed</b> by the ${escapeHtml(humanVintage(a.delisting.vintage))} disclosure — it appears on earlier lists but not this one. The working theory is that such removals may be export artefacts rather than a deliberate policy change, so the ever-forbidden union keeps the suffix flagged. Declared, not verified.`
      : 'Not on the most recent disclosure held.';
  return [
    '<section><h2>Forbidden-list history</h2>',
    `<p class="lead">First known forbidden <b>${escapeHtml(fk.displayValue)}</b> <span class="gap">(${escapeHtml(fk.basis)})</span>. ${statusLine}</p>`,
    '<table>',
    tableCaption(`Which disclosures list the ${suffix} suffix`),
    '<tr><th scope="col">disclosure</th><th scope="col">this suffix</th></tr>',
    ...rows,
    '</table>',
    '</section>',
  ].join('\n');
}

// The de-listed-then-issued arc callout (the QNF payoff): forbidden → de-listed
// → then issued, with the callsigns and their post-de-listing dates named, and
// framed as a reconciliation candidate.
function arcCallout(suffix: string, a: SuffixAnalysis, ref: ReferenceData): string {
  if (a.delisting === undefined || a.issuedAfterDelisting.length === 0) return '';
  const n = a.issuedAfterDelisting.length;
  // The shared callsign pill (issue #310), so a callsign in this prose callout
  // reads and behaves exactly as it does in the section's tables — its
  // supplementary title built from the same parser used everywhere.
  const cs = a.issuedAfterDelisting
    .map(c => {
      const comp = parseCallsign(c.callsign, '', ref);
      const pill = callsignPill(c.callsign, SUFFIX_PAGE_DEPTH, {
        prefixSeries: comp.prefixSeries,
        rsl: comp.rsl,
        suffix: comp.suffix,
        licenceClass: comp.impliedClass,
      });
      return `${pill} (original start ${escapeHtml(humanDate(c.startDate))})`;
    })
    .join(', ');
  const carryPhrase = n === 1 ? 'this callsign also carries' : 'these callsigns also carry';
  return noticeStrip(true,
    `<b>Forbidden, then de-listed, then issued.</b> <code>${escapeHtml(suffix)}</code> was withheld on the earlier lists, removed by the ${escapeHtml(humanVintage(a.delisting.vintage))} disclosure (whose currency predates its publication), yet ${cs} ${n === 1 ? 'is' : 'are'} now Allocated — issued <em>after</em> the de-listing. The row-level <code>forbidden-suffix</code> flag still fires because the suffix is on the ever-forbidden union — every suffix ever on any held disclosure — so a de-listing (suspected to be an artefact) does not un-flag it; and, being issued after the suffix's first-known-forbidden date, ${carryPhrase} <code>forbidden-suffix-issued-after-first-known-list</code>. A reconciliation candidate: possibly the de-listing was an error, or the issuance was. Declared, not verified.`);
}

// The callsigns section: the status breakdown (never a bare total) followed by
// the per-callsign table, cross-linked to the register lookup, and the FOI
// witnesses. A suffix with no callsign says so.
// The per-suffix pages sit at depth 3 (forbidden/suffix/{SUFFIX}/), so the
// shared callsign pill's register-lookup link resolves three levels up.
const SUFFIX_PAGE_DEPTH = 3;

function suffixCallsignsSection(info: SuffixCallsignInfo, ref: ReferenceData): string {
  if (info.total === 0) {
    return [
      '<section><h2>Callsigns carrying this suffix</h2>',
      '<p class="lead">No callsign carries this suffix in any snapshot the mirror holds — withheld, and so far as the mirror can see, unused. Absence is not evidence it may be issued; it is simply not witnessed here.</p>',
      '</section>',
    ].join('\n');
  }
  const breakdown: [string, number][] = info.byStatus.map(b => [b.status, b.count]);
  // The shared status field wrapper (#553), pinned to 'plain' (drift-guard):
  // this per-callsign table can list hundreds of rows, each repeating one of
  // a handful of status values - a glossary link (and its "(definition of …
  // in the glossary)" accessible text) on every single one would be noise,
  // not help. The countTable-style breakdown BELOW (a bounded list of
  // distinct values) uses the default linked treatment instead.
  const rows = info.callsigns.map(c => {
    const distinctStatuses = [...new Set(c.observations.map(o => o.status))];
    const earliest = c.observations[0].status;
    const wasNote = distinctStatuses.length > 1 && earliest !== c.latestStatus
      ? ` <small class="gap">(was ${statusField(earliest, { glossaryLinking: 'plain' })})</small>`
      : '';
    const openData = new Set(c.observations.filter(o => o.lane === 'open-data').map(o => o.source)).size;
    const foi = new Set(c.observations.filter(o => o.lane === 'foi').map(o => o.source)).size;
    const seenParts: string[] = [];
    if (openData > 0) seenParts.push(`${openData} open-data`);
    if (foi > 0) seenParts.push(`${foi} FOI`);
    const statusCell = `${statusField(c.latestStatus, { glossaryLinking: 'plain' })}${wasNote}`;
    const startCell = c.startDate === '' ? '<span class="gap">—</span>' : escapeHtml(humanDate(c.startDate));
    const regCell = c.inCurrentRegister ? '✓' : '<span class="gap">—</span>';
    // The shared callsign pill: accessible name is the bare callsign, with a
    // supplementary title built from the components the same parser derives
    // everywhere (prefix series · suffix · implied class), degrading to the
    // callsign alone for anything unparseable (e.g. a visitor Mx/ form).
    const comp = parseCallsign(c.callsign, '', ref);
    const pill = callsignPill(c.callsign, SUFFIX_PAGE_DEPTH, {
      prefixSeries: comp.prefixSeries,
      rsl: comp.rsl,
      suffix: comp.suffix,
      licenceClass: comp.impliedClass,
    });
    return `<tr><td>${pill}</td><td>${statusCell}</td><td>${startCell}</td><td>${regCell}</td><td>${escapeHtml(seenParts.join(' · '))}</td></tr>`;
  });
  // The distinct FOI entries witnessing any of these callsigns, cross-linked.
  const foiEntries = [...new Set(info.callsigns.flatMap(c => c.observations.filter(o => o.lane === 'foi').map(o => o.source)))].sort();
  const foiLinks = foiEntries
    .map(e => `<a href="../../../datasets/foi/${encodeURIComponent(e)}/index.html"><code>${escapeHtml(e)}</code></a>`)
    .join(', ');
  const foiNote = foiEntries.length > 0
    ? `<p class="dcap">FOI observations witnessing these callsigns: ${foiLinks}.</p>`
    : '';
  return [
    '<section><h2>Callsigns carrying this suffix</h2>',
    `<p class="lead">${num(info.total)} distinct callsign${info.total === 1 ? '' : 's'} witnessed carrying this suffix across the corpus, <b>broken down by latest-known ${glossaryTerm('status-values', 3, { label: 'status' })}</b> — never a bare total, since Allocated (issued), Reserved, Available and Forbidden (the prohibition itself, expressed as a callsign row) mean very different things. Each of these records carries the row-level <code>forbidden-suffix</code> data-quality flag — an observation locating the suffix on the ever-forbidden union, not a verdict about the callsign or its holder · ${fidelityNudge(3, { section: flagAnchor('forbidden-suffix'), label: 'about this flag', about: 'about the forbidden-suffix data-quality flag' })}.</p>`,
    '<div class="bd"><h3>By latest-known status</h3>',
    // A bounded list of distinct status values (unlike the per-callsign rows
    // above), so the shared wrapper's default 'linked' treatment applies.
    breakdownRows(breakdown, info.total, undefined, undefined, status => statusField(status, { depthToRoot: SUFFIX_PAGE_DEPTH })),
    '</div>',
    '<table>',
    tableCaption('Every callsign witnessed carrying this suffix'),
    '<tr><th scope="col">callsign</th><th scope="col">latest status</th><th scope="col">original start</th><th scope="col">in current register</th><th scope="col">witnessed in</th></tr>',
    ...rows,
    '</table>',
    '<p class="dcap">Each callsign opens the register lookup (<code>?c=</code>) for its full recorded history. A status shown as "(was …)" changed across snapshots — for example Forbidden in an early register export, Allocated later.</p>',
    foiNote,
    '</section>',
  ].join('\n');
}

// The At-a-glance sidebar for a suffix: the headline callsign total, the status
// breakdown, whether it is currently listed, and first known forbidden.
function suffixAtAGlance(suffix: string, h: ForbiddenSuffixHistory, info: SuffixCallsignInfo, a: SuffixAnalysis): string {
  const fk = h.firstKnownForbidden[suffix];
  const breakdown: [string, number][] = info.byStatus.map(b => [b.status, b.count]);
  const statusBar = breakdownRows(breakdown, info.total, undefined, undefined, status => statusField(status, { depthToRoot: SUFFIX_PAGE_DEPTH }));
  const statusBlock = info.total === 0
    ? '<div class="bd"><h3>By status</h3><div class="brow"><span class="lab gap">no callsigns witnessed</span></div></div>'
    : '<div class="bd"><h3>By latest-known status</h3>' + statusBar + '</div>';
  return [
    '<section><h2>At a glance</h2>',
    `<div class="headline">${num(info.total)} <small>callsign${info.total === 1 ? '' : 's'}</small></div>`,
    statusBlock,
    '<div class="attr">',
    `<div><b>On the list now?</b> · ${a.currentlyListed ? 'yes' : (a.delisting !== undefined ? `de-listed ${escapeHtml(humanVintage(a.delisting.vintage))}` : 'no')}</div>`,
    `<div><b>First known forbidden</b> · ${escapeHtml(fk.displayValue)}</div>`,
    `<div>Ever-forbidden union member · <code>${escapeHtml(suffix)}</code></div>`,
    '</div>',
    '</section>',
  ].join('\n');
}

// One per-suffix detail page at forbidden/suffix/{SUFFIX}/ (depth 3), reusing
// the entry-page card shell so it matches the disclosure and dataset pages.
// Exported so the no-callsign branch can be exercised directly in tests (no
// real union suffix is callsign-free).
export function suffixPage(
  suffix: string,
  h: ForbiddenSuffixHistory,
  info: SuffixCallsignInfo,
  ref: ReferenceData = loadReferenceData(),
  pageUrl: string = `${DEFAULT_BASE_URL}/forbidden/suffix/${encodeURIComponent(suffix)}/index.html`,
): string {
  const a = analyseSuffix(suffix, h, info);
  const title = `Forbidden suffix ${suffix}`;
  // The report-this invite (issue #439): pre-filled with this exact suffix so a
  // report about a callsign or the withholding shown here is located to its hop.
  const reportSection = [
    '<section class="report-invite">',
    '<h2>See something worth a closer look?</h2>',
    reportAffordance(
      { surface: 'a forbidden-suffix page', subject: `the withheld suffix ${suffix}`, pageUrl },
      3,
      { label: 'Report or examine this suffix' },
    ),
    '</section>',
  ].join('\n');
  const body = [
    breadcrumbHtml([['Forbidden suffixes', '../../index.html'], [suffix, undefined]]),
    `<h1>Forbidden suffix <code>${escapeHtml(suffix)}</code></h1>`,
    `<p class="subtitle">A three-letter callsign ${glossaryTerm('suffix', 3, { label: 'suffix' })} on the ever-forbidden union — a ${glossaryTerm('forbidden-suffix', 3, { label: 'forbidden suffix' })} withheld from issue in at least one disclosure the mirror holds. Every figure is <b>declared, not verified</b>.</p>`,
    noticeStrip(false, 'Freedom-of-Information + open-data derived — point-in-time snapshots, not a live feed. Absence of a callsign is not evidence a suffix may be issued.'),
    arcCallout(suffix, a, ref),
    '<div class="main-region">',
    '<div class="col">',
    suffixHistorySection(suffix, h, a),
    suffixCallsignsSection(info, ref),
    reportSection,
    '</div>',
    `<div class="side">${suffixAtAGlance(suffix, h, info, a)}</div>`,
    '</div>',
  ];
  return entryPage(title, body, { currentNav: 'Forbidden suffixes', sourcePath: 'archive/foi' }, 3);
}

// Build the whole section under {outputDir}/forbidden/. Returns the page URLs
// for the caller's sitemap. Deterministic for unchanged inputs (no
// timestamps), like the rest of the dataset-pages build. The suffix -> callsigns
// index is built ONCE and shared across the index page and every per-suffix
// page — never re-scanned per page.
export function buildForbiddenSection(outputDir: string, baseUrl: string = DEFAULT_BASE_URL): string[] {
  const history = buildForbiddenSuffixHistory(FOI_DIR);
  const suffixIndex = buildSuffixCallsignIndex(history.everForbiddenUnion);
  // Loaded once and passed to every per-suffix page so the callsign pills'
  // component titles are derived without re-reading the reference data per page.
  const ref = loadReferenceData();
  const dir = path.join(outputDir, 'forbidden');
  fs.mkdirSync(dir, { recursive: true });
  const urls: string[] = [];

  fs.writeFileSync(path.join(dir, 'index.html'), indexPage(history, suffixIndex));
  urls.push(`${baseUrl}/forbidden/index.html`);

  history.disclosures.forEach((d, i) => {
    const prev = i > 0 ? history.disclosures[i - 1] : undefined;
    const entryDir = path.join(dir, d.entry);
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(path.join(entryDir, 'index.html'), disclosurePage(d, prev, history.disclosures));
    urls.push(`${baseUrl}/forbidden/${d.entry}/index.html`);
  });

  const suffixDir = path.join(dir, 'suffix');
  fs.mkdirSync(suffixDir, { recursive: true });
  for (const suffix of history.everForbiddenUnion) {
    const info = suffixIndex.get(suffix);
    if (info === undefined) continue;
    const pageDir = path.join(suffixDir, suffix);
    fs.mkdirSync(pageDir, { recursive: true });
    const pageUrl = `${baseUrl}/forbidden/suffix/${encodeURIComponent(suffix)}/index.html`;
    fs.writeFileSync(path.join(pageDir, 'index.html'), suffixPage(suffix, history, info, ref, pageUrl));
    urls.push(pageUrl);
  }

  return urls;
}

function main(): void {
  const [outputDir, baseUrl] = process.argv.slice(2).filter(a => a.trim().length > 0);
  if (!outputDir) {
    console.error('usage: node src/ci/build-forbidden-section.ts <output-dir> [base-url]');
    process.exitCode = 1;
    return;
  }
  const urls = buildForbiddenSection(outputDir, baseUrl);
  console.log(`forbidden-suffix section: ${urls.length} pages`);
}

if (import.meta.main) {
  main();
}
