import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractClubCallsignTable } from './pdf-table-extract.ts';

// Self-check for the PDF-table extractor (issue #109 club-callsigns intake).
// Running the committed extractor over the committed disclosure PDF must
// reproduce the committed CSV extract byte-identically - the re-derivation gate.
// A PDF-extractOf extract is (rightly) excluded from the CSV shape-only audit,
// so THIS test is its fidelity guarantee, with the reconciliation arithmetic
// from the extraction's own accounting asserted as encoded assumptions. Test
// names follow Subject_Scenario_Outcome.

const ENTRY_DIR = path.resolve(import.meta.dirname, '..', '..', 'archive', 'foi', 'ofcom-2020-04-23--club-call-signs');
const PDF = path.join(ENTRY_DIR, 'copy-of-club-call-signs-23-04-20.pdf');
const CSV = path.join(ENTRY_DIR, 'club-callsigns.csv');

describe('pdf-table-extract — club-callsigns re-derivation gate', { tags: ['unit'] }, () => {
  const extraction = extractClubCallsignTable(fs.readFileSync(PDF));

  it('ExtractClubCallsignTable_OverCommittedPdf_ReproducesCommittedCsvByteIdentically', () => {
    // The committed CSV was written latin1; its content is pure ASCII, so a
    // utf8 read yields identical bytes to compare against the extraction string.
    const committed = fs.readFileSync(CSV, 'latin1');
    expect(extraction.csv).toBe(committed);
  });

  it('ExtractClubCallsignTable_RowAndTextOpTotals_MatchTheReconciliation', () => {
    // The reconciliation from findings.md: 2049 data rows; the text-show count
    // equals the TJ-operator count, and both reconcile to the rows
    // (1 header x 2 cells + 2037 full rows x 2 + 12 blank-key rows x 1 = 4088).
    expect(extraction.rows).toHaveLength(2049);
    expect(extraction.totalTJ).toBe(4088);
    expect(extraction.totalShows).toBe(4088);
    expect(extraction.headerPages).toEqual([1]);
  });

  it('ExtractClubCallsignTable_StatusBreakdown_MatchesThePerStatusCounts', () => {
    expect(extraction.statusCounts).toEqual({ Live: 1613, Surrendered: 258, Terminated: 178 });
    const total = Object.values(extraction.statusCounts).reduce((a, b) => a + b, 0);
    expect(total).toBe(2049);
  });

  it('ExtractClubCallsignTable_KnownAnomalies_AreSurfacedNotRepaired', () => {
    // 209 callsigns recur (per-licence-record listing, not a per-callsign
    // snapshot); 12 rows carry a status with an empty callsign cell; no column-1
    // token fails the ordinary callsign shape despite the header naming
    // T-numbers; every row assembled unambiguously.
    expect(extraction.duplicateCount).toBe(209);
    expect(extraction.blankKeyCount).toBe(12);
    expect(extraction.oddityCount).toBe(0);
    expect(extraction.ambiguousCount).toBe(0);
  });

  it('ExtractClubCallsignTable_Page1OpeningSequence_MatchesTheAnchor', () => {
    // The page-1 opening sequence (all Live) confirms the extraction landed on
    // the real first records rather than a mis-parse or a dropped continuation.
    expect(extraction.anchorPass).toBe(true);
    expect(extraction.rows.slice(0, 3).map(r => `${r.callsign}/${r.status}`)).toEqual(['M0NUK/Live', 'G3SKY/Live', 'M0SCL/Live']);
  });
});
