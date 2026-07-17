#!/usr/bin/env node

/**
 * Builds the inter-dataset statistics page (issue #177, Surface 2): a discrete,
 * STATIC, Wayback-crawlable view of statistics ACROSS the archived open-data
 * publications — distinct from the latest-publication statistics page (Surface
 * 1, site/statistics.html), which describes one publication. This page answers
 * the different question: what changes from one publication to the next?
 *
 * Every figure derives from each publication's committed stats.json (counts,
 * column emptiness, callsign-pattern taxonomy, data-quality flags) and meta.json
 * (declared coverage, source column names, hand-curated quality observations) —
 * no re-parse of the multi-hundred-thousand-row CSVs. The callsign-pattern
 * appearance/disappearance section reuses compareStats from shared/stats.ts
 * rather than reinventing the new/lost-pattern set difference.
 *
 * The lead statistic is the blank-product join: the product-column empty count
 * per publication identifies the one intended-complete publication that
 * silently filtered out every blank-product record (~45,000, many of them live
 * allocations). That quality observation and the timeline fix already shipped
 * (issue #190); this page reproduces the figures from the data and narrates the
 * finding in cross-publication context.
 *
 * Boundaries (deliberately): STATIC only — no scripts, no interactive filtering
 * or SQL (that is the interactive /compare surface, issue #199, which this page
 * cross-links rather than duplicates). Distributions and breakdowns, never bare
 * totals. Everything is DECLARED, not verified; a declared-partial publication's
 * zero is flagged (⚠) so it reads as "incomplete", not "no blanks", and the
 * absence of a record from a partial publication is not evidence of anything.
 *
 * Wired into buildDatasetPages like the series/reports/forbidden/class sections
 * (one generator, one call), so no cicd.yaml change is needed. Deterministic for
 * unchanged inputs (no timestamps), so re-crawls only see changes when the data
 * changed.
 *
 * Usage: node src/ci/build-interdataset-stats.ts <output-dir> [base-url]
 */

import * as fs from 'fs';
import * as path from 'path';
import { listArchiveKeys } from '../shared/archive.ts';
import { derivedEntryFile } from '../shared/derived-entries.ts';
import { CONSTANTS } from '../shared/utils.ts';
import { compareStats, type EntryStats } from '../shared/stats.ts';
import { escapeHtml, humanDate, entryPage, noticeStrip, tableCaption } from './site-render.ts';

const DEFAULT_BASE_URL = 'https://mysteraitch.github.io/amateur-callsigns-file-watch';

// This page sits one level below the site root (statistics/inter-dataset.html),
// so links to root-level pages and the dataset tree are prefixed accordingly.
const ROOT = '../';

// How many changed callsign patterns to name per transition before "+N more";
// the point is the shape of the drift, not an exhaustive dump.
const PATTERN_ENUMERATE_LIMIT = 12;

function num(n: number): string {
  return n.toLocaleString('en-GB');
}

// A signed delta against a reference, with a percentage — "+1,234 (+0.8%)".
// "no change" when identical; the reference-is-zero case drops the percentage.
function signedDelta(value: number, reference: number): string {
  const d = value - reference;
  if (d === 0) return 'no change';
  const sign = d > 0 ? '+' : '−';
  const pct = reference > 0 ? ` (${sign}${Math.abs((d / reference) * 100).toFixed(1)}%)` : '';
  return `${sign}${num(Math.abs(d))}${pct}`;
}

interface ColumnEmptiness {
  distinct: number;
  empty: number;
}

// Everything one publication contributes to a cross-publication view, read
// once from its committed derivatives. blankProduct is undefined when the
// source publication carried no product column at all (a different fact from
// "a product column with zero blanks").
interface PubStat {
  key: string;
  declaredComplete: boolean | undefined;
  partial: boolean;
  hasProductColumn: boolean;
  recordCount: number;
  blankProduct: number | undefined;
  product: ColumnEmptiness;
  status: ColumnEmptiness;
  type: ColumnEmptiness;
  flags: Record<string, number>;
  stats: EntryStats;
  qualityObservations: { statement: string; evidence: string; coverageAffecting?: boolean }[];
}

interface PubMeta {
  intendedCoverage?: { complete: boolean };
  files?: Record<string, { columnNames?: string[] }>;
  qualityObservations?: { statement: string; evidence: string; coverageAffecting?: boolean }[];
}

function columnEmptiness(stats: EntryStats, column: string): ColumnEmptiness {
  const c = stats.columns[column];
  return c === undefined ? { distinct: 0, empty: 0 } : { distinct: c.distinct, empty: c.empty };
}

function readPub(key: string): PubStat {
  const dir = path.join(CONSTANTS.DIRS.archive, key);
  // stats.json is a derived file (mode-resolved: archive or projection);
  // meta.json is curated and always read from the committed archive.
  const stats = JSON.parse(fs.readFileSync(derivedEntryFile(key, 'stats.json'), 'utf8')) as EntryStats;
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) as PubMeta;
  // "No product column" is a property of the SOURCE, not of the normalised
  // derivative (whose canonical schema always carries a product column, blank
  // where the source omitted it). Read it from the raw file's own header.
  const rawColumns = meta.files?.['raw.csv']?.columnNames ?? [];
  const hasProductColumn = rawColumns.some(c => /product/i.test(c));
  const product = columnEmptiness(stats, 'product');
  return {
    key,
    declaredComplete: meta.intendedCoverage?.complete,
    partial: meta.intendedCoverage?.complete === false,
    hasProductColumn,
    recordCount: stats.recordCount,
    blankProduct: hasProductColumn ? product.empty : undefined,
    product,
    status: columnEmptiness(stats, 'status'),
    type: columnEmptiness(stats, 'type'),
    flags: stats.callsignFlags,
    stats,
    qualityObservations: meta.qualityObservations ?? [],
  };
}

// A publication's cell in a heading/row: the ISO key, with a ⚠ marker when it
// is a declared-partial export so its small figures never read as a drop.
function pubLabel(p: PubStat): string {
  return `${escapeHtml(p.key)}${p.partial ? ' <span class="marker" title="declared-partial export">⚠</span>' : ''}`;
}

function entryLink(p: PubStat): string {
  return `<a href="${ROOT}datasets/open-data/${escapeHtml(p.key)}/index.html">${escapeHtml(humanDate(p.key))}</a>`;
}

// ---- Section 1: blank-product counts across publications (the lead) ----

// The declared-complete publications that carry a product column with at least
// one blank product — the baseline against which a zero is anomalous.
function completeWithBlanks(pubs: PubStat[]): PubStat[] {
  return pubs.filter(p => p.declaredComplete === true && p.hasProductColumn && (p.blankProduct ?? 0) > 0);
}

// The filter case(s): declared complete, a product column present, yet zero
// blank products — anomalous only because sibling complete publications have
// tens of thousands. Computed, never hard-coded, so a genuinely blank-free
// complete publication in future would surface here as a fresh surprise to
// investigate rather than being silently assumed away.
function filterCases(pubs: PubStat[]): PubStat[] {
  const baseline = completeWithBlanks(pubs);
  if (baseline.length === 0) return [];
  return pubs.filter(p => p.declaredComplete === true && p.hasProductColumn && p.blankProduct === 0);
}

function blankProductSection(pubs: PubStat[]): string[] {
  const chronological = [...pubs].sort((a, b) => a.key.localeCompare(b.key));
  const cases = filterCases(pubs);

  // The narrative amber notice(s): reconstruct the arithmetic the issue cites
  // from the nearest prior complete-with-blanks publication.
  const narratives: string[] = [];
  for (const fc of cases) {
    const priors = completeWithBlanks(pubs).filter(q => q.key < fc.key).sort((a, b) => a.key.localeCompare(b.key));
    const prior = priors[priors.length - 1];
    const qo = fc.qualityObservations.find(o => o.coverageAffecting === true) ?? fc.qualityObservations[0];
    const arithmetic = prior !== undefined && prior.blankProduct !== undefined
      ? (() => {
          const expected = prior.recordCount - prior.blankProduct;
          const drift = fc.recordCount - expected;
          return ` The ${escapeHtml(humanDate(prior.key))} publication had ${num(prior.blankProduct)} blank-product records; ${num(prior.recordCount)} − ${num(prior.blankProduct)} = ${num(expected)}, within ${num(Math.abs(drift))} of the ${num(fc.recordCount)} actually published (normal weeks-of-drift). So roughly ${num(prior.blankProduct)} records — many of them live allocations — were silently omitted from an intended-complete publication.`;
        })()
      : '';
    const observed = qo !== undefined ? ` This observation is recorded on the <a href="${ROOT}datasets/open-data/${escapeHtml(fc.key)}/index.html">publication's own page</a>, and the register-history timeline no longer treats its absences as evidence (issue #190).` : '';
    narratives.push(noticeStrip(true, `<b>${escapeHtml(humanDate(fc.key))} is the blank-product-filter case.</b> It declares <b>complete</b> coverage, yet lists zero records with a blank product.${arithmetic} Declared, not verified.${observed}`));
  }

  const rows = chronological.map(p => {
    const productCell = p.blankProduct === undefined
      ? '<span class="gap">(no product column)</span>'
      : num(p.blankProduct);
    let note: string;
    if (!p.hasProductColumn) {
      note = 'the source carried no product column — blank-product filtering is not a question here';
    } else if (p.partial) {
      note = '<span class="marker">⚠</span> declared partial — a zero here means <b>incomplete</b>, not "no blanks"';
    } else if (cases.some(c => c.key === p.key)) {
      note = '<span class="marker">⚠</span> declared complete, yet every blank-product record silently omitted';
    } else {
      note = 'declared complete';
    }
    return `<tr><td>${entryLink(p)} <code>${escapeHtml(p.key)}</code></td><td class="n">${num(p.recordCount)}</td><td class="n">${productCell}</td><td>${note}</td></tr>`;
  });

  // The secondary observation the issue flags: blank-product counts among the
  // full publications, in chronological order, so the fall over time is
  // visible rather than asserted.
  const fullWithBlanks = completeWithBlanks(pubs).sort((a, b) => a.key.localeCompare(b.key));
  let secondary: string[] = [];
  if (fullWithBlanks.length >= 2) {
    const first = fullWithBlanks[0];
    const last = fullWithBlanks[fullWithBlanks.length - 1];
    const firstBlank = first.blankProduct ?? 0;
    const lastBlank = last.blankProduct ?? 0;
    secondary = [
      `<p class="dcap">Secondary observation: among the full publications that <em>do</em> carry blank-product records, the count moved from ${num(firstBlank)} (${escapeHtml(humanDate(first.key))}) to ${num(lastBlank)} (${escapeHtml(humanDate(last.key))}) — a ${signedDelta(lastBlank, firstBlank)} shift. Backfill or churn, unexplored here.</p>`,
    ];
  }

  return [
    '<section>',
    '<h2 id="blank-product">Blank-product counts across publications</h2>',
    '<p>Ofcom\'s register lists a <b>product</b> (the licensing product) against most callsigns, but leaves it blank for a large minority. Joining the per-publication blank-product count across the archive is one query with one policy-relevant discovery: the publication that declared complete coverage while silently dropping every blank-product record.</p>',
    ...narratives,
    '<table>',
    tableCaption('Blank-product record counts for every archived publication'),
    '<tr><th scope="col">publication</th><th scope="col" class="n">records</th><th scope="col" class="n">blank product</th><th scope="col">reading</th></tr>',
    ...rows,
    '</table>',
    ...secondary,
    '</section>',
  ];
}

// ---- Section 2: record count across publications ----

function recordCountSection(pubs: PubStat[]): string[] {
  const chronological = [...pubs].sort((a, b) => a.key.localeCompare(b.key));
  // Deltas compare each complete publication against the previous complete one
  // — a declared-partial truncation (1,074 rows) is not a 150k "drop", so it
  // carries no delta and is marked instead.
  let prevComplete: PubStat | undefined;
  const rows = chronological.map(p => {
    let deltaCell: string;
    if (p.partial) {
      deltaCell = '<span class="gap">— (partial export, not a change in the register)</span>';
    } else if (prevComplete === undefined) {
      deltaCell = '<span class="gap">— (baseline)</span>';
    } else {
      deltaCell = `${escapeHtml(signedDelta(p.recordCount, prevComplete.recordCount))} <span class="gap">vs ${escapeHtml(humanDate(prevComplete.key))}</span>`;
    }
    if (!p.partial) prevComplete = p;
    const declared = p.declaredComplete === undefined ? '—' : p.partial ? 'partial' : 'complete';
    return `<tr><td>${entryLink(p)} ${pubLabel(p)}</td><td>${escapeHtml(declared)}</td><td class="n">${num(p.recordCount)}</td><td>${deltaCell}</td></tr>`;
  });
  return [
    '<section>',
    '<h2 id="record-count">Record count across publications</h2>',
    '<p>Row counts over time, with each complete publication\'s change measured against the previous complete one. Declared-partial exports are shown for completeness but carry no delta — their small counts are the publisher\'s stated scope, not a register that shrank.</p>',
    '<table>',
    tableCaption('Record count for every publication, with the change against the previous complete publication'),
    '<tr><th scope="col">publication</th><th scope="col">declared</th><th scope="col" class="n">records</th><th scope="col">change vs previous complete</th></tr>',
    ...rows,
    '</table>',
    '</section>',
  ];
}

// ---- Section 3: column emptiness and vocabulary drift ----

function columnDriftSection(pubs: PubStat[]): string[] {
  const chronological = [...pubs].sort((a, b) => a.key.localeCompare(b.key));
  const cell = (c: ColumnEmptiness, present: boolean): string =>
    present ? `${num(c.distinct)} distinct · ${num(c.empty)} blank` : '<span class="gap">absent</span>';
  const rows = chronological.map(p =>
    `<tr><td>${entryLink(p)} ${pubLabel(p)}</td><td>${cell(p.product, p.hasProductColumn)}</td><td>${cell(p.status, true)}</td><td>${cell(p.type, true)}</td></tr>`);
  return [
    '<section>',
    '<h2 id="vocabulary">Column vocabulary and emptiness drift</h2>',
    `<p>For the three categorical columns, the number of distinct values and the number of blanks in each publication — a distribution, not a bare total. A distinct-count that moves is a vocabulary-drift signal (a new status or product term appearing, or one retiring); a blank-count that moves is an emptiness signal. The distinct <em>values</em> themselves, and their counts, live on the <a href="${ROOT}reports/value-catalogue.html">value catalogue</a> — this page shows the shape over time, not the vocabulary in full.</p>`,
    '<table>',
    tableCaption('Distinct values and blank counts for the product, status and type columns across publications'),
    '<tr><th scope="col">publication</th><th scope="col">product</th><th scope="col">status</th><th scope="col">type</th></tr>',
    ...rows,
    '</table>',
    '</section>',
  ];
}

// ---- Section 4: data-quality flag evolution ----

function flagEvolutionSection(pubs: PubStat[]): string[] {
  const chronological = [...pubs].sort((a, b) => a.key.localeCompare(b.key));
  const allFlags = [...new Set(chronological.flatMap(p => Object.keys(p.flags)))].sort();
  if (allFlags.length === 0) return [];
  const header = ['<tr><th scope="col">flag</th>', ...chronological.map(p => `<th scope="col" class="n">${pubLabel(p)}</th>`), '</tr>'].join('');
  const rows = allFlags.map(flag => {
    const cells = chronological.map(p => {
      const n = p.flags[flag];
      // A flag ABSENT from a publication (no such key) is distinct from a flag
      // present with a zero count; the former reads as "not measured / none",
      // shown as an em dash so it never reads as a hard zero.
      return `<td class="n">${n === undefined ? '<span class="gap">—</span>' : num(n)}</td>`;
    });
    return `<tr><td><a href="${ROOT}datasets/docs/flags.html"><code>${escapeHtml(flag)}</code></a></td>${cells.join('')}</tr>`;
  });
  return [
    '<section>',
    '<h2 id="flags">Data-quality flag evolution</h2>',
    `<p>How many rows trip each anomaly detector in each publication (flag meanings in the <a href="${ROOT}datasets/docs/flags.html">flag registry</a>). A flag that appears or disappears between publications, or whose count jumps, is a drift signal worth a look — declared-partial columns (⚠) tally over a tiny scope, so read their figures as of that scope, not the register.</p>`,
    '<table>',
    tableCaption('Data-quality flag counts for every archived publication'),
    header,
    ...rows,
    '</table>',
    '</section>',
  ];
}

// ---- Section 5: callsign-pattern appearance / disappearance ----

function patternDriftSection(pubs: PubStat[]): string[] {
  // Compared over the declared-complete timeline only: a partial export's
  // pattern set is a tiny subset, so diffing it would report almost everything
  // as "lost" and drown the real signal.
  const timeline = pubs.filter(p => !p.partial).sort((a, b) => a.key.localeCompare(b.key));
  if (timeline.length < 2) return [];
  // The empty-string pattern is a zero-length (empty) callsign — name it rather
  // than render a confusing empty <code></code> span.
  const patternCode = (p: string): string =>
    p === '' ? '<span class="gap">(empty callsign)</span>' : `<code>${escapeHtml(p)}</code>`;
  const named = (patterns: string[]): string => {
    if (patterns.length === 0) return '<span class="gap">none</span>';
    const shown = patterns.slice(0, PATTERN_ENUMERATE_LIMIT).map(patternCode).join(', ');
    const more = patterns.length - PATTERN_ENUMERATE_LIMIT;
    return more > 0 ? `${shown} <span class="gap">… and ${num(more)} more</span>` : shown;
  };
  const rows: string[] = [];
  for (let i = 1; i < timeline.length; i++) {
    const prev = timeline[i - 1];
    const curr = timeline[i];
    const cmp = compareStats(curr.stats, prev.stats);
    const filterNote = filterCases(pubs).some(c => c.key === curr.key || c.key === prev.key)
      ? ' <span class="gap">(one side is the blank-product-filter publication, so some drift here reflects the omission, not the register)</span>'
      : '';
    rows.push(`<tr><td>${escapeHtml(humanDate(prev.key))} → ${escapeHtml(humanDate(curr.key))}${filterNote}</td><td>${named(cmp.newPatterns)}</td><td>${named(cmp.lostPatterns)}</td></tr>`);
  }
  return [
    '<section>',
    '<h2 id="patterns">Callsign-pattern appearance and disappearance</h2>',
    '<p>Each callsign is reduced to a structural pattern (uppercase→<code>A</code>, digit→<code>N</code>, invisibles marked <code>{U+XXXX}</code>). Comparing the pattern vocabulary between consecutive complete publications surfaces the rare shapes that appear or vanish — usually encoding artefacts or one-off oddities, exactly the kind of surprise worth catching. New and lost patterns are the set difference (reusing the shared comparison the entry quality reports use), over the complete-publication timeline.</p>',
    '<table>',
    tableCaption('Callsign patterns that appeared or vanished between consecutive complete publications'),
    '<tr><th scope="col">transition</th><th scope="col">new patterns</th><th scope="col">lost patterns</th></tr>',
    ...rows,
    '</table>',
    '</section>',
  ];
}

// ---- Section 6: adjacent surfaces (cross-links, not duplication) ----

function relatedSection(): string[] {
  return [
    '<section>',
    '<h2 id="related">Related, adjacent surfaces</h2>',
    '<p>This page is the static, no-JavaScript, Wayback-complete statistical view across publications. Three adjacent surfaces answer neighbouring questions:</p>',
    '<ul>',
    `<li><a href="${ROOT}compare.html">Compare</a> — the interactive surface: pick any two publications and diff them row-by-row in the browser (needs JavaScript; this page is the crawlable counterpart).</li>`,
    `<li><a href="${ROOT}reports/cross-dataset-invariants.html">Cross-dataset invariants</a> — the FOI available-pool snapshots joined against the register: depletion over time, the still-absent decomposition, the original-issue-date invariant.</li>`,
    `<li><a href="${ROOT}reports/value-catalogue.html">Value catalogue</a> — every distinct value of the tracked fields across both lanes, with counts and a timeline; the vocabulary this page only counts.</li>`,
    '</ul>',
    `<p class="dcap">And the per-publication view: the <a href="${ROOT}statistics.html">statistics page</a> describes the latest publication in depth, while each <a href="${ROOT}datasets/index.html">dataset entry</a> carries its own at-a-glance breakdowns.</p>`,
    '</section>',
  ];
}

export function buildInterdatasetStats(outputDir: string, baseUrl: string = DEFAULT_BASE_URL): string[] {
  const keys = listArchiveKeys().sort();
  const pubs = keys.map(readPub);

  const body = [
    '<h1>Inter-dataset statistics</h1>',
    '<p class="subtitle">Statistics <em>across</em> the archived Ofcom open-data publications — how the register changes from one publication to the next — as distinct from the <a href="' + ROOT + 'statistics.html">latest-publication statistics</a>, which describe a single snapshot. Every figure derives from each publication\'s committed <code>stats.json</code> and <code>meta.json</code>, regenerated on every deploy.</p>',
    noticeStrip(false, 'Every figure here is <b>declared, not verified</b> — the publisher\'s stated coverage, not a guarantee. Declared-partial publications are marked <span class="marker">⚠</span>; the absence of a record from a partial (or filtered) publication is not evidence of anything about the register.'),
    ...blankProductSection(pubs),
    ...recordCountSection(pubs),
    ...columnDriftSection(pubs),
    ...flagEvolutionSection(pubs),
    ...patternDriftSection(pubs),
    ...relatedSection(),
  ];

  const dir = path.join(outputDir, 'statistics');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'inter-dataset.html'),
    entryPage('Inter-dataset statistics', body, { currentNav: 'Inter-dataset', sourcePath: 'src/ci/build-interdataset-stats.ts' }, 1),
  );
  return [`${baseUrl}/statistics/inter-dataset.html`];
}

function main(): void {
  const [outputDir, baseUrl] = process.argv.slice(2).filter(a => a.trim().length > 0);
  if (!outputDir) {
    console.error('usage: node src/ci/build-interdataset-stats.ts <output-dir> [base-url]');
    process.exitCode = 1;
    return;
  }
  const urls = buildInterdatasetStats(outputDir, baseUrl);
  console.log(`inter-dataset statistics: ${urls.length} page`);
}

if (import.meta.main) {
  main();
}
