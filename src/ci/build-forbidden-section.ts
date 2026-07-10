#!/usr/bin/env node

/**
 * Builds the forbidden-suffix site section (issue #291 phase 2): a discrete,
 * STATIC, Wayback-crawlable section for the forbidden-suffix lists, mirroring
 * the dataset/FOI entry-page information architecture. A section index plus one
 * page per forbidden-list disclosure.
 *
 * Reuses the committed phase-1 data foundation (buildForbiddenSuffixHistory in
 * src/ci/forbidden-suffix-history.ts): it does NOT re-parse the archive or the
 * generated golden-master .md. Every figure traces back through that layer to
 * the committed FOI `forbidden-list` entries. Shared render helpers (nav,
 * breadcrumb, entry-page shell, download slots, breakdown bars, the a11y
 * skip-link / <main> pattern, the shared design tokens) are imported from
 * build-dataset-pages.ts, so the section reads as one product with the site.
 *
 * Boundaries (phase 2, deliberately): STATIC only — no interactive filtering,
 * SQL, or live browser (that is phase 3b), so the core content renders with no
 * JavaScript. No per-suffix detail pages and no clickable notable-change
 * drill-downs (phase 3): changed suffixes are named as text, never linked to
 * pages that do not exist yet.
 *
 * Phase-3 note (also stated in the page copy): when per-suffix pages attach
 * callsign counts, those counts MUST decompose by status (Allocated /
 * Reserved / Available), never a bare total — a rise in matches could be a
 * Reserved spike rather than new issuance, a very different meaning.
 *
 * Everything here is DECLARED, not verified; absence of a suffix from a
 * disclosure is not evidence it may be issued.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  buildForbiddenSuffixHistory,
  type ForbiddenDisclosure,
  type ForbiddenSuffixHistory,
} from './forbidden-suffix-history.ts';
import { readFoiEntryMeta, type FoiEntryMeta } from '../shared/foi-archive.ts';
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
} from './build-dataset-pages.ts';

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

// Suffixes as inline <code> spans — never linked in phase 2 (per-suffix pages
// are phase 3, so a link here would be a dead link).
function suffixCodes(suffixes: string[]): string {
  return suffixes.length === 0 ? '—' : suffixes.map(s => `<code>${escapeHtml(s)}</code>`).join(', ');
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
    if (d.added.length > 0) parts.push(`added ${suffixCodes(d.added)}`);
    if (d.removed.length > 0) parts.push(`removed ${suffixCodes(d.removed)}`);
    items.push(`<li><b>vs ${escapeHtml(humanVintage(prev.vintage))}:</b> ${parts.join('; ')} → ${num(d.distinctCount)} suffixes.</li>`);
    if (d.removed.length > 0) {
      items.push(`<li class="rel"><b>The de-listing is the standout.</b> A removal means a previously-withheld suffix could now be issued — the notable direction. The working theory is that such removals (here ${suffixCodes(d.removed)}) may be export artefacts rather than a deliberate policy change, so the ever-forbidden union keeps them flagged. Declared, not verified.</li>`);
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
    `<p class="lead">${num(d.distinctCount)} distinct three-letter suffixes withheld from issue in this disclosure. A callsign already carrying one predates the withholding — see the <a href="../index.html">ever-forbidden note</a> on the section index.</p>`,
    `<p>${suffixCodes(preview)}${more > 0 ? ` … <span class="gap">and ${num(more)} more — download the full list below</span>` : ''}</p>`,
    '<p class="dcap">Per-suffix detail pages (phase 3) will list every callsign carrying a suffix, broken down by status (Allocated / Reserved / Available) — never a bare total, since a rise could be a Reserved spike rather than new issuance.</p>',
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
function indexPage(h: ForbiddenSuffixHistory): string {
  const timelineRows = h.disclosures.map(d =>
    `<tr><td><a href="${escapeHtml(d.entry)}/index.html">${escapeHtml(humanVintage(d.vintage))}</a><br><code>${escapeHtml(d.entry)}</code></td><td>${num(d.distinctCount)}</td><td>${num(d.rowCount)}</td><td>${suffixCodes(d.duplicates)}</td><td>${suffixCodes(d.added)}</td><td>${suffixCodes(d.removed)}</td></tr>`);

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
    if (d.added.length > 0) parts.push(`added ${suffixCodes(d.added)}`);
    if (d.removed.length > 0) parts.push(`removed ${suffixCodes(d.removed)}`);
    let currency = '';
    const latestLm = d.lastModified.map(b => b.value).sort().at(-1);
    if (latestLm !== undefined) {
      currency = ` The list's own last-modified dates top out at <b>${escapeHtml(latestLm)}</b>, so its currency predates the ${escapeHtml(humanVintage(d.vintage))} publication (declared, not verified).`;
    }
    headline.push(`<p>The <b>${escapeHtml(humanVintage(d.vintage))}</b> disclosure is the first to differ: ${parts.join('; ')} → <b>${num(d.distinctCount)}</b> suffixes.${currency}</p>`);
  }

  const fkRows = firstKnownDistribution(h).map(b =>
    `<tr><td>${escapeHtml(b.dateKey)}</td><td>${num(b.suffixes.length)}</td><td>${b.suffixes.length <= ENUMERATE_LIMIT ? suffixCodes(b.suffixes) : `<span class="gap">${num(b.suffixes.length)} suffixes — not enumerated</span>`}</td></tr>`);

  const body = [
    '<h1>Forbidden-suffix lists</h1>',
    '<p>The forbidden-suffix list is the set of three-letter callsign suffixes Ofcom withholds from issue. This section tracks it as a first-class dataset, across every disclosure the mirror holds — built from the committed FOI <code>forbidden-list</code> entries, so a change in the data is a visible drift signal. Every figure below is <b>declared, not verified</b>; the absence of a suffix from a disclosure is not evidence that it may be issued.</p>',
    '<p>The disallowed vocabulary is <b>not static</b>, and both invariance and drift are findings: it is unchanged from 2016 to 2019, then differs by the December 2024 disclosure.</p>',

    '<h2>Disclosures timeline</h2>',
    '<p>One row per forbidden-list disclosure, oldest first — each links to its own page. <b>Distinct</b> is the suffix vocabulary; <b>rows</b> exceeds it only where the source duplicated a row (surfaced, never silently deduplicated). <b>Added / removed</b> are the set difference against the previous disclosure.</p>',
    '<table>',
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
    '<tr><th scope="col">first known forbidden</th><th scope="col">suffixes</th><th scope="col">which</th></tr>',
    ...fkRows,
    '</table>',

    '<h2>Per-suffix detail (phase 3)</h2>',
    '<p>Per-suffix pages — each suffix’s list history plus every callsign carrying it — are a later phase and are not yet built, so no links to them appear here. When they arrive, every per-suffix callsign count will decompose by status (Allocated / Reserved / Available), never a bare total: a rise in matches could be a spike in <em>Reserved</em> rows rather than new <em>Allocated</em> issuance, a very different meaning.</p>',
  ];
  return htmlPage('Forbidden-suffix lists', 1, body, { currentNav: 'Forbidden suffixes', sourcePath: 'archive/foi' });
}

// Build the whole section under {outputDir}/forbidden/. Returns the page URLs
// for the caller's sitemap. Deterministic for unchanged inputs (no
// timestamps), like the rest of the dataset-pages build.
export function buildForbiddenSection(outputDir: string, baseUrl: string = DEFAULT_BASE_URL): string[] {
  const history = buildForbiddenSuffixHistory(FOI_DIR);
  const dir = path.join(outputDir, 'forbidden');
  fs.mkdirSync(dir, { recursive: true });
  const urls: string[] = [];

  fs.writeFileSync(path.join(dir, 'index.html'), indexPage(history));
  urls.push(`${baseUrl}/forbidden/index.html`);

  history.disclosures.forEach((d, i) => {
    const prev = i > 0 ? history.disclosures[i - 1] : undefined;
    const entryDir = path.join(dir, d.entry);
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(path.join(entryDir, 'index.html'), disclosurePage(d, prev, history.disclosures));
    urls.push(`${baseUrl}/forbidden/${d.entry}/index.html`);
  });

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
