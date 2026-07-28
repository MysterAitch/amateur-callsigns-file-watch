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
  SCC_CSV_HEADER,
  parseSccTable,
  sanityGateProblems,
  toCsv,
  toMeta,
  toMetaJson,
  type SccRow,
  type ParsedSccTable,
  type SanityGateOptions,
  type SccSourceHeaders,
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

// The validators a conditional request sends back to the server, read from the
// committed metadata's sourceHeaders (see buildConditionalRequestHeaders below).
// Either, both, or neither may be present depending on what the server sent on
// the fetch that produced the committed table.
export interface ConditionalValidators {
  etag?: string;
  lastModified?: string;
}

export interface FetchPageOptions {
  userAgent?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  // When set, the raw response body and a headers record are written here for
  // the run to retain as a diagnostic artefact — BEFORE any validation runs,
  // so a rejected response (bad status, challenge page) still leaves behind
  // exactly what the fetcher saw. Never committed: the page's authored prose
  // is RSGB copyright; this is debugging material, not archive material.
  diagnosticsDir?: string;
  // When set, sends If-None-Match / If-Modified-Since so an unchanged upstream
  // page can answer 304 rather than resending the ~68 KB body. Callers build
  // this from the committed metadata (buildConditionalRequestHeaders); never
  // from an unvalidated source, since a spurious 304 would suppress a real
  // change.
  conditional?: ConditionalValidators;
}

// The response headers worth retaining for debugging: change signals (etag /
// last-modified / date), identity (server, content-type/length) and caching
// behaviour (cache-control, expires, vary). Enumerated rather than dumping all
// headers so the test double's minimal `get()` interface suffices.
const DIAGNOSTIC_HEADERS = [
  'etag', 'last-modified', 'date', 'content-type', 'content-length',
  'server', 'cache-control', 'expires', 'vary',
] as const;

export interface FetchDiagnostics {
  url: string;
  fetchedAt: string;
  status: number;
  headers: Record<string, string | null>;
  // False for a 304: the response carries no body by HTTP semantics, so
  // page.shtml is not written and the artefact says so rather than silently
  // omitting the file with no explanation.
  hasBody: boolean;
}

export function writeFetchDiagnostics(dir: string, diagnostics: FetchDiagnostics, body: string | undefined): void {
  fs.mkdirSync(dir, { recursive: true });
  if (body !== undefined) fs.writeFileSync(path.join(dir, 'page.shtml'), body);
  fs.writeFileSync(path.join(dir, 'headers.json'), JSON.stringify(diagnostics, null, 2) + '\n');
}

// The outcome of a page fetch: either the server returned the page (status 200,
// gated below for content-type and challenge markers), or it confirmed the
// conditional request's validators still match (status 304, no body — the
// "provably unchanged" signal, stronger and cheaper than a byte-compare). Any
// other status throws.
export type FetchedSccPage =
  | { status: 200; body: string; headers: Record<string, string | null> }
  | { status: 304; headers: Record<string, string | null> };

// Fetch the page, following redirects, with the honest UA and a timeout. Rejects
// loudly on a status outside {200, 304}, an unexpected content-type, or a body
// that looks like an HTML challenge/gate page (all regression signals for a
// host that is currently a plain, ungated Apache server).
export async function fetchSccPage(url: string = SCC_SOURCE_URL, opts: FetchPageOptions = {}): Promise<FetchedSccPage> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const userAgent = opts.userAgent ?? defaultUserAgent();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const requestHeaders: Record<string, string> = { 'User-Agent': userAgent, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8' };
  if (opts.conditional?.etag !== undefined) requestHeaders['If-None-Match'] = opts.conditional.etag;
  if (opts.conditional?.lastModified !== undefined) requestHeaders['If-Modified-Since'] = opts.conditional.lastModified;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: FetchLikeResponse;
  try {
    response = await fetchImpl(url, {
      headers: requestHeaders,
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

  // A 304 carries no body by HTTP semantics, regardless of what a test double's
  // text() might resolve to; treat it as absent rather than reading it.
  const hasBody = response.status !== 304;
  const body = hasBody ? await response.text() : '';

  // Read the body and persist diagnostics BEFORE any validation: a rejected
  // response is exactly the one worth inspecting later (why does the runner's
  // view differ from a local browser or curl?).
  const headers: Record<string, string | null> = {};
  for (const name of DIAGNOSTIC_HEADERS) headers[name] = response.headers.get(name);
  if (opts.diagnosticsDir !== undefined) {
    writeFetchDiagnostics(opts.diagnosticsDir, {
      url,
      fetchedAt: new Date().toISOString(),
      status: response.status,
      headers,
      hasBody,
    }, hasBody ? body : undefined);
  }

  if (response.status === 304) {
    return { status: 304, headers };
  }
  if (response.status !== 200) {
    throw new Error(`SCC fetch aborted: ${url} returned status ${response.status} (expected 200 or, for a conditional request, 304)`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType !== '' && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    throw new Error(`SCC fetch aborted: ${url} returned unexpected content-type "${contentType}" (expected HTML)`);
  }
  assertNotChallengePage(body);
  return { status: 200, body, headers };
}

// The committed metadata's sourceHeaders, filtered down to the two validators a
// conditional request can use, and only when both a committed table and its
// metadata exist — a fresh/first-ever run has nothing to validate against and
// must not send conditional headers blindly (an accidental If-None-Match match
// against unrelated state would wrongly suppress the initial fetch). Malformed
// input (wrong types, e.g. from hand-edited or corrupted metadata) is treated
// as absent rather than thrown: falling back to an unconditional fetch is
// always safe, sending a bad validator is not.
export function buildConditionalRequestHeaders(meta: unknown): ConditionalValidators | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined;
  const sourceHeaders = (meta as { sourceHeaders?: unknown }).sourceHeaders;
  if (typeof sourceHeaders !== 'object' || sourceHeaders === null) return undefined;
  const raw = sourceHeaders as { etag?: unknown; lastModified?: unknown };
  const etag = typeof raw.etag === 'string' && raw.etag.length > 0 ? raw.etag : undefined;
  const lastModified = typeof raw.lastModified === 'string' && raw.lastModified.length > 0 ? raw.lastModified : undefined;
  if (etag === undefined && lastModified === undefined) return undefined;
  return { etag, lastModified };
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
// empty list when no committed table exists yet (the first-ever run). The
// fields are read by position, so the header is asserted first: a re-shaped
// file (hand edit, schema change without a matching reader change) read
// positionally would silently transpose every field, and a wrong diff is worse
// than an aborted run.
export function readCommittedRows(csvPath: string = SCC_CSV_PATH): SccRow[] {
  if (!fs.existsSync(csvPath)) return [];
  const text = fs.readFileSync(csvPath, 'utf8');
  const lines = text.split('\n').filter((l) => l.length > 0);
  const expectedHeader = SCC_CSV_HEADER.join(',');
  if (lines[0] !== expectedHeader) {
    throw new Error(
      `committed SCC table ${csvPath} does not open with the expected header "${expectedHeader}" (found "${lines[0] ?? '(empty file)'}") — refusing to read fields by position from a re-shaped file`,
    );
  }
  const rows: SccRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    // Minimal CSV read matching toCsv's minimal-quoting output; the notes column
    // may be quoted, so split on the first three unquoted commas only.
    const cells = parseCsvLine(lines[i]);
    if (cells.length !== SCC_CSV_HEADER.length) {
      throw new Error(
        `committed SCC table ${csvPath} line ${i + 1} has ${cells.length} field(s), expected ${SCC_CSV_HEADER.length} — refusing to mis-map a malformed row`,
      );
    }
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

// Discriminated on notModified: a 304 short-circuits before any parsing, so
// there is no ParsedSccTable to offer and changed is always false (nothing was
// fetched to compare or promote).
export type IntakeResult =
  | { notModified: true; csv: string; metaJson: string; diff: SccDiff; changed: false }
  | { notModified: false; parsed: ParsedSccTable; csv: string; metaJson: string; diff: SccDiff; changed: boolean };

// The committed metadata, parsed for the conditional-request validators.
// Anything short of a well-formed JSON object (missing file, corrupt JSON) is
// "no metadata to read" rather than a thrown error — the caller falls back to
// an unconditional fetch, which is always the safe default.
function readCommittedMeta(metaPath: string): unknown {
  if (!fs.existsSync(metaPath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    return undefined;
  }
}

// The etag/last-modified worth carrying forward into the next fetch's
// conditional request, from the raw response headers this fetch saw. Absent
// headers (a null get()) are dropped rather than recorded as null.
function extractSourceHeaders(headers: Record<string, string | null>): SccSourceHeaders {
  const result: SccSourceHeaders = {};
  const etag = headers['etag'];
  const lastModified = headers['last-modified'];
  const date = headers['date'];
  if (etag !== null && etag !== undefined) result.etag = etag;
  if (lastModified !== null && lastModified !== undefined) result.lastModified = lastModified;
  if (date !== null && date !== undefined) result.date = date;
  return result;
}

// The full intake: fetch, gate, build the artefacts, diff against the committed
// table, and (unless dryRun) promote atomically. Throws on any gate failure. The
// paths and sanity band default to production values; they are injectable so the
// tests exercise the real gate, promotion and diff against a temp directory.
//
// Conditional requests (issue #716): when a committed table and metadata carry
// an ETag/Last-Modified, the fetch sends If-None-Match/If-Modified-Since. A 304
// answer is recorded as "provably unchanged" - stronger and cheaper than a
// byte-compare - and the run writes nothing. A 200 proceeds exactly as before
// (parse, gate, diff, promote-if-changed).
export async function runSccIntake(opts: {
  fetchImpl?: FetchLike;
  userAgent?: string;
  now?: Date;
  dryRun?: boolean;
  csvPath?: string;
  metaPath?: string;
  sanityOptions?: SanityGateOptions;
  diagnosticsDir?: string;
} = {}): Promise<IntakeResult> {
  const csvPath = opts.csvPath ?? SCC_CSV_PATH;
  const metaPath = opts.metaPath ?? SCC_META_PATH;

  const csvExists = fs.existsSync(csvPath);
  // Only ever sent when a committed table exists to validate against - a
  // first-ever run (or one where the CSV has gone missing) must not send
  // conditional headers blindly.
  const conditional = csvExists ? buildConditionalRequestHeaders(readCommittedMeta(metaPath)) : undefined;

  const fetched = await fetchSccPage(SCC_SOURCE_URL, { fetchImpl: opts.fetchImpl, userAgent: opts.userAgent, diagnosticsDir: opts.diagnosticsDir, conditional });

  if (fetched.status === 304) {
    // Trustworthy only when the table it is vouching for is actually present;
    // if the committed CSV or metadata has gone missing, the 304 describes
    // state this run cannot verify, so it fails loud rather than reporting a
    // false "unchanged".
    if (!csvExists || !fs.existsSync(metaPath)) {
      throw new Error('SCC fetch aborted: server reported 304 Not Modified but the committed table and/or its metadata is missing - nothing to treat as unchanged');
    }
    return {
      notModified: true,
      csv: fs.readFileSync(csvPath, 'utf8'),
      metaJson: fs.readFileSync(metaPath, 'utf8'),
      diff: { added: [], removed: [], changed: [] },
      changed: false,
    };
  }

  const parsed = parseSccTable(fetched.body);

  const problems = sanityGateProblems(parsed, opts.sanityOptions);
  if (problems.length > 0) {
    throw new Error(`SCC sanity gate failed; aborting before touching the tracked files:\n  - ${problems.join('\n  - ')}`);
  }

  const fetchedAt = (opts.now ?? new Date()).toISOString();
  const csv = toCsv(parsed.rows);
  const metaJson = toMetaJson(toMeta(parsed, { fetchedAt, headers: extractSourceHeaders(fetched.headers) }));

  const previous = readCommittedRows(csvPath);
  const diff = diffSccTables(previous, parsed.rows);

  const existingCsv = csvExists ? fs.readFileSync(csvPath, 'utf8') : '';
  const changed = existingCsv !== csv;

  // Promote ONLY when the table itself changed: meta.json records the fetch
  // that produced the COMMITTED table (its provenance), not the latest poll -
  // otherwise every scheduled run would churn fetchedAt and open a monthly
  // no-op PR (observed on the first production dispatch).
  if (opts.dryRun !== true && changed) {
    promoteAtomically(csvPath, csv);
    promoteAtomically(metaPath, metaJson);
  }
  return { notModified: false, parsed, csv, metaJson, diff, changed };
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
  if (result.notModified) {
    return [
      'Server reported 304 Not Modified: provably unchanged (stronger and cheaper than a byte-compare); nothing fetched or promoted.',
      'Change vs committed table: no change',
    ].join('\n');
  }
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
  // SCC_DIAGNOSTICS_DIR (set by the sweep workflow) retains the raw response
  // as a run artefact for debugging; unset means no diagnostics are written.
  const diagnosticsDir = process.env.SCC_DIAGNOSTICS_DIR;
  const result = await runSccIntake({ dryRun, diagnosticsDir: diagnosticsDir === undefined || diagnosticsDir === '' ? undefined : diagnosticsDir });
  process.stdout.write(`${summariseIntake(result)}\n`);
  if (!dryRun && !result.notModified && result.changed) {
    process.stdout.write(`Wrote ${SCC_CSV_PATH}\nWrote ${SCC_META_PATH}\n`);
  }
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
