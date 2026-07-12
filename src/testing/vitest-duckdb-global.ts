/**
 * Vitest global setup (issue #336/#398): emit ONE clear, actionable message
 * when the DuckDB CLI is genuinely unavailable, so a run without it reads as
 * "fold/sweep suites skipped, here is how to enable them" rather than a wall of
 * per-worker noise. Runs once in the main process; the per-worker DUCKDB_BIN
 * bridging lives in vitest-duckdb.ts.
 */

import { resolveBootstrappedDuckdb } from '../tools/setup-duckdb.ts';
import { duckDbAvailable, DUCKDB_SETUP_HINT } from './duckdb.ts';

export default function (): void {
  // Mirror the worker's resolution so the availability probe reflects what the
  // suites will actually see.
  if (!process.env.DUCKDB_BIN) {
    const bootstrapped = resolveBootstrappedDuckdb();
    if (bootstrapped !== undefined) process.env.DUCKDB_BIN = bootstrapped;
  }
  if (!duckDbAvailable()) {
    process.stderr.write(`[duckdb] ${DUCKDB_SETUP_HINT}\n`);
  }
}
