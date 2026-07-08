import { describe, it, expect } from 'vitest';
import { findStaleRegisterRows } from './register-crosscheck.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The source-register staleness check (issue #149 Phase A) flags pending
// rows whose dataset already exists as an FOI entry. It is heuristic
// TOOLING for register-tidying commits, deliberately not a CI gate on the
// register's content - so these tests exercise the matching logic against
// synthetic registers only. Asserting the live register's staleness state
// here would fail the very PR that tidies it (learnt the hard way on the
// first tidying commit).

describe('Source-register cross-check', () => {
  it('RegisterCrosscheck_PendingRowNamingIngestedIdInFirstCell_IsFlagged', () => {
    const synthetic = [
      '| WDTK 596532 (someone) | 2019 | pending-ingest | notes |',
      '| Something to fetch | 2020 | pending-fetch | uses 756622 data (`allocated-reserved-forbidden-call-sign-foi-20190912.csv`) |',
    ].join('\n');
    const rows = findStaleRegisterRows(synthetic);
    expect(rows).toHaveLength(2);
    expect(rows[0].matchedEntry).toBe('wdtk-596532--allocated-reserved-forbidden');
    expect(rows[0].matchedBy).toBe('identifier');
    // Data-file mentions anywhere in the row surface as weak candidates.
    expect(rows[1].matchedEntry).toBe('ofcom-756622--published-register-csv');
    expect(rows[1].matchedBy).toBe('data-file');
  });

  it('RegisterCrosscheck_ProseMentionOfIngestedIdOutsideFirstCell_IsNotFlagged', () => {
    // Context is not ingestion: an id cited in the notes column (the real
    // Callsign-database-20-Sep row cites 356636 as a vintage neighbour)
    // must not flag the row by identifier.
    const synthetic = '| Ofcom "Callsign database 20 Sep" xlsx | 2016-09-20 | pending-ingest | export 9 days before the 356636 response |';
    expect(findStaleRegisterRows(synthetic)).toHaveLength(0);
  });

  it('RegisterCrosscheck_IngestedAndNonTableRows_AreIgnored', () => {
    const synthetic = [
      '| WDTK 596532 (someone) | 2019 | ingested | archive/foi pointer |',
      'Prose paragraph mentioning 596532 and pending-ingest outside a table.',
      '| source | data vintage | status | notes |',
    ].join('\n');
    expect(findStaleRegisterRows(synthetic)).toHaveLength(0);
  });
});
