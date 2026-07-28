/**
 * One shared claims Parquet for the whole test run (issue #478).
 *
 * The real-archive fold/build suites each used to re-materialise the ENTIRE
 * archive to ~11 GB of JSONL in their own `beforeAll` (buildLedger ~98 s each),
 * then DuckDB `read_json`'d all of it. With ~6 such files that redundancy is the
 * bulk of the ~1 h `tests` job. Instead we build the claims ONCE (globalSetup),
 * fold them into a compact columnar Parquet, and point the folds at it via
 * CLAIMS_PARQUET (their existing `deployClaimsSource()` path, #403) - so every
 * fold reads the same pre-built artefact and re-materialises nothing.
 *
 * Rebuilt fresh each run (no cross-run cache yet - the follow-up actions/cache
 * layer), so it can never be stale. JSONL stays the canonical intermediate; this
 * Parquet is a throwaway derived read-layer.
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

// Fixed per-machine path so globalSetup (which builds it) and the per-worker
// setup (which exports CLAIMS_PARQUET from it) agree without any IPC. Kept as a
// light top-level export; the heavy build modules load lazily in the builder.
export const SHARED_CLAIMS_PARQUET = path.join(os.tmpdir(), 'acf-shared-claims', 'claims.parquet');

// Build the shared Parquet once: materialise every archive source's claims to
// JSONL in a temp dir, fold to a compact zstd Parquet, then drop the JSONL.
// `skipFailedSources` matches the fold builders' own materialisation path. The
// builders are dynamically imported so merely reading SHARED_CLAIMS_PARQUET (in
// the per-worker setup) does not pull the emit pipeline into every worker.
export async function buildSharedClaimsParquet(): Promise<void> {
  const { buildLedger } = await import('../v2/build-ledger.ts');
  const { emitClaimsParquet } = await import('../v2/build-ledger-db.ts');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acf-claims-build-'));
  try {
    buildLedger(dir, undefined, undefined, undefined, true);
    fs.mkdirSync(path.dirname(SHARED_CLAIMS_PARQUET), { recursive: true });
    emitClaimsParquet(path.join(dir, 'ledger'), SHARED_CLAIMS_PARQUET);
  } finally {
    // Drop the JSONL immediately; only the compact Parquet is kept. It is by far
    // the largest thing the build materialises and it grows with the archive —
    // measured 12.73 GiB at 2026-07-28 (55.4M claims), against ~11 GB when this
    // was written, so treat any figure here as a dated observation, not a size.
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
