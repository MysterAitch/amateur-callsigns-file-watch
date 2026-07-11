import { describe, it, expect } from 'vitest';
import { csvFileList, cleanedKeyExpr, foldQuery, duckDbAvailable } from './report-fold.ts';

// The reusable "fold a report from the claim data via DuckDB" scaffold (issue
// #361). The pure SQL-fragment builders always run; the query runner is gated on
// the pinned CLI being present.

describe('report-fold — SQL fragment builders', () => {
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

describe.skipIf(!duckDbAvailable())('report-fold — DuckDB query runner', () => {
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
