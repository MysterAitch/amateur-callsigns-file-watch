/**
 * Vitest global setup (issue #336/#398): emit ONE clear, actionable message
 * when the DuckDB CLI is genuinely unavailable, so a run without it reads as
 * "fold/sweep suites skipped, here is how to enable them" rather than a wall of
 * per-worker noise. Runs once in the main process; the per-worker DUCKDB_BIN
 * bridging lives in vitest-duckdb.ts.
 */

import { resolveBootstrappedDuckdb } from '../tools/setup-duckdb.ts';
import { duckDbAvailable, DUCKDB_SETUP_HINT } from './duckdb.ts';
import { buildSharedClaimsParquet } from './shared-claims.ts';

export default async function (): Promise<void> {
  // Mirror the worker's resolution so the availability probe reflects what the
  // suites will actually see.
  if (!process.env.DUCKDB_BIN) {
    const bootstrapped = resolveBootstrappedDuckdb();
    if (bootstrapped !== undefined) process.env.DUCKDB_BIN = bootstrapped;
  }
  if (!duckDbAvailable()) {
    process.stderr.write(`[duckdb] ${DUCKDB_SETUP_HINT}\n`);
    return;
  }
  // Build the ONE shared claims Parquet the fold suites read (#478), so each of
  // them stops re-materialising the whole archive once per fold - the bulk of
  // the CI `tests` job. Measured when this landed (#478, 2026-07): ~11 GB JSONL
  // and ~98 s per materialisation; the ledger had grown to 12.73 GiB by
  // 2026-07-28, so the saving scales with the archive rather than holding
  // steady. This is a WHOLE-RUN optimisation: it only
  // pays off when the run includes the real-archive fold suites, so it is opt-in
  // (ACF_SHARED_CLAIMS, set by the CI `tests` step). A targeted local run - a
  // single `-t` test, a non-fold file - must NOT pay a full-archive build just to
  // start vitest; without the opt-in the folds keep their on-demand per-suite
  // materialisation exactly as before. Skip too if an outer layer already
  // provided one (e.g. a future actions/cache restore that exports CLAIMS_PARQUET).
  const optedIn = process.env.ACF_SHARED_CLAIMS === '1';
  if (optedIn && !process.env.CLAIMS_PARQUET) {
    const started = Date.now();
    process.stderr.write('[claims] building the shared claims Parquet once for the fold suites…\n');
    await buildSharedClaimsParquet();
    process.stderr.write(`[claims] shared claims Parquet ready in ${((Date.now() - started) / 1000).toFixed(0)}s\n`);
  }
}
