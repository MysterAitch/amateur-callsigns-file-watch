/**
 * Reusable "fold a committed report from the claim data via DuckDB" primitive
 * (issue #361). The claim-ledger thesis is that every published table is a FOLD
 * over the underlying claims; this module is the shared machinery that lets a
 * report generator express that fold as SQL and stay byte-deterministic.
 *
 * Posture (ADR 0002): DuckDB enters CI as a PINNED, checksum-verified static CLI
 * binary installed by .github/actions/setup-duckdb — never a native-build npm
 * dependency, so `npm ci` still runs no compile step and `ignore-scripts` holds.
 * The binary is located through DUCKDB_BIN (what the action exports) or `duckdb`
 * on PATH, so a developer with the CLI installed reproduces CI exactly.
 *
 * Byte-determinism is the whole contract: a folded report is only a drift signal
 * if it regenerates identically run to run. Two rules make that hold — every
 * query feeding committed output MUST carry a total ORDER BY (result-set order
 * is otherwise unspecified), and any fold that resolves a last-writer-wins map
 * off source order MUST pin `SET threads TO 1` so a row ordinal reflects file
 * order. A generator that cannot satisfy these has no business being folded.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { errorMessage } from '../shared/utils.ts';
import { parseJsonArray } from '../shared/json-shape.ts';

// The DuckDB CLI to invoke: the pinned binary the setup-duckdb action installs
// (via DUCKDB_BIN), else a `duckdb` already on PATH for local runs.
export function duckDbBinary(): string {
  return process.env.DUCKDB_BIN ?? 'duckdb';
}

// Whether the CLI can be invoked at all. Report folds hard-fail without it (a
// missing engine is not a reason to emit a silently-different report); tests use
// this to skip the DuckDB-backed cases where the binary is absent rather than
// pretend to have verified them.
export function duckDbAvailable(): boolean {
  try {
    execFileSync(duckDbBinary(), ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Names a per-fold DuckDB thread cap. DuckDB defaults `threads` to the core
// count, which is optimal for a fold running ALONE (it uses every core) but ruins
// the report sweep's worker-parallel path: N folds at once each spawn ~cores
// threads, oversubscribing an N-core runner N-fold, and every fold then runs
// ~2-3x slower (measured on the #929 / PR #947 parallel golden run). The sweep
// sets this to '1' for the span it runs folds concurrently (report-sweep.ts), so
// N single-threaded folds match the N cores; off that path it is unset and folds
// keep the default. A non-positive or non-numeric value is ignored (no preamble).
export const REPORT_FOLD_THREADS_ENV = 'REPORT_FOLD_THREADS';

// Names a per-fold DuckDB memory budget (issue #929, following PR #951's
// thread-pinning result). Pinning threads left the parallel golden run
// unchanged (~37 min, same as unpinned), which points the contention at
// memory/IO rather than CPU: four concurrent DuckDB CLI processes, each with
// no memory ceiling, can spill and thrash the shared page cache over the same
// parquet scans. Setting a per-fold budget bounds the spill instead. Sibling
// mechanism to REPORT_FOLD_THREADS: the sweep sets this for the concurrent
// region only (report-sweep.ts), restored afterwards, so a fold running alone
// keeps DuckDB's default. A value DuckDB would not accept as a memory size is
// ignored (no preamble) rather than handed to the engine unvalidated.
export const REPORT_FOLD_MEMORY_LIMIT_ENV = 'REPORT_FOLD_MEMORY_LIMIT';

// The `SET threads TO <n>;` preamble REPORT_FOLD_THREADS requests, or '' when it
// names no positive integer. Prepended to every fold script: a fold that pins its
// own `SET threads TO 1` for last-writer-wins ordering still issues that AFTER
// this preamble, and the later SET wins, so a correctness-pinned fold is never
// loosened — this preamble only constrains the otherwise-default folds.
function foldThreadsPreamble(): string {
  const configured = process.env[REPORT_FOLD_THREADS_ENV];
  if (configured === undefined || configured.trim() === '') return '';
  const parsed = Number.parseInt(configured, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return '';
  return `SET threads TO ${parsed}; `;
}

// A DuckDB memory-size literal: a positive decimal magnitude followed by a
// recognised byte-unit suffix (decimal B/KB/MB/GB/TB or the binary Ki/Mi/Gi/Ti
// variants DuckDB also accepts), case-insensitive. Deliberately stricter than
// DuckDB's own parser — which accepts a bare `0GB` (an immediate
// out-of-memory budget) or a leading `-` (silently reinterpreted as an
// enormous limit rather than rejected) — because this string is spliced
// straight into the script rather than bound as a parameter.
const MEMORY_LIMIT_PATTERN = /^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|KIB|MIB|GIB|TIB)$/i;

// The `SET memory_limit='<value>';` preamble REPORT_FOLD_MEMORY_LIMIT requests,
// or '' when it names no positive memory size. Prepended alongside the threads
// preamble: a fold that pins its own `SET memory_limit=...` still issues that
// AFTER this preamble, so the later SET wins and a correctness-pinned fold's
// budget is never overridden — mirrors foldThreadsPreamble's last-writer-wins
// contract exactly.
function foldMemoryLimitPreamble(): string {
  const configured = process.env[REPORT_FOLD_MEMORY_LIMIT_ENV];
  if (configured === undefined) return '';
  const trimmed = configured.trim();
  const match = MEMORY_LIMIT_PATTERN.exec(trimmed);
  if (match === null || Number.parseFloat(match[1]) <= 0) return '';
  return `SET memory_limit='${trimmed}'; `;
}

// What a failed child process actually reported, drawn from the fields an
// execFileSync error carries beyond its message. Without this the thrown error
// says only "Command failed: <the whole SQL script>" — which names the query but
// not the reason, so the two failures that matter most are indistinguishable
// from a malformed query: DuckDB exiting with a diagnostic on stderr, and DuckDB
// being KILLED (no stderr at all, only a signal — what an out-of-memory kill
// looks like from here). Reporting the signal, the exit status and any stderr
// makes the failure locatable from a CI log instead of a guess.
export function describeSpawnFailure(err: unknown): string {
  if (typeof err !== 'object' || err === null) return '';
  const detail = err as Record<string, unknown>;
  const parts: string[] = [];
  const signal = detail.signal;
  if (typeof signal === 'string' && signal !== '') {
    parts.push(`killed by signal ${signal} (a kill with no diagnostic is characteristically the out-of-memory killer)`);
  }
  const status = detail.status;
  if (typeof status === 'number') parts.push(`exit status ${status}`);
  const stderr = detail.stderr;
  const stderrText = typeof stderr === 'string' ? stderr : Buffer.isBuffer(stderr) ? stderr.toString('utf8') : '';
  const trimmedStderr = stderrText.trim();
  parts.push(trimmedStderr === '' ? 'no stderr output' : `stderr: ${trimmedStderr.slice(0, 2000)}`);
  return ` DuckDB reported: ${parts.join('; ')}.`;
}

// Run one SQL script against an in-memory DuckDB and parse its JSON result set.
// `-json` emits the final statement's rows as a JSON array (leading PRAGMA/SET
// statements return no rows and contribute nothing), so a script may open with
// `SET threads TO 1;` before its single result-bearing query.
export function foldQuery<Row>(sql: string): Row[] {
  const binary = duckDbBinary();
  const script = foldThreadsPreamble() + foldMemoryLimitPreamble() + sql;
  let stdout: string;
  try {
    stdout = execFileSync(binary, ['-json', ':memory:', script], { maxBuffer: 1 << 30, encoding: 'utf8' });
  } catch (err) {
    throw new Error(
      `DuckDB fold failed (binary: ${binary}). Install the pinned CLI via .github/actions/setup-duckdb `
      + `or set DUCKDB_BIN to a DuckDB executable.${describeSpawnFailure(err)} Cause: ${errorMessage(err)}`,
    );
  }
  const trimmed = stdout.trim();
  return trimmed === '' ? [] : parseJsonArray(trimmed, `${binary} -json result`) as Row[];
}

// A DuckDB list literal of file paths for read_csv([...]). Paths are normalised
// to forward slashes (DuckDB accepts them on every platform) and are repo-
// internal archive paths, so no quote-escaping beyond the single quotes is
// needed.
export function csvFileList(files: readonly string[]): string {
  return `[${files.map(file => `'${file.replace(/\\/g, '/')}'`).join(', ')}]`;
}

// The claim-ledger column schema every fold reads, DECLARED rather than sniffed:
// raw claims omit the optional `rule`, so a sampled inference over JSONL would
// miss it. Pinning the columns makes `rule` present-and-NULL wherever a claim
// asserts none, and — the property issue #403 turns on — makes a fold's SQL the
// SAME whether its claim rows arrive as per-source JSONL (read_json) or as the
// shared deploy-time Parquet (read_parquet), which build-ledger-db writes with
// this identical column set.
export const LEDGER_COLUMNS = "{layer: 'VARCHAR', rawSubject: 'VARCHAR', predicate: 'VARCHAR', object: 'VARCHAR', sourceFile: 'VARCHAR', ordinal: 'BIGINT', vintage: 'VARCHAR', rule: 'VARCHAR'}";

// Where a fold reads its claim rows from — two shapes behind one query surface:
//   - 'parquet': the single claims.parquet build-ledger-db emits ONCE per deploy
//     run, shared across every report fold (issue #403), so the multi-GB ledger
//     is materialised once rather than re-emitted per report.
//   - 'ledger': a directory of per-source JSONL ledgers (the shape build-ledger
//     writes into <outputDir>/ledger/) — the on-demand fallback for local dev,
//     tests, and any run where the pre-built Parquet is absent.
export type ClaimsSource =
  | { readonly kind: 'parquet'; readonly path: string }
  | { readonly kind: 'ledger'; readonly dir: string };

// Normalise a fold's public argument to a ClaimsSource: a bare string is a ledger
// directory (the long-standing signature the tests and CLI mains pass), an object
// is already a source. Lets every fold accept a Parquet source without breaking a
// single string-dir caller.
export function toClaimsSource(source: string | ClaimsSource): ClaimsSource {
  return typeof source === 'string' ? { kind: 'ledger', dir: source } : source;
}

// The DuckDB relation expression yielding a source's claim rows. A fold splices
// this in place of its former inline read_json(...), so the SAME fold SQL runs
// over the shared Parquet or an on-demand JSONL ledger — the byte-identity
// contract (issue #403) rests on both relations exposing LEDGER_COLUMNS.
export function claimsRelation(source: ClaimsSource): string {
  if (source.kind === 'parquet') {
    return `read_parquet('${source.path.replace(/\\/g, '/').replace(/'/g, "''")}')`;
  }
  const glob = path.join(source.dir, '*.jsonl').replace(/\\/g, '/').replace(/'/g, "''");
  return `read_json('${glob}', format='newline_delimited', columns=${LEDGER_COLUMNS})`;
}

// Whether a source holds any claims to fold. An absent/empty ledger yields the
// empty report rather than reaching DuckDB, whose read_json errors on a glob that
// matches nothing; read_parquet on a present file never errors, so a Parquet
// source counts as present iff its file exists. Folds guard on this exactly as
// they did on the JSONL-directory check.
export function claimsSourcePresent(source: ClaimsSource): boolean {
  if (source.kind === 'parquet') return fs.existsSync(source.path);
  return fs.existsSync(source.dir) && fs.readdirSync(source.dir).some(name => name.endsWith('.jsonl'));
}

// The environment variable naming the shared deploy-time claims.parquet. The
// workflow step that builds the Parquet once (issue #403) exports it; folds read
// it here so their call sites never change.
export const CLAIMS_PARQUET_ENV = 'CLAIMS_PARQUET';

// The shared deploy-time Parquet source when one is configured and present, else
// null (local dev, tests, any run without the pre-built artefact). A fold given
// no explicit ledger directory consults this: present → read the shared Parquet
// once; null → materialise the ledger on demand exactly as before.
export function deployClaimsSource(): ClaimsSource | null {
  const configured = process.env[CLAIMS_PARQUET_ENV];
  if (configured === undefined || configured.trim() === '') return null;
  return fs.existsSync(configured) ? { kind: 'parquet', path: configured } : null;
}

// The SQL that reproduces cleanedCallsign() from components.ts — uppercase, then
// strip everything outside A-Z/0-9/`/`. It is the join key the whole cross-
// publication model turns on, so folds compute it in SQL rather than re-deriving
// it by hand. Kept here (not in the report module) because every callsign-keyed
// report fold needs the identical expression.
export function cleanedKeyExpr(column = 'callsign'): string {
  return `regexp_replace(upper(${column}), '[^A-Z0-9/]', '', 'g')`;
}
