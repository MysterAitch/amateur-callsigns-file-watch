import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { findStaleRegisterRows, REGISTER_FILE } from './register-crosscheck.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The source-register staleness check (issue #149 Phase A) flags pending
// rows whose dataset already exists as an FOI entry. It is heuristic
// tooling for register-tidying commits, deliberately conservative: prose
// mentions of an id outside the first cell must not match.

describe('Source-register cross-check', () => {
  const stale = findStaleRegisterRows(fs.readFileSync(REGISTER_FILE, 'utf8'));

  it('RegisterCrosscheck_KnownIngestedRows_AreFlagged', () => {
    // The three known-stale rows as of Phase A: WDTK 356636, WDTK 596532,
    // and the 2019-09-12 disclosure CSV (ofcom-756622, matched by its
    // declared data filename).
    const matched = new Set(stale.map(row => row.matchedEntry));
    expect(matched).toContain('wdtk-356636--all-callsigns-plus-forbidden');
    expect(matched).toContain('wdtk-596532--allocated-reserved-forbidden');
    expect(matched).toContain('ofcom-756622--published-register-csv');
  });

  it('RegisterCrosscheck_ProseMentionOfIngestedId_IsNotFlagged', () => {
    // The Callsign-database-20-Sep row mentions 356636 in its notes ("9
    // days before the 356636 response") but is genuinely not ingested -
    // context is not ingestion.
    expect(stale.some(row => row.firstCell.includes('Callsign database 20 Sep'))).toBe(false);
    expect(stale.some(row => row.firstCell.includes('Callsign-database-20-Sep'))).toBe(false);
  });

  it('RegisterCrosscheck_SyntheticRegister_MatchesFirstCellIdentifierOnly', () => {
    const synthetic = [
      '| WDTK 596532 (someone) | 2019 | pending-ingest | notes |',
      '| Something else entirely | 2020 | pending-ingest | mentions 596532 in passing |',
      '| Already done | 2021 | ingested | archive/foi pointer |',
    ].join('\n');
    const rows = findStaleRegisterRows(synthetic);
    expect(rows).toHaveLength(1);
    expect(rows[0].firstCell).toBe('WDTK 596532 (someone)');
    expect(rows[0].matchedBy).toBe('identifier');
  });
});
