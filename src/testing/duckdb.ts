/**
 * Shared test-harness support for the DuckDB-backed suites (issue #336/#398).
 *
 * The report-fold and normalise-sweep tests fold committed reports through the
 * pinned DuckDB CLI. CI installs it via .github/actions/setup-duckdb; a fresh
 * worktree does not. These suites therefore SKIP when the CLI is genuinely
 * unavailable (honestly reported as skipped, never silently passed) and point
 * the reader at the one command that enables them.
 */

// Re-exported so every DuckDB-gated suite gates on one predicate.
export { duckDbAvailable } from '../v2/report-fold.ts';

export const DUCKDB_SETUP_HINT =
  'DuckDB CLI not found - run `npm run setup:duckdb` once to install the pinned binary and enable the fold/sweep tests.';
