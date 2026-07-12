/**
 * Vitest setup file (issue #336/#398): make the DuckDB-backed suites find the
 * binary a contributor bootstrapped with `npm run setup:duckdb`, and report an
 * honest, actionable message when none is available.
 *
 * Runs in each test worker BEFORE the test files are collected, so the
 * DUCKDB_BIN it exports is visible to the `describe.skipIf(!duckDbAvailable())`
 * guards evaluated at collection time. In CI the action has already exported
 * DUCKDB_BIN, so this is a no-op there; locally it bridges the repo-local
 * `.duckdb/` install to the same env var the tests already read.
 */

import { resolveBootstrappedDuckdb } from '../tools/setup-duckdb.ts';

// Prefer an explicit DUCKDB_BIN (CI, or a contributor's own install); otherwise
// fall back to the repo-local bootstrapped binary if one is present. Silent by
// design - the single "not installed" warning is emitted once by the global
// setup (vitest-duckdb-global.ts), not per worker.
if (!process.env.DUCKDB_BIN) {
  const bootstrapped = resolveBootstrappedDuckdb();
  if (bootstrapped !== undefined) process.env.DUCKDB_BIN = bootstrapped;
}
