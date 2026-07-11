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
import { errorMessage } from '../shared/utils.ts';

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

// Run one SQL script against an in-memory DuckDB and parse its JSON result set.
// `-json` emits the final statement's rows as a JSON array (leading PRAGMA/SET
// statements return no rows and contribute nothing), so a script may open with
// `SET threads TO 1;` before its single result-bearing query.
export function foldQuery<Row>(sql: string): Row[] {
  const binary = duckDbBinary();
  let stdout: string;
  try {
    stdout = execFileSync(binary, ['-json', ':memory:', sql], { maxBuffer: 1 << 30, encoding: 'utf8' });
  } catch (err) {
    throw new Error(
      `DuckDB fold failed (binary: ${binary}). Install the pinned CLI via .github/actions/setup-duckdb `
      + `or set DUCKDB_BIN to a DuckDB executable. Cause: ${errorMessage(err)}`,
    );
  }
  const trimmed = stdout.trim();
  return trimmed === '' ? [] : JSON.parse(trimmed) as Row[];
}

// A DuckDB list literal of file paths for read_csv([...]). Paths are normalised
// to forward slashes (DuckDB accepts them on every platform) and are repo-
// internal archive paths, so no quote-escaping beyond the single quotes is
// needed.
export function csvFileList(files: readonly string[]): string {
  return `[${files.map(file => `'${file.replace(/\\/g, '/')}'`).join(', ')}]`;
}

// The SQL that reproduces cleanedCallsign() from components.ts — uppercase, then
// strip everything outside A-Z/0-9/`/`. It is the join key the whole cross-
// publication model turns on, so folds compute it in SQL rather than re-deriving
// it by hand. Kept here (not in the report module) because every callsign-keyed
// report fold needs the identical expression.
export function cleanedKeyExpr(column = 'callsign'): string {
  return `regexp_replace(upper(${column}), '[^A-Z0-9/]', '', 'g')`;
}
