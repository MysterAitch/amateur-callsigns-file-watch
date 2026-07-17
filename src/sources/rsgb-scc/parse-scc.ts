/**
 * Parser for the RSGB Special Contest Calls (SCC) table.
 *
 * The source page (https://www.rsgbcc.org/hf/information/scc.shtml) carries
 * substantial RSGB-authored prose — eligibility rules, contest lists, an FAQ, a
 * news banner — all of which is copyrightable and is NEVER reproduced by this
 * project. Only the uncopyrightable three-column factual table (SCC code, the
 * base licensee/club call, and the status) is extracted into a project-authored
 * derived table, cited by URL and fetch date (the cite-don't-copy pattern used
 * for the ITU call-sign-series table). This module is that extractor, and every
 * logic-bearing piece is pure and fixture-tested; only the network fetch (in
 * fetch-scc.ts) is impure.
 *
 * Two standing data-quality realities of the source are handled explicitly under
 * the carry-verbatim-and-flag rule, never silently normalised away:
 *   - status values are carried exactly as published (the raw token), while a
 *     closed status vocabulary is enforced by a CASE-NORMALISED comparison — so a
 *     lower-case `withdrawn` is carried verbatim and flagged, not rewritten, and
 *     a known typo (`Withdrawb`) is carried verbatim, flagged, and allow-listed
 *     rather than corrected. A status that is neither canonical, a mere casing
 *     variant, nor a known typo is a fail-loud signal (a new status class or a
 *     scrape error) that must stop the sweep and surface for review.
 *   - the export leaves hidden `x:str` attributes on a few cells (leftover Excel
 *     content not shown on the rendered page). These are attested source bytes,
 *     so they are CAPTURED verbatim into the notes column rather than discarded.
 */

import { JSDOM } from 'jsdom';
import { stringify } from 'csv-stringify/sync';

// The live source. The page has carried this URL since 2013.
export const SCC_SOURCE_URL = 'https://www.rsgbcc.org/hf/information/scc.shtml';

// The derived table's columns. `notes` is the project-authored, closed-vocabulary
// transparency column that carries every anomaly flag and every captured source
// remnant for a row (empty for an ordinary row).
export const SCC_CSV_HEADER = ['scc_code', 'base_callsign', 'status', 'notes'] as const;

// The closed canonical status vocabulary — the exact spelling and casing the
// table uses for a well-formed row.
export const CANONICAL_STATUSES = ['Issued', 'Available', 'Withdrawn'] as const;
export type CanonicalStatus = (typeof CANONICAL_STATUSES)[number];

// The curated allow-list of KNOWN upstream typos, carried verbatim and flagged,
// never corrected. Keyed by the exact raw token as published; the value records
// the canonical status it stands for and the flag token to attach. Casing
// variants are handled generically (any case-insensitive match to a canonical
// status is flagged `status-noncanonical-case`), so only genuine misspellings
// need an entry here. A raw status that is none of these is a fail-loud trigger,
// which is what forces a new anomaly through a reviewed decision rather than
// letting it pass silently.
export const KNOWN_STATUS_TYPOS: ReadonlyMap<string, CanonicalStatus> = new Map([
  ['Withdrawb', 'Withdrawn'],
]);

// The header labels the data table's first row must carry, lower-cased for a
// case-tolerant comparison. The table is selected out of the several on the page
// by matching these, so a page redesign that moves or restyles the table is
// caught rather than silently mis-parsed.
export const EXPECTED_HEADER_LABELS = ['special contest call', 'licensee or club call', 'status'] as const;

// Nominal row count and the tolerance band the sanity gate accepts. The live
// table enumerates the ~500-row SCC namespace; the band is wide enough for the
// organic issue/withdrawal churn between monthly sweeps but narrow enough that a
// page redesign (which typically collapses the row count to near zero or
// explodes it) trips the gate loudly.
export const NOMINAL_ROW_COUNT = 520;
export const ROW_COUNT_TOLERANCE = 80;

export interface SccStatusClassification {
  // The canonical status the raw token resolves to, or undefined when the token
  // is not recognised at all (the fail-loud case).
  canonical: CanonicalStatus | undefined;
  // Closed-vocabulary flag tokens describing how the raw token deviates from the
  // canonical spelling (empty for an exact canonical token).
  flags: string[];
  // True when the token is neither canonical, a casing variant, nor a known typo
  // — the signal that stops the sweep.
  unrecognised: boolean;
}

// Classify a raw (already-trimmed) status token against the closed vocabulary by
// a case-normalised comparison, carrying the raw token untouched.
export function classifyStatus(raw: string): SccStatusClassification {
  const canonicalExact = CANONICAL_STATUSES.find((s) => s === raw);
  if (canonicalExact !== undefined) {
    return { canonical: canonicalExact, flags: [], unrecognised: false };
  }
  const canonicalByCase = CANONICAL_STATUSES.find((s) => s.toLowerCase() === raw.toLowerCase());
  if (canonicalByCase !== undefined) {
    return { canonical: canonicalByCase, flags: ['status-noncanonical-case'], unrecognised: false };
  }
  const typoOf = KNOWN_STATUS_TYPOS.get(raw);
  if (typoOf !== undefined) {
    return { canonical: typoOf, flags: ['status-typo'], unrecognised: false };
  }
  return { canonical: undefined, flags: ['status-unrecognised'], unrecognised: true };
}

export interface SccRow {
  scc_code: string;
  base_callsign: string;
  // The raw status token, carried exactly as published.
  status: string;
  // Closed-vocabulary flags plus any captured source remnants, `; `-joined.
  notes: string;
}

export interface ParsedUpdatedBanner {
  // The banner text exactly as it appears, e.g. "Updated 15 June 2026".
  text: string;
  // The ISO-8601 date parsed from it, e.g. "2026-06-15".
  iso: string;
}

export interface ParsedSccTable {
  updated: ParsedUpdatedBanner | undefined;
  rows: SccRow[];
  // Raw-status token -> count, for the shape summary and the sweep's PR body.
  statusCounts: Record<string, number>;
  // Structural problems found while parsing (header shape, row-cell-count drift,
  // duplicate codes, unrecognised statuses). The sanity gate adds the banner and
  // row-count checks; the orchestrator refuses to promote when any problem exists.
  problems: string[];
}

const MONTHS: ReadonlyMap<string, number> = new Map(
  ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].map(
    (name, i) => [name, i + 1],
  ),
);

// The "Updated <day> <month> <year>" banner, anywhere in the page's visible text.
// Returns undefined when it is absent or unparseable (a fail-loud condition — the
// banner is the source's own currency stamp and the sweep must not accept a page
// that has lost it).
export function parseUpdatedBanner(text: string): ParsedUpdatedBanner | undefined {
  const m = /Updated\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(text);
  if (m === null) return undefined;
  const day = Number(m[1]);
  const month = MONTHS.get(m[2].toLowerCase());
  const year = Number(m[3]);
  if (month === undefined || day < 1 || day > 31) return undefined;
  const iso = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  return { text: `Updated ${m[1]} ${m[2]} ${m[3]}`, iso };
}

// The visible text of a cell, with surrounding whitespace and <br> rendering
// artefacts stripped. The meaningful token survives; a trailing-space rendering
// artefact does not (its bytes, when they hide in an x:str attribute, are still
// captured separately).
function cellText(td: Element): string {
  return (td.textContent ?? '').replace(/\s+/g, ' ').trim();
}

// Direct <td> children of a row (never descending into a nested table).
function rowCells(tr: Element): Element[] {
  return [...tr.children].filter((c) => c.tagName === 'TD');
}

// Select the SCC data table out of the several tables on the page by its header
// row, the same discipline the Ofcom scraper uses for its CSV link: match on the
// human-meaningful labels the publisher controls, and refuse (rather than guess)
// when zero or more than one table matches.
function findSccTable(document: Document): { table: Element | undefined; problem: string | undefined } {
  const matches: Element[] = [];
  for (const table of document.querySelectorAll('table')) {
    const firstRow = table.querySelector('tr');
    if (firstRow === null) continue;
    const labels = rowCells(firstRow).map((c) => cellText(c).toLowerCase());
    if (EXPECTED_HEADER_LABELS.every((label, i) => labels[i] === label)) {
      matches.push(table);
    }
  }
  if (matches.length === 1) return { table: matches[0], problem: undefined };
  if (matches.length === 0) {
    return {
      table: undefined,
      problem: `no table on the page carries the expected SCC header row [${EXPECTED_HEADER_LABELS.join(' | ')}] — the page structure may have changed`,
    };
  }
  return {
    table: undefined,
    problem: `${matches.length} tables carry the expected SCC header row — refusing to guess which is the data table`,
  };
}

// Build the notes column for a row: the status flags first, then any captured
// hidden `x:str` remnants (one per cell that carried one, tagged with the column
// it sat on so the attested bytes stay locatable). Empty for an ordinary row.
function buildNotes(statusFlags: string[], remnants: string[]): string {
  return [...statusFlags, ...remnants].join('; ');
}

// Parse the whole page: locate the table, extract every data row, classify each
// status, capture every hidden remnant, and tally the raw-status distribution.
export function parseSccTable(html: string): ParsedSccTable {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const problems: string[] = [];

  const updated = parseUpdatedBanner(document.body?.textContent ?? '');

  const { table, problem: tableProblem } = findSccTable(document);
  if (tableProblem !== undefined) problems.push(tableProblem);

  const rows: SccRow[] = [];
  const statusCounts: Record<string, number> = {};
  const seenCodes = new Set<string>();

  if (table !== undefined) {
    const trs = [...table.querySelectorAll('tr')];
    // trs[0] is the header row (already matched by findSccTable); data rows follow.
    for (let i = 1; i < trs.length; i++) {
      const cells = rowCells(trs[i]);
      if (cells.length !== EXPECTED_HEADER_LABELS.length) {
        problems.push(`row ${i} has ${cells.length} cells, expected ${EXPECTED_HEADER_LABELS.length} — table shape drift`);
        continue;
      }
      const columnValues = [cellText(cells[0]), cellText(cells[1]), cellText(cells[2])];
      const [scc_code, base_callsign, status] = columnValues;

      // Skip a fully-blank spacer row rather than treating it as data.
      if (scc_code === '' && base_callsign === '' && status === '') continue;

      // Capture hidden x:str remnants, tagged with the column they sat on.
      const remnants: string[] = [];
      cells.forEach((cell, col) => {
        const remnant = cell.getAttribute('x:str');
        if (remnant !== null) {
          remnants.push(`source-cell-remnant:${SCC_CSV_HEADER[col]}=${remnant}`);
        }
      });

      const classification = classifyStatus(status);
      if (classification.unrecognised) {
        problems.push(`row ${i} (${scc_code}) has status "${status}" outside the closed vocabulary [${CANONICAL_STATUSES.join(', ')}] and is not a known anomaly`);
      }
      if (scc_code === '') {
        problems.push(`row ${i} has an empty SCC code`);
      } else if (seenCodes.has(scc_code)) {
        problems.push(`duplicate SCC code "${scc_code}" at row ${i}`);
      }
      seenCodes.add(scc_code);

      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      rows.push({ scc_code, base_callsign, status, notes: buildNotes(classification.flags, remnants) });
    }
  }

  // Canonical at rest: sort by SCC code so the committed table has a stable order
  // robust to the page reordering its own rows (git-diff readability).
  rows.sort((a, b) => a.scc_code.localeCompare(b.scc_code));

  return { updated, rows, statusCounts, problems };
}

export interface SanityGateOptions {
  minRows?: number;
  maxRows?: number;
}

// The sanity gate: the parsed table's structural problems, plus the banner and
// row-count checks. A non-empty result aborts the sweep before the tracked file
// is touched.
export function sanityGateProblems(parsed: ParsedSccTable, options: SanityGateOptions = {}): string[] {
  const problems = [...parsed.problems];
  const minRows = options.minRows ?? NOMINAL_ROW_COUNT - ROW_COUNT_TOLERANCE;
  const maxRows = options.maxRows ?? NOMINAL_ROW_COUNT + ROW_COUNT_TOLERANCE;

  if (parsed.updated === undefined) {
    problems.push('the "Updated <day> <month> <year>" banner is missing or unparseable');
  }
  if (parsed.rows.length < minRows || parsed.rows.length > maxRows) {
    problems.push(`row count ${parsed.rows.length} is outside the accepted band [${minRows}, ${maxRows}] — page redesign or scrape error`);
  }
  return problems;
}

// The derived CSV, byte-deterministic (LF line endings, header row, minimal
// quoting), matching the repository's other reference tables.
export function toCsv(rows: SccRow[]): string {
  return stringify(rows, {
    header: true,
    columns: [...SCC_CSV_HEADER],
    record_delimiter: '\n',
  });
}

export interface SccMeta {
  schemaVersion: number;
  source: {
    name: string;
    url: string;
    // The licence treatment recorded for transparency: only the factual table is
    // extracted; the page's RSGB-authored prose is cited, not reproduced.
    licenceBasis: string;
    treatment: string;
  };
  fetchedAt: string;
  upstreamUpdated: ParsedUpdatedBanner;
  rowCount: number;
  statusCounts: Record<string, number>;
}

export const SCC_META_SCHEMA_VERSION = 1;

// The provenance + shape sidecar for the derived table. Regenerated by every
// sweep, so it cannot drift from the CSV; a data-validity test re-derives its
// figures from the committed CSV and asserts they agree.
export function toMeta(parsed: ParsedSccTable, opts: { fetchedAt: string }): SccMeta {
  if (parsed.updated === undefined) {
    throw new Error('cannot build SCC metadata without a parsed "Updated" banner');
  }
  return {
    schemaVersion: SCC_META_SCHEMA_VERSION,
    source: {
      name: 'RSGB Special Contest Calls',
      url: SCC_SOURCE_URL,
      licenceBasis: 'copyright-cite-only',
      treatment:
        'Only the uncopyrightable three-column factual table is extracted; the page\'s RSGB-authored prose (rules, FAQ, contest lists) is cited by URL and fetch date, not reproduced.',
    },
    fetchedAt: opts.fetchedAt,
    upstreamUpdated: parsed.updated,
    rowCount: parsed.rows.length,
    statusCounts: sortedCounts(parsed.statusCounts),
  };
}

// Counts with keys in a stable order, so the serialised metadata is deterministic.
function sortedCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

// The metadata serialised exactly as it is committed (2-space JSON, trailing LF).
export function toMetaJson(meta: SccMeta): string {
  return `${JSON.stringify(meta, null, 2)}\n`;
}
