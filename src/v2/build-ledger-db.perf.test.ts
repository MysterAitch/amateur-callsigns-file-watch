import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { perfReset, perfSnapshot } from '../shared/perf.ts';
import {
  buildClaimsParquet,
  findDuckdb,
  LEDGER_EMIT_SPAN,
  PARQUET_COPY_SPAN,
  subsetSelector,
} from './build-ledger-db.ts';

// The shared claim-ledger Parquet build is the longest single step in the CI
// pipeline, and until #991 it carried NO timing spans at all - so its split
// between emitting the JSONL intermediate and DuckDB re-reading it could only
// be inferred from a workstation, never measured on the runner. These tests
// pin the two spans that make the split observable, and pin that profiling
// stays a true pass-through when it is off.
//
// Scoped to the subset selector so they run in seconds rather than minutes:
// the property under test is that the phases are reported separately and
// attributably, which does not depend on corpus size.

const originalPerf = process.env.PERF;

beforeEach(() => {
  perfReset();
});

afterEach(() => {
  perfReset();
  if (originalPerf === undefined) delete process.env.PERF;
  else process.env.PERF = originalPerf;
});

function withTempParquet<T>(fn: (parquetPath: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-perf-'));
  try {
    return fn(path.join(dir, 'claims.parquet'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The Parquet lane needs the DuckDB CLI (ADR 0002). Skipping is honest here:
// a machine without the engine cannot exercise the COPY at all, and asserting
// a fabricated substitute would pin nothing.
const duckdbAvailable = findDuckdb() !== null;

describe('claim-ledger Parquet build profiling', { tags: ['unit'] }, () => {
  it.skipIf(!duckdbAvailable)(
    'ParquetBuild_WhenProfilingEnabled_ReportsLedgerEmitAndParquetCopyAsSeparatePhases',
    () => {
      process.env.PERF = '1';
      withTempParquet(parquetPath => {
        buildClaimsParquet(parquetPath, { selectEntry: subsetSelector() });
      });

      const labels = perfSnapshot().map(row => row.label);
      expect(labels).toContain(LEDGER_EMIT_SPAN);
      expect(labels).toContain(PARQUET_COPY_SPAN);
    },
  );

  it.skipIf(!duckdbAvailable)(
    'ParquetBuild_WhenProfilingEnabled_AttributesTimeToBothPhasesRatherThanOneAggregate',
    () => {
      process.env.PERF = '1';
      withTempParquet(parquetPath => {
        buildClaimsParquet(parquetPath, { selectEntry: subsetSelector() });
      });

      const rows = perfSnapshot();
      const emit = rows.find(row => row.label === LEDGER_EMIT_SPAN);
      const copy = rows.find(row => row.label === PARQUET_COPY_SPAN);

      // Each phase must be called exactly once per build and carry its own
      // elapsed time. A span that reported zero calls, or that swallowed the
      // other phase, would leave the split as unmeasurable as it was before.
      expect(emit?.calls).toBe(1);
      expect(copy?.calls).toBe(1);
      expect(emit?.totalMs).toBeGreaterThan(0);
      expect(copy?.totalMs).toBeGreaterThan(0);
    },
  );

  it.skipIf(!duckdbAvailable)(
    'ParquetBuild_WhenProfilingDisabled_RecordsNothing',
    () => {
      delete process.env.PERF;
      withTempParquet(parquetPath => {
        buildClaimsParquet(parquetPath, { selectEntry: subsetSelector() });
      });

      // The harness lives permanently on a production build path, so "off"
      // must mean no accumulation at all, not merely no output.
      expect(perfSnapshot()).toEqual([]);
    },
  );

  it('ParquetBuild_SpanLabels_AreDistinctSoNeitherPhaseMasksTheOther', () => {
    expect(LEDGER_EMIT_SPAN).not.toBe(PARQUET_COPY_SPAN);
  });
});
