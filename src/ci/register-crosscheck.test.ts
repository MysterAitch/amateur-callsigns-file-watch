import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { findStaleRegisterRows, REGISTER_FILE } from './register-crosscheck.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The source-register staleness check (issue #149 Phase A) flags pending
// rows whose dataset already exists as an FOI entry. The matching logic is
// exercised against synthetic registers below. In addition, now that the
// ingestion backlog is cleared, the LIVE register is asserted clean (#356):
// this turns the check into a real gate, so an ingestion PR that adds an
// entry but forgets to flip its source-register row to `ingested` fails here.
// (The earlier synthetic-only stance existed only to avoid failing the PR
// that first tidied a then-dirty register; that tidy is complete.)

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

  it('RegisterCrosscheck_LiveRegister_HasNoPendingRowForAnArchivedEntry', () => {
    // The gate (#356): a row still marked pending whose dataset is already in
    // archive/foi is drift. This must stay empty — flip the row to `ingested`
    // in the same PR that archives the entry.
    const stale = findStaleRegisterRows(fs.readFileSync(REGISTER_FILE, 'utf8'));
    expect(stale.map(r => `${r.matchedEntry} (${r.matchedBy})`)).toEqual([]);
  });
});
