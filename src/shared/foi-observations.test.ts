import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { buildFoiObservations, renderObservationsCsv, renderObservationsCsvBuffer, OBSERVATION_VALUE_COLUMNS } from './foi-observations.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The observations projection (issue #149 item 4) is the presentation-
// stratum union the schema decision kept out of committed files: null =
// column not asserted by the source file, '' = source asserted a blank.
// These tests run against the real archive - the projection is derived,
// so real-data invariants are its contract.

const REAL_FOI_DIR = path.resolve(import.meta.dirname, '..', '..', 'archive', 'foi');

describe('FOI observations projection', { tags: ['unit'] }, () => {
  const rows = buildFoiObservations(REAL_FOI_DIR);

  it('FoiObservations_RealArchive_ProjectsEveryCallsignBearingNormalisedRow', () => {
    // All callsign-bearing normalised files project; suffix-lists, counts
    // and database-fields (no callsign column) do not. The register
    // snapshots alone contribute hundreds of thousands of rows.
    expect(rows.length).toBeGreaterThan(500000);
    const entries = new Set(rows.map(r => r.entry));
    expect(entries.has('wdtk-596532--allocated-reserved-forbidden')).toBe(true);
    expect(entries.has('ofcom-498906--reciprocal-licences-since-2010')).toBe(true);
    // Record-only entries contribute nothing.
    expect(entries.has('ofcom-518689--suffix-availability-not-held')).toBe(false);
  });

  it('FoiObservations_NotAssertedVsAssertedBlank_AreDistinct', () => {
    // The 2019-08 register asserts six BLANK statuses ('' - data), while
    // the re-issue events file has no status column at all (null).
    const registerBlank = rows.find(r => r.entry === 'wdtk-596532--allocated-reserved-forbidden' && r.values['status'] === '');
    expect(registerBlank).toBeDefined();
    const eventRow = rows.find(r => r.entry === 'ofcom-498903--reissued-callsigns-since-2010');
    expect(eventRow?.values['status']).toBeNull();
    expect(eventRow?.values['event']).toBe('reissued');
  });

  it('FoiObservations_SuffixShapedLists_JoinViaConstructedCallsign', () => {
    // The 2013 available lists constructed callsigns from the sheet's own
    // stated prefix - those rows join the projection by callsign like any
    // register row, carrying their suffix extension.
    const constructed = rows.find(r => r.entry === 'wdtk-174341--available-callsigns-list' && r.values['suffix'] !== null);
    expect(constructed).toBeDefined();
    expect(constructed?.callsign).toBe(`M6${constructed?.values['suffix']}`);
    expect(constructed?.values['status']).toBe('Available');
  });

  it('FoiObservationsCsv_Rendering_FlattensNullsWithFullHeader', () => {
    const sample = rows.slice(0, 3);
    const csv = renderObservationsCsv(sample);
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe(['callsign', 'entry', 'source_file', 'dataset_classes', 'vintage', ...OBSERVATION_VALUE_COLUMNS].join(','));
    expect(lines).toHaveLength(4);
    // Every data line has the full column count (nulls flattened to '').
    expect(lines[1].split(',').length).toBeGreaterThanOrEqual(5 + OBSERVATION_VALUE_COLUMNS.length);
  });

  it('FoiObservationsCsvBuffer_MatchesStringRendererByteForByte_AcrossBatchBoundaries', () => {
    // The whole-archive union exceeds V8's maximum single-string length, so
    // the published union is assembled as a Buffer in row batches. It must be
    // byte-identical to the string renderer; a tiny batch size forces several
    // batch boundaries so the seam handling is exercised.
    const sample = rows.slice(0, 10);
    const asString = Buffer.from(renderObservationsCsv(sample), 'utf8');
    expect(renderObservationsCsvBuffer(sample, 3).equals(asString)).toBe(true);
    // The default (unbatched-in-practice) path agrees too.
    expect(renderObservationsCsvBuffer(sample).equals(asString)).toBe(true);
  });
});
