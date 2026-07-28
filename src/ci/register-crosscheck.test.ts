import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { findStaleRegisterRows, findUnmatchedIngestedRows, REGISTER_FILE } from './register-crosscheck.ts';

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

describe('Source-register cross-check', { tags: ['unit'] }, () => {
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

  it('RegisterCrosscheck_PendingRowKeyedByTitleAndOfcomReferenceOnly_IsFlaggedByOfcomReference', () => {
    // Reproduces the club-callsigns escape (#673): the real
    // ofcom-2020-04-23--club-call-signs entry's own register row is titled by
    // requester name plus its Ofcom FOI reference (00896085) - no
    // `wdtk-{id}`/`ofcom-{ref}`-shaped identifier token anywhere in the first
    // cell (the entry's own identifier is the date "2020-04-23", which sits
    // in the vintage cell, not the title). Under the identifier/data-file-only
    // matcher this row stayed `pending-ingest` unflagged all the way through
    // the disclosure's actual ingestion (#668), caught only by a manual read.
    const synthetic = '| Club callsigns / T-numbers (Billy McFarland, Ofcom 00896085) | 2020-04-23 | pending-ingest | not yet ingested |';
    const rows = findStaleRegisterRows(synthetic);
    expect(rows).toHaveLength(1);
    expect(rows[0].matchedEntry).toBe('ofcom-2020-04-23--club-call-signs');
    expect(rows[0].matchedBy).toBe('ofcom-reference');
  });

  it('RegisterCrosscheck_ProseMentionOfOfcomReferenceOutsideFirstCell_IsNotFlagged', () => {
    // Symmetry with the identifier case: an Ofcom reference cited only in the
    // notes column is context, not a title-cell claim of identity, so it must
    // not flag the row by ofcom-reference.
    const synthetic = '| Some other request | 2020 | pending-ingest | related to Ofcom 00896085, the club-callsigns disclosure |';
    expect(findStaleRegisterRows(synthetic)).toHaveLength(0);
  });

  it('RegisterCrosscheck_LiveRegister_HasNoPendingRowForAnArchivedEntry', () => {
    // The gate (#356): a row still marked pending whose dataset is already in
    // archive/foi is drift. This must stay empty — flip the row to `ingested`
    // in the same PR that archives the entry.
    const stale = findStaleRegisterRows(fs.readFileSync(REGISTER_FILE, 'utf8'));
    expect(stale.map(r => `${r.matchedEntry} (${r.matchedBy})`)).toEqual([]);
  });

  it('RegisterCrosscheck_IngestedRowInFoiSectionMatchingNoEntry_IsFlaggedAsUnmatched', () => {
    // The complementary safety net (#673): a row claiming `ingested` inside an
    // FOI-titled section, whose text names no known entry's identifier,
    // ofcomReference or data file by any axis — a status the archive cannot
    // corroborate, exactly the inverse failure to a pending row that DOES
    // match something.
    const synthetic = [
      '## FOI datasets — register snapshots',
      '',
      '| source | data vintage | status | notes |',
      '|---|---|---|---|',
      '| A dataset nobody archived | 2030-01-01 | ingested | no archive/foi pointer exists for this |',
    ].join('\n');
    const rows = findUnmatchedIngestedRows(synthetic);
    expect(rows).toHaveLength(1);
    expect(rows[0].firstCell).toBe('A dataset nobody archived');
  });

  it('RegisterCrosscheck_IngestedRowInFoiSectionMatchingKnownEntry_IsNotFlagged', () => {
    // The ordinary case: an ingested row citing its real archive/foi pointer
    // (the established convention — "flip to ingested with a pointer") is
    // corroborated and must not be flagged.
    const synthetic = [
      '## FOI datasets — attribute addenda (join by callsign/prefix/suffix)',
      '',
      '| source | date | status | notes |',
      '|---|---|---|---|',
      '| Club callsigns / T-numbers (Billy McFarland, Ofcom 00896085) | 2020-04-23 | ingested | ingested as `archive/foi/ofcom-2020-04-23--club-call-signs` |',
    ].join('\n');
    expect(findUnmatchedIngestedRows(synthetic)).toHaveLength(0);
  });

  it('RegisterCrosscheck_IngestedRowOutsideFoiSection_IsNotFlaggedEvenWhenUnmatched', () => {
    // Scoping guard: the open-data lane keys by date under archive/{date},
    // not archive/foi, so this tool's identifier/ofcomReference/data-file
    // axes can never speak to it. Its rows use the identical bare `ingested`
    // token, so without section-scoping every open-data row would be a false
    // positive here — the live-register gate below depends on this staying
    // correctly scoped.
    const synthetic = [
      '## Open-data register snapshots (source: Ofcom open data page)',
      '',
      '| key | status | notes |',
      '|---|---|---|',
      '| 2022-05-30 | ingested | oldest known publication |',
    ].join('\n');
    expect(findUnmatchedIngestedRows(synthetic)).toHaveLength(0);
  });

  it('RegisterCrosscheck_NonIngestedStatusRowInFoiSectionMatchingNoEntry_IsNotFlagged', () => {
    // `rejected`/`context`/`not-held` rows are legitimate non-matches by
    // design (a rejected request or a not-held answer often has no archive
    // entry at all) — only the literal `ingested` claim is checked.
    const synthetic = [
      '## FOI responses that are records, not datasets',
      '',
      '| source | date | status | notes |',
      '|---|---|---|---|',
      '| A refused request (Someone, 2018-01-12) | 2018-01-12 | rejected | refused, no archive entry |',
    ].join('\n');
    expect(findUnmatchedIngestedRows(synthetic)).toHaveLength(0);
  });

  it('RegisterCrosscheck_PendingRowInTableWithLeadingIndexColumn_KeyCellResolvedByHeaderName', () => {
    // Structural-fragility guard (#977): a table that gains a leading column
    // must not silently shift the identifier match off the title cell — the
    // key cell is resolved from the header's `source` column, not by physical
    // position.
    const synthetic = [
      '| # | source | data vintage | status | notes |',
      '|---|---|---|---|---|',
      '| 7 | WDTK 596532 (someone) | 2019 | pending-ingest | notes |',
    ].join('\n');
    const rows = findStaleRegisterRows(synthetic);
    expect(rows).toHaveLength(1);
    expect(rows[0].firstCell).toBe('WDTK 596532 (someone)');
    expect(rows[0].matchedBy).toBe('identifier');
  });

  it('RegisterCrosscheck_FoiTableWithReorderedColumns_StatusResolvedByHeaderNameNotPosition', () => {
    // Structural-fragility guard (#977): with `status` moved to a different
    // column, a fixed-position read would look at the vintage cell, see no
    // `ingested`, and silently stop checking the table. The status column is
    // resolved from the header, so the unmatched claim is still caught.
    const synthetic = [
      '## FOI datasets — register snapshots',
      '',
      '| source | status | data vintage | notes |',
      '|---|---|---|---|',
      '| A dataset nobody archived | ingested | 2030-01-01 | no archive/foi pointer exists for this |',
    ].join('\n');
    const rows = findUnmatchedIngestedRows(synthetic);
    expect(rows).toHaveLength(1);
    expect(rows[0].firstCell).toBe('A dataset nobody archived');
  });

  it('RegisterCrosscheck_FoiTableHeaderWithoutStatusColumn_FailsLoudNamingTheHeader', () => {
    // Fail loud, not silent: an FOI-section table whose header no longer names
    // a `status` column is a layout this check cannot read — guessing a column
    // would turn every future drift into a silent no-op.
    const synthetic = [
      '## FOI datasets — register snapshots',
      '',
      '| source | date | state | notes |',
      '|---|---|---|---|',
      '| A dataset nobody archived | 2030-01-01 | ingested | no pointer |',
    ].join('\n');
    expect(() => findUnmatchedIngestedRows(synthetic)).toThrow(/no "status" column/);
    expect(() => findUnmatchedIngestedRows(synthetic)).toThrow(/source \| date \| state \| notes/);
  });

  it('RegisterCrosscheck_FoiTableRowWithNoPrecedingHeader_FailsLoudRatherThanGuessingColumns', () => {
    // A table fragment with no header row gives the check nothing to derive
    // the status column from; reading by position would be a guess.
    const synthetic = [
      '## FOI datasets — register snapshots',
      '',
      '| A dataset nobody archived | 2030-01-01 | ingested | no pointer |',
    ].join('\n');
    expect(() => findUnmatchedIngestedRows(synthetic)).toThrow(/no preceding header row/);
  });

  it('RegisterCrosscheck_LiveRegister_HasNoUnmatchedIngestedRowInAnFoiSection', () => {
    // The gate's other half (#673): every row claiming `ingested` inside an
    // FOI-titled section must be corroborated by the archive it claims to
    // describe — an unmatched claim is exactly the club-callsigns failure
    // mode, just discovered from the opposite direction.
    const unmatched = findUnmatchedIngestedRows(fs.readFileSync(REGISTER_FILE, 'utf8'));
    expect(unmatched.map(r => r.firstCell)).toEqual([]);
  });
});
