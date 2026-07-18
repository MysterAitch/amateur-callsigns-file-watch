#!/usr/bin/env node

/**
 * Pre-renders the home page's build-time surfaces — the corpus-wide HOLDINGS
 * MAP and the headline figures — as static HTML injected into the deployed
 * index.html (issue #712).
 *
 * The map is the lettered-cell grid the publisher pages already carry
 * (src/ci/build-publisher-pages.ts), fed here with the WHOLE corpus rather than
 * one publisher's holdings: one cell per dataset, lettered and tinted by kind,
 * stacked newest vintage year first, each cell a genuine deep-link to that
 * dataset's own page. Rendering it at build time keeps the front door working
 * with JavaScript off — the map, the figures and the first surprise are all
 * present in the served HTML; site/home.js only layers the hover/focus readout,
 * the tab switching and the surprise rotation on top.
 *
 * Every headline figure is a DERIVED aggregate, read from the committed archive
 * at build time and stamped with the build it was read from — never presented as
 * unqualified live truth, matching the epistemics convention the rest of the
 * site keeps.
 *
 * The substitution is the same fail-loud placeholder-and-writeFileSync pattern
 * build-home-aggregates.ts uses for statistics.html: a drifted placeholder
 * throws rather than silently publishing the local-view fallback.
 *
 * Usage: node src/ci/build-front-door.ts <path-to-index.html>
 */

import * as fs from 'fs';
import { listArchiveKeys } from '../shared/archive.ts';
import { derivedEntryFile, derivedEntryFileExists } from '../shared/derived-entries.ts';
import { readPublisherRegister } from '../shared/publishers.ts';
import {
  collectHoldings,
  holdingEntryHref,
  kindLetter,
  primaryClass,
  type Holding,
} from './build-publisher-pages.ts';
import { humaniseClassKey } from './dataset-class-overviews.ts';
import { humanDate, monthYear, dateTimeDisplay } from './site-render.ts';
import { type EntryStats } from '../shared/stats.ts';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// The headline shape of the record, as DERIVED figures read from the committed
// archive. Epistemics: these summarise committed data at a known build; the
// stamp below dates them.
export interface HomeFigures {
  callsigns: number;      // rows in the newest complete register snapshot
  datasets: number;       // every dataset the mirror holds, both lanes
  spanFrom: number;       // earliest data vintage year in the corpus
  spanTo: number;         // latest data vintage year in the corpus
  latestKey: string;      // newest open-data publication key (a date)
  latestDate: string;     // …humanised
}

// The newest open-data publication's record count — the "callsigns" headline.
// Reads the same committed stats.json the statistics page derives from.
function newestRegisterRecordCount(): number {
  const keys = listArchiveKeys().sort();
  const newest = keys[keys.length - 1];
  if (newest === undefined) throw new Error('build-front-door: no archive entries found');
  if (!derivedEntryFileExists(newest, 'stats.json')) {
    throw new Error(`build-front-door: ${newest} has no stats.json — cannot derive the callsign headline`);
  }
  const stats = JSON.parse(fs.readFileSync(derivedEntryFile(newest, 'stats.json'), 'utf8')) as EntryStats;
  if (typeof stats.recordCount !== 'number') {
    throw new Error(`build-front-door: ${newest} stats.json carries no numeric recordCount`);
  }
  return stats.recordCount;
}

// Derive the headline figures from the corpus. Exported so a test can assert the
// figures against the real archive without re-deriving them by hand.
export function homeFigures(holdings: Holding[] = collectHoldings(readPublisherRegister())): HomeFigures {
  const openDataKeys = holdings.filter(h => h.lane === 'open-data').map(h => h.key).sort();
  const latestKey = openDataKeys[openDataKeys.length - 1];
  if (latestKey === undefined) throw new Error('build-front-door: no open-data publications found');
  const years = holdings
    .map(h => h.vintage)
    .filter((v): v is string => v !== undefined)
    .map(v => Number(v.slice(0, 4)))
    .filter(y => Number.isFinite(y));
  return {
    callsigns: newestRegisterRecordCount(),
    datasets: holdings.length,
    spanFrom: Math.min(...years),
    spanTo: Math.max(...years),
    latestKey,
    // Month precision (#551): a single headline figure, not a list, so there
    // is nothing to disambiguate - latestKey itself carries the exact date.
    latestDate: monthYear(latestKey),
  };
}

// The build the figures were read from, humanised, for the derived-and-dated
// stamp. BUILD_COMMIT_TIME is set by the deploy (the commit's own date, so the
// stamp is deterministic per commit); outside CI it falls back to the current
// day, so a local build still reads honestly.
function derivedAtLabel(): string {
  const iso = (process.env.BUILD_COMMIT_TIME ?? '').trim() || new Date().toISOString();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? humanDate(`${m[1]}-${m[2]}-${m[3]}`) : humanDate(new Date().toISOString().slice(0, 10));
}

// A holding's vintage year, or undefined when undated.
function vintageYear(h: Holding): number | undefined {
  return h.vintage === undefined ? undefined : Number(h.vintage.slice(0, 4));
}

// Newest first within a year group; a stable key tiebreak keeps the output
// deterministic across re-crawls.
function byVintageThenKeyDesc(a: Holding, b: Holding): number {
  return (b.vintage ?? '').localeCompare(a.vintage ?? '') || a.key.localeCompare(b.key);
}

// The exact-vintage label for a cell's readout/aria: a full date where the
// vintage is a date, the month otherwise, "undated" when absent. Full date is
// requested (#551) because this whole-corpus map lists every holding at once,
// and the archive already holds more than one register snapshot in the same
// month - the disambiguation case; a month-only vintage clamps to month
// rather than fabricating a day (the shared precision mechanism, format.ts).
function vintageLabel(h: Holding): string {
  return h.vintage === undefined ? 'undated' : dateTimeDisplay(h.vintage, { precision: 'full-date' });
}

// The single newest register snapshot keeps the "latest snapshot" signal — an
// accent ring on its cell, the emphasis the design carries.
function latestSnapshotKey(holdings: Holding[]): string | undefined {
  return holdings
    .filter(h => primaryClass(h) === 'register-snapshot' && h.vintage !== undefined)
    .reduce<Holding | undefined>((a, b) => (a && (a.vintage ?? '') > (b.vintage ?? '') ? a : b), undefined)?.key;
}

// The declared-coverage state for a cell's data-attribute: complete/partial
// only exist where the lane declares the field at all, mirroring the
// classification build-publisher-pages.ts's own coverage cell renders (#741).
function coverageState(h: Holding): 'complete' | 'partial' | 'none' {
  if (h.hasCoverageField !== true || h.coverage === undefined) return 'none';
  return h.coverage.complete ? 'complete' : 'partial';
}

// One map cell: a genuine deep-link to the dataset's own page, carrying the
// kind, title, vintage, row count, declared coverage and quality-flag count as
// data-attributes so home.js's readout can announce {kind · dataset · vintage ·
// rows} on hover/focus and its richer per-cell popover (#741) can add the
// declared-complete state and any quality caveat, and a full aria-label so the
// cell reads without either enhancement too. Colour is never the sole cue —
// the letter carries the kind.
function mapCell(h: Holding, latestKey: string | undefined): string {
  const cls = primaryClass(h);
  const kindLabel = humaniseClassKey(cls);
  const rows = h.recordCount === undefined || h.recordCount === 0 ? '' : h.recordCount.toLocaleString('en-GB');
  const vlabel = vintageLabel(h);
  const ariaParts = [`${kindLabel}: ${h.title}`, vlabel];
  if (rows !== '') ariaParts.push(`${rows} rows`);
  const dataAttrs = [
    `data-key="${escapeHtml(h.key)}"`,
    `data-kind="${escapeHtml(cls)}"`,
    `data-kind-label="${escapeHtml(kindLabel)}"`,
    `data-title="${escapeHtml(h.title)}"`,
    `data-vintage="${escapeHtml(vlabel)}"`,
    rows === '' ? 'data-rows=""' : `data-rows="${escapeHtml(rows)}"`,
    `data-coverage="${coverageState(h)}"`,
    `data-quality="${h.qualityCount ?? 0}"`,
    `data-coverage-affecting="${h.coverageAffecting === true ? 'true' : 'false'}"`,
  ].join(' ');
  const latest = h.key === latestKey ? ' hold-cell--latest' : '';
  return `<li><a class="hold-cell${latest}" ${dataAttrs} href="${escapeHtml(holdingEntryHref(h))}" aria-label="${escapeHtml(ariaParts.join(' — '))}"><span aria-hidden="true">${escapeHtml(kindLetter(cls))}</span></a></li>`;
}

// Render the corpus-wide holdings map for the home page (depth 0 — index.html
// sits at the site root, so cell hrefs are datasets/… with no leading ../). The
// grid stacks on a continuous vintage-year axis, newest first, empty years as
// visible gaps; a legend maps letter+tint to only the kinds actually present; a
// keyboard skip steps past the cells. Exported so a test can assert the cells
// deep-link to real dataset pages.
export function renderHoldingsMap(holdings: Holding[], afterAnchor = 'past-holdings'): string {
  const dated = holdings.filter(h => h.vintage !== undefined);
  const undated = holdings.filter(h => h.vintage === undefined);
  const latestKey = latestSnapshotKey(holdings);

  const yearRows: string[] = [];
  if (dated.length > 0) {
    const years = dated.map(vintageYear).filter((y): y is number => y !== undefined);
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    for (let year = maxYear; year >= minYear; year--) {
      const inYear = dated.filter(h => vintageYear(h) === year).sort(byVintageThenKeyDesc);
      const cells = inYear.map(h => mapCell(h, latestKey)).join('');
      yearRows.push(`<li class="hold-map-yr${cells === '' ? ' hold-map-yr--empty' : ''}"><span class="hold-map-yrlab">${year}</span><ul class="hold-map-cells">${cells}</ul></li>`);
    }
  }
  if (undated.length > 0) {
    const cells = undated.slice().sort((a, b) => a.key.localeCompare(b.key)).map(h => mapCell(h, latestKey)).join('');
    yearRows.push(`<li class="hold-map-yr"><span class="hold-map-yrlab">undated</span><ul class="hold-map-cells">${cells}</ul></li>`);
  }

  const present = new Set(holdings.map(primaryClass));
  const legend = [...new Set([...Object.keys(kindOrder()), ...present])]
    .filter(c => present.has(c))
    .map(c => `<li><span class="hold-cell hold-cell--legend" data-kind="${escapeHtml(c)}" aria-hidden="true">${escapeHtml(kindLetter(c))}</span> ${escapeHtml(humaniseClassKey(c))}</li>`)
    .join('');

  return [
    '<nav class="hold-map" aria-label="Every dataset, lettered and tinted by kind">',
    `<p class="hold-map-lead">Every dataset the mirror holds, one cell each — lettered and tinted by kind, stacked by data vintage with the newest year first; the ringed cell is the latest register snapshot, and empty years are left as gaps. Select a cell to open that dataset.</p>`,
    `<a class="hold-skip" href="#${escapeHtml(afterAnchor)}">Skip the holdings map (${holdings.length} datasets)</a>`,
    `<p class="hold-readout" id="hold-readout" role="status" aria-live="polite">Hover or focus a cell to read its dataset — kind, title, vintage and row count.</p>`,
    `<ol class="hold-map-grid" id="hold-grid">${yearRows.join('')}</ol>`,
    `<ul class="hold-legend">${legend}</ul>`,
    '</nav>',
  ].join('\n');
}

// A stable kind order for the legend (the publisher-page vocabulary order),
// derived from the shared letters map so it never drifts from the cells.
function kindOrder(): Record<string, string> {
  return {
    'register-snapshot': 'R', 'available-pool': 'A', 'issuance-events': 'I',
    'forbidden-list': 'F', 'statistics-aggregate': 'S', 'attribute-addendum': 'T',
    'reference-context': 'C',
  };
}

// The build-time replacements the home page carries. Each placeholder is present
// verbatim in the hand-authored index.html (with a local-view fallback), and a
// missing one throws rather than silently shipping the fallback.
export function frontDoorReplacements(holdings: Holding[], fig: HomeFigures): [string, string][] {
  const n = (x: number): string => x.toLocaleString('en-GB');
  const derivedAt = derivedAtLabel();
  return [
    ['<!--home:callsigns-->', n(fig.callsigns)],
    ['<!--home:datasets-->', n(fig.datasets)],
    ['<!--home:span-->', `${fig.spanFrom}–${fig.spanTo}`],
    ['<!--home:latest-->', escapeHtml(fig.latestDate)],
    ['<!--home:derivedAt-->', escapeHtml(derivedAt)],
    ['<!--home:holdings-map-->', renderHoldingsMap(holdings)],
  ];
}

export function injectFrontDoor(indexPath: string): void {
  const holdings = collectHoldings(readPublisherRegister());
  const fig = homeFigures(holdings);
  let html = fs.readFileSync(indexPath, 'utf8');
  for (const [placeholder, replacement] of frontDoorReplacements(holdings, fig)) {
    if (!html.includes(placeholder)) {
      throw new Error(`build-front-door: placeholder not found in ${indexPath}: ${placeholder}`);
    }
    html = html.split(placeholder).join(replacement);
  }
  fs.writeFileSync(indexPath, html);
}

function main(): void {
  const [indexPath] = process.argv.slice(2).filter(a => a.trim().length > 0);
  if (!indexPath) {
    console.error('usage: node src/ci/build-front-door.ts <path-to-index.html>');
    process.exitCode = 1;
    return;
  }
  injectFrontDoor(indexPath);
  console.log(`front door pre-rendered into ${indexPath}`);
}

if (import.meta.main) {
  main();
}
