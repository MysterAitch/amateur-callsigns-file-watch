#!/usr/bin/env node

/**
 * Scheduled intake of the RSGB Special Contest Calls table (issue #693).
 *
 * Fetches the source page with an honest, identifying User-Agent (one request,
 * no browser spoof — the host is a plain Apache server, so a challenge page
 * APPEARING is itself a regression signal, not something to work around), runs
 * the non-negotiable sanity gate, and only then promotes the derived table into
 * `reference-data/` by an atomic rename. Any gate failure aborts loudly before
 * the tracked files are touched, leaving the previous good table in place.
 *
 * The sanity gate (in parse-scc.ts) rejects: a non-200 status, an unexpected
 * content-type, a challenge/HTML-gate page, a missing or shape-drifted table, a
 * row count outside the accepted band, a missing "Updated" banner, and any
 * status outside the closed vocabulary that is not a known, allow-listed anomaly.
 *
 * Only the network fetch is impure; it is injectable so the tests exercise the
 * real gate, promotion and diff against a mocked fetch.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  SCC_SOURCE_URL,
  parseSccTable,
  sanityGateProblems,
  toCsv,
  toMeta,
  toMetaJson,
  type SccRow,
  type ParsedSccTable,
  type SanityGateOptions,
} from './parse-scc.ts';

// The honest, identifying User-Agent — names the project and its purpose and
// masquerades as no browser. A contact address is appended when SCC_FETCH_CONTACT
// is set, so an operator can be reached without committing a personal address.
export function defaultUserAgent(contact: string | undefined = process.env.SCC_FETCH_CONTACT): string {
  const base = 'amateur-callsigns-file-watch data-mirror (courtesy fetch; one request per URL)';
  return contact !== undefined && contact.trim().length > 0 ? `${base} (contact: ${contact.trim()})` : base;
}

export const DEFAULT_TIMEOUT_MS = 60_000;

// The committed derived artefacts, resolved from the repo root (this module lives
// at src/sources/rsgb-scc/, three levels down).
export const REFERENCE_DATA_DIR = path.resolve(import.meta.dirname, '..', '..', '..', 'reference-data');
export const SCC_CSV_PATH = path.join(REFERENCE_DATA_DIR, 'rsgb-special-contest-calls.csv');
export const SCC_META_PATH = path.join(REFERENCE_DATA_DIR, 'rsgb-special-contest-calls.meta.json');

// The subset of a fetch Response this module reads; the global fetch's Response
// satisfies it structurally, and a test double need only supply these.
export interface FetchLikeResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}
export type FetchLike = (url: string, init: { headers: Record<string, string>; redirect: 'follow'; signal: AbortSignal }) => Promise<FetchLikeResponse>;

export interface FetchPageOptions {
  userAgent?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

// Fetch the page, following redirects, with the honest UA and a timeout. Rejects
// loudly on a non-200 status, an unexpected content-type, or a body that looks
// like an HTML challenge/gate page (all regression signals for a host that is
// currently a plain, ungated Apache server).
export async function fetchSccPage(url: string = SCC_SOURCE_URL, opts: FetchPageOptions = {}): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const userAgent = opts.userAgent ?? defaultUserAgent();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: FetchLikeResponse;
  try {
    response = await fetchImpl(url, {
      headers: { 'User-Agent': userAgent, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8' },
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (cause) {
    // A connection-level failure (DNS, TLS, refused, abort) surfaces from
    // fetch() as a bare "fetch failed" with the detail hidden in `cause` —
    // useless in a CI log. Name the URL and the underlying reason so the
    // fail-loud gate is also fail-diagnosable.
    const detail = cause instanceof Error
      ? `${cause.message}${cause.cause instanceof Error ? ` (${cause.cause.message})` : ''}`
      : String(cause);
    throw new Error(`SCC fetch aborted: could not connect to ${url}: ${detail}`);
  } finally {
    clearTimeout(timer);
  }

  if (response.status !== 200) {
    throw new Error(`SCC fetch aborted: ${url} returned status ${response.status} (expected 200)`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType !== '' && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    throw new Error(`SCC fetch aborted: ${url} returned unexpected content-type "${contentType}" (expected HTML)`);
  }
  const body = await response.text();
  assertNotChallengePage(body);
  return body;
}

// A challenge/interstitial page is short and carries a tell-tale phrase; the real
// SCC page is ~68 KB and contains the SCC header row. This catches a CDN/bot gate
// suddenly appearing in front of the host — a regression to surface, not absorb.
export function assertNotChallengePage(body: string): void {
  const lower = body.toLowerCase();
  const challengeMarkers = ['just a moment', 'checking your browser', 'cf-browser-verification', 'attention required', 'enable javascript and cookies'];
  const marker = challengeMarkers.find((m) => lower.includes(m));
  if (marker !== undefined) {
    throw new Error(`SCC fetch aborted: response looks like a challenge/interstitial page (matched "${marker}"), not the SCC table`);
  }
}

export interface SccDiff {
  added: string[];
  removed: string[];
  // "CODE: old -> new" for a status or base-callsign change on a retained code.
  changed: string[];
}

// A row keyed by SCC code, for the diff.
function indexByCode(rows: SccRow[]): Map<string, SccRow> {
  return new Map(rows.map((r) => [r.scc_code, r]));
}

// Diff a freshly-parsed table against the previously-committed one: which SCC
// codes were added, which withdrawn from the table entirely, and which retained
// codes changed status or base callsign (a reassignment). Drives the sweep's PR
// summary; pure and unit-tested.
export function diffSccTables(oldRows: SccRow[], newRows: SccRow[]): SccDiff {
  const oldByCode = indexByCode(oldRows);
  const newByCode = indexByCode(newRows);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const code of newByCode.keys()) {
    if (!oldByCode.has(code)) added.push(code);
  }
  for (const code of oldByCode.keys()) {
    if (!newByCode.has(code)) removed.push(code);
  }
  for (const [code, newRow] of newByCode) {
    const oldRow = oldByCode.get(code);
    if (oldRow === undefined) continue;
    if (oldRow.status !== newRow.status) {
      changed.push(`${code}: status "${oldRow.status}" -> "${newRow.status}"`);
    }
    if (oldRow.base_callsign !== newRow.base_callsign) {
      changed.push(`${code}: base callsign "${oldRow.base_callsign}" -> "${newRow.base_callsign}"`);
    }
  }
  added.sort((a, b) => a.localeCompare(b));
  removed.sort((a, b) => a.localeCompare(b));
  changed.sort((a, b) => a.localeCompare(b));
  return { added, removed, changed };
}

// Parse the previously-committed CSV back into rows, for the diff. Returns an
// empty list when no committed table exists yet (the first-ever run).
export function readCommittedRows(csvPath: string = SCC_CSV_PATH): SccRow[] {
  if (!fs.existsSync(csvPath)) return [];
  const text = fs.readFileSync(csvPath, 'utf8');
  const lines = text.split('\n').filter((l) => l.length > 0);
  const rows: SccRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    // Minimal CSV read matching toCsv's minimal-quoting output; the notes column
    // may be quoted, so split on the first three unquoted commas only.
    const cells = parseCsvLine(lines[i]);
    if (cells.length < 4) continue;
    rows.push({ scc_code: cells[0], base_callsign: cells[1], status: cells[2], notes: cells[3] });
  }
  return rows;
}

// A single RFC-4180-style CSV line into its fields (handles double-quoted fields
// with embedded commas and doubled quotes).
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

export interface IntakeResult {
  parsed: ParsedSccTable;
  csv: string;
  metaJson: string;
  diff: SccDiff;
  changed: boolean;
}

// The full intake: fetch, gate, build the artefacts, diff against the committed
// table, and (unless dryRun) promote atomically. Throws on any gate failure. The
// paths and sanity band default to production values; they are injectable so the
// tests exercise the real gate, promotion and diff against a temp directory.
export async function runSccIntake(opts: {
  fetchImpl?: FetchLike;
  userAgent?: string;
  now?: Date;
  dryRun?: boolean;
  csvPath?: string;
  metaPath?: string;
  sanityOptions?: SanityGateOptions;
} = {}): Promise<IntakeResult> {
  const csvPath = opts.csvPath ?? SCC_CSV_PATH;
  const metaPath = opts.metaPath ?? SCC_META_PATH;

  const html = await fetchSccPage(SCC_SOURCE_URL, { fetchImpl: opts.fetchImpl, userAgent: opts.userAgent });
  const parsed = parseSccTable(html);

  const problems = sanityGateProblems(parsed, opts.sanityOptions);
  if (problems.length > 0) {
    throw new Error(`SCC sanity gate failed; aborting before touching the tracked files:\n  - ${problems.join('\n  - ')}`);
  }

  const fetchedAt = (opts.now ?? new Date()).toISOString();
  const csv = toCsv(parsed.rows);
  const metaJson = toMetaJson(toMeta(parsed, { fetchedAt }));

  const previous = readCommittedRows(csvPath);
  const diff = diffSccTables(previous, parsed.rows);

  const existingCsv = fs.existsSync(csvPath) ? fs.readFileSync(csvPath, 'utf8') : '';
  const changed = existingCsv !== csv;

  if (opts.dryRun !== true) {
    promoteAtomically(csvPath, csv);
    promoteAtomically(metaPath, metaJson);
  }
  return { parsed, csv, metaJson, diff, changed };
}

// Write to a temp sibling and atomically rename into place, so a crash mid-write
// can never leave a half-written tracked file.
function promoteAtomically(targetPath: string, contents: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tempPath, contents);
    fs.renameSync(tempPath, targetPath);
  } catch (err) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch { /* ignore */ }
    throw err;
  }
}

// Human-readable summary of the run, for the sweep's stdout and PR body.
export function summariseIntake(result: IntakeResult): string {
  const { parsed, diff, changed } = result;
  const statusLine = Object.entries(parsed.statusCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${status}=${count}`)
    .join(', ');
  const flagged = parsed.rows.filter((r) => r.notes !== '');
  const lines = [
    `Rows: ${parsed.rows.length}`,
    `Status distribution: ${statusLine}`,
    `Upstream banner: ${parsed.updated?.text ?? '(none)'}`,
    `Flagged rows (${flagged.length}):`,
    ...flagged.map((r) => `  - ${r.scc_code}: ${r.notes}`),
    `Change vs committed table: ${changed ? 'changed' : 'no change'}`,
    `  added: ${diff.added.length ? diff.added.join(', ') : '(none)'}`,
    `  withdrawn from table: ${diff.removed.length ? diff.removed.join(', ') : '(none)'}`,
    `  reassigned/changed: ${diff.changed.length ? diff.changed.join('; ') : '(none)'}`,
  ];
  return lines.join('\n');
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const result = await runSccIntake({ dryRun });
  process.stdout.write(`${summariseIntake(result)}\n`);
  if (!dryRun) {
    process.stdout.write(`Wrote ${SCC_CSV_PATH}\nWrote ${SCC_META_PATH}\n`);
  }
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
