import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  csvFileList,
  cleanedKeyExpr,
  foldQuery,
  duckDbAvailable,
  claimsRelation,
  claimsSourcePresent,
  toClaimsSource,
  deployClaimsSource,
  LEDGER_COLUMNS,
  CLAIMS_PARQUET_ENV,
  REPORT_FOLD_THREADS_ENV,
} from './report-fold.ts';

// The reusable "fold a report from the claim data via DuckDB" scaffold (issue
// #361). The pure SQL-fragment builders always run; the query runner is gated on
// the pinned CLI being present.

describe('report-fold — SQL fragment builders', { tags: ['unit'] }, () => {
  it('CsvFileList_MixedSlashes_EmitsForwardSlashedDuckDbListLiteral', () => {
    expect(csvFileList(['archive\\a\\normalised.csv', 'archive/b/normalised.csv']))
      .toBe("['archive/a/normalised.csv', 'archive/b/normalised.csv']");
  });

  it('CleanedKeyExpr_DefaultColumn_ReproducesUppercaseAndStripRule', () => {
    // The identical rule cleanedCallsign() applies: uppercase, strip outside
    // A-Z/0-9/`/`. Keeping it here means every callsign-keyed fold shares one
    // expression rather than re-deriving the join key by hand.
    expect(cleanedKeyExpr()).toBe("regexp_replace(upper(callsign), '[^A-Z0-9/]', '', 'g')");
    expect(cleanedKeyExpr('raw_subject')).toBe("regexp_replace(upper(raw_subject), '[^A-Z0-9/]', '', 'g')");
  });
});

describe('report-fold — claims source resolution (issue #403)', { tags: ['unit'] }, () => {
  it('ClaimsRelation_LedgerDirectory_EmitsForwardSlashedReadJsonGlobWithDeclaredColumns', () => {
    // A ledger directory reads its per-source JSONL through read_json with the
    // columns DECLARED (not sniffed), forward-slashed on every platform.
    expect(claimsRelation({ kind: 'ledger', dir: 'a\\b\\ledger' }))
      .toBe(`read_json('a/b/ledger/*.jsonl', format='newline_delimited', columns=${LEDGER_COLUMNS})`);
  });

  it('ClaimsRelation_Parquet_EmitsForwardSlashedReadParquet', () => {
    // The shared deploy-time Parquet reads through read_parquet, which needs no
    // column declaration (Parquet is self-describing) yet exposes the SAME columns
    // — the property the byte-identity guarantee rests on.
    expect(claimsRelation({ kind: 'parquet', path: 'C:\\tmp\\claims.parquet' }))
      .toBe("read_parquet('C:/tmp/claims.parquet')");
  });

  it('ToClaimsSource_BareString_TreatedAsLedgerDirectory', () => {
    expect(toClaimsSource('some/dir')).toEqual({ kind: 'ledger', dir: 'some/dir' });
    expect(toClaimsSource({ kind: 'parquet', path: 'p.parquet' })).toEqual({ kind: 'parquet', path: 'p.parquet' });
  });

  it('ClaimsSourcePresent_ReflectsFilesystemForBothKinds', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claims-present-'));
    try {
      // An empty ledger directory is not present (read_json would error on a glob
      // matching nothing); one holding a .jsonl is.
      expect(claimsSourcePresent({ kind: 'ledger', dir })).toBe(false);
      fs.writeFileSync(path.join(dir, 'x.jsonl'), '');
      expect(claimsSourcePresent({ kind: 'ledger', dir })).toBe(true);
      // A Parquet source is present iff its file exists.
      const parquet = path.join(dir, 'claims.parquet');
      expect(claimsSourcePresent({ kind: 'parquet', path: parquet })).toBe(false);
      fs.writeFileSync(parquet, '');
      expect(claimsSourcePresent({ kind: 'parquet', path: parquet })).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('DeployClaimsSource_EnvUnsetOrMissingFile_YieldsNullSoFoldsFallBackToOnDemand', () => {
    const original = process.env[CLAIMS_PARQUET_ENV];
    try {
      delete process.env[CLAIMS_PARQUET_ENV];
      expect(deployClaimsSource()).toBeNull();
      // A configured-but-absent path is null too: the fold materialises on demand
      // rather than pointing DuckDB at a file that is not there.
      process.env[CLAIMS_PARQUET_ENV] = path.join(os.tmpdir(), 'definitely-absent-claims.parquet');
      expect(deployClaimsSource()).toBeNull();
    } finally {
      if (original === undefined) delete process.env[CLAIMS_PARQUET_ENV];
      else process.env[CLAIMS_PARQUET_ENV] = original;
    }
  });

  it('DeployClaimsSource_EnvNamesExistingFile_YieldsParquetSource', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claims-env-'));
    const parquet = path.join(dir, 'claims.parquet');
    fs.writeFileSync(parquet, '');
    const original = process.env[CLAIMS_PARQUET_ENV];
    try {
      process.env[CLAIMS_PARQUET_ENV] = parquet;
      expect(deployClaimsSource()).toEqual({ kind: 'parquet', path: parquet });
    } finally {
      if (original === undefined) delete process.env[CLAIMS_PARQUET_ENV];
      else process.env[CLAIMS_PARQUET_ENV] = original;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!duckDbAvailable())('report-fold — DuckDB query runner', { tags: ['unit'] }, () => {
  it('FoldQuery_JsonResult_ParsesRowsAndAppliesCleanedRule', () => {
    // A leading SET statement returns no rows and must not pollute the JSON, and
    // the cleaned-key expression must strip a non-break space exactly as the
    // callsign join key does.
    const rows = foldQuery<{ ck: string; n: number }>(
      `SET threads TO 1; SELECT ${cleanedKeyExpr('c')} AS ck, 1 AS n FROM (VALUES ('2e1hon'), ('G6 FMU')) t(c) ORDER BY ck`,
    );
    expect(rows).toEqual([{ ck: '2E1HON', n: 1 }, { ck: 'G6FMU', n: 1 }]);
  });
});

describe.skipIf(!duckDbAvailable())('report-fold — REPORT_FOLD_THREADS pinning (issue #929)', { tags: ['unit'] }, () => {
  // Observe the thread count DuckDB actually ran the fold with. DuckDB reports the
  // effective setting through current_setting('threads'), so a fold reading it
  // proves whether the preamble reached the engine — no core-count assumption, so
  // the expectations hold on a runner of any width.
  function effectiveThreads(): number {
    return foldQuery<{ threads: number }>("SELECT current_setting('threads')::BIGINT AS threads")[0].threads;
  }

  function withFoldThreads<T>(value: string | undefined, run: () => T): T {
    const original = process.env[REPORT_FOLD_THREADS_ENV];
    if (value === undefined) delete process.env[REPORT_FOLD_THREADS_ENV];
    else process.env[REPORT_FOLD_THREADS_ENV] = value;
    try {
      return run();
    } finally {
      if (original === undefined) delete process.env[REPORT_FOLD_THREADS_ENV];
      else process.env[REPORT_FOLD_THREADS_ENV] = original;
    }
  }

  it('FoldQuery_ReportFoldThreadsSetToOne_RunsTheFoldWithASingleThread', () => {
    // The sweep's concurrent region sets '1' so N single-threaded folds match the
    // N cores instead of each spawning ~cores threads and oversubscribing.
    expect(withFoldThreads('1', effectiveThreads)).toBe(1);
  });

  it('FoldQuery_ReportFoldThreadsSetToAValue_HonoursThatCountNotAHardcodedOne', () => {
    // The preamble carries the requested integer through, not a fixed 1 — a
    // deliberately over-subscribed value is honoured so the cap stays a knob.
    expect(withFoldThreads('3', effectiveThreads)).toBe(3);
  });

  it('FoldQuery_ReportFoldThreadsUnset_LeavesDuckDbsDefaultThreadCount', () => {
    // Off the concurrent path — the ~30 sequential unit-suite folds and any solo
    // fold — no preamble is injected, so DuckDB keeps its default (threads=cores,
    // at least one), the fast path for a fold running alone.
    expect(withFoldThreads(undefined, effectiveThreads)).toBeGreaterThanOrEqual(1);
  });

  it('FoldQuery_ReportFoldThreadsBlankOrInvalid_InjectsNoPreambleAndNeverErrors', () => {
    // A blank, zero, or non-numeric value is ignored rather than emitted as a
    // bogus `SET threads TO 0`, which DuckDB would reject: the fold still runs and
    // its own explicit pin governs.
    for (const bogus of ['', '   ', '0', '-2', 'abc']) {
      expect(withFoldThreads(bogus, () =>
        foldQuery<{ threads: number }>("SET threads TO 2; SELECT current_setting('threads')::BIGINT AS threads")[0].threads,
      )).toBe(2);
    }
  });

  it('FoldQuery_FoldPinsItsOwnThreadCount_IsNeverOverriddenByThePreamble', () => {
    // Last-writer-wins: a fold that pins `SET threads TO N` for last-writer-wins
    // ordering issues that AFTER the preamble, so a correctness-pinned fold is
    // never loosened OR tightened by the concurrent-region cap.
    expect(withFoldThreads('1', () =>
      foldQuery<{ threads: number }>("SET threads TO 4; SELECT current_setting('threads')::BIGINT AS threads")[0].threads,
    )).toBe(4);
  });
});
