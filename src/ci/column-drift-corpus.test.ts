import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  computeColumnDrift,
  openDataVintageCsvs,
  renderColumnDrift,
  COLUMN_DRIFT_PATH,
  type ColumnDrift,
  type ColumnFingerprint,
  type DriftSignal,
} from './column-drift.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';

// Issue #862: the distributional-drift detector validated against the corpus's
// RECORDED ground truth — the known cases must surface from the fingerprints
// ALONE, with no hand-authored expectation naming them: the 2026-01-14
// Z-suffix cohort omission (#564), the #801 mass-update fingerprint on the
// licence-version last-modified column, the blank-product pool shifts, and the
// export-variant/schema drifts (date-format and column populate/empty). Test
// names follow Subject_Scenario_Outcome.
//
// Figures asserted exactly are figures of the COMMITTED archive (immutable
// entries): they change only when a new dataset is ingested, which is exactly
// when this suite should demand a deliberate re-read, like the other
// data-validity goldens.

describe.skipIf(!duckDbAvailable())('column drift — real-corpus ground truth', { tags: ['data-validity'] }, () => {
  let drift: ColumnDrift;
  beforeAll(() => {
    drift = computeColumnDrift(openDataVintageCsvs());
  }, 600_000);

  const fingerprint = (vintage: string, column: string): ColumnFingerprint | undefined =>
    drift.fingerprints.find(v => v.vintage === vintage)?.columns.find(c => c.column === column);
  const signalsFor = (column: string, kind: string): DriftSignal[] =>
    drift.signals.filter(s => s.column === column && s.kind === kind);

  // --- The committed report is exactly this fold -------------------------

  it('DriftReport_FoldedFromTheNormalisedCsvs_MatchesTheCommittedGoldenByteForByte', () => {
    const golden = fs.readFileSync(path.resolve(process.cwd(), COLUMN_DRIFT_PATH), 'utf8');
    expect(renderColumnDrift(drift)).toBe(golden);
  });

  it('DriftFold_RunTwiceOverTheSameCorpus_IsByteDeterministic', () => {
    expect(renderColumnDrift(computeColumnDrift(openDataVintageCsvs()))).toBe(renderColumnDrift(drift));
  });

  // --- Ground truth (a): the 2026-01-14 Z-suffix omission (#564) ----------

  it('ZSuffixCohort_OmittedFrom2026January_SurfacesAsCharacterVanishedThenReappeared', () => {
    // The 2026-01-14 vintage carries NOT ONE callsign containing a Z, where
    // its neighbours carry ~14k / ~10k — a whole cohort silently omitted. The
    // fingerprint sees the letter Z leave the callsign column, then return.
    const before = fingerprint('2025-11-11', 'callsign')?.charProfile.find(c => c.char === 'Z');
    const gap = fingerprint('2026-01-14', 'callsign')?.charProfile.find(c => c.char === 'Z');
    const after = fingerprint('2026-06-23', 'callsign')?.charProfile.find(c => c.char === 'Z');
    expect(before?.count ?? 0).toBeGreaterThan(10_000);
    expect(gap).toBeUndefined();
    expect(after?.count ?? 0).toBeGreaterThan(5_000);

    const vanished = signalsFor('callsign', 'character-vanished').find(s => s.toVintage === '2026-01-14' && s.detail.includes('`Z`'));
    expect(vanished).toBeDefined();
    expect(vanished?.fromVintage).toBe('2025-11-11');
    const reappeared = signalsFor('callsign', 'character-appeared').find(s => s.toVintage === '2026-06-23' && s.detail.includes('`Z`'));
    expect(reappeared).toBeDefined();
  });

  // --- Ground truth (b): the #801 mass update -----------------------------

  it('MassUpdate_October2025_SurfacesAsASingleDayDominatingTheModificationColumn', () => {
    // #801: licence_version_last_modified_date clusters onto 2025-10-11 (+ a
    // second wave 2025-10-30), a majority of the populated column across every
    // vintage that carries it — the mass-update fingerprint.
    const lvm2025 = fingerprint('2025-11-11', 'licence_version_last_modified_date');
    expect(lvm2025?.topValues[0]?.value).toBe('2025-10-11');
    expect((lvm2025?.topValues[0]?.count ?? 0) / (lvm2025?.populated ?? 1)).toBeGreaterThan(0.8);
    expect(lvm2025?.topValues[1]?.value).toBe('2025-10-30');

    const lvm2026 = fingerprint('2026-06-23', 'licence_version_last_modified_date');
    expect(lvm2026?.topValues.slice(0, 2).map(v => v.value)).toEqual(['2025-10-11', '2025-10-30']);
    expect(lvm2026?.topValues[0]?.count).toBe(76_378);
    expect(lvm2026?.topValues[1]?.count).toBe(11_062);

    // The column arrives with the 2025-11-11 vintage (empty in every prior
    // one), so the mass-update fingerprint enters as a coverage change.
    const populated = signalsFor('licence_version_last_modified_date', 'column-populated');
    expect(populated.map(s => `${s.fromVintage}->${s.toVintage}`)).toContain('2025-06-08->2025-11-11');
  });

  // --- Ground truth (c): the blank-product pool shifts ---------------------

  it('BlankProductPool_FilteredThenRestored_SurfacesAsBlankShareShifts', () => {
    // The reserved-with-blank-product pool is ~27-29% of the register when
    // present, and 0% in the 2025-06-04 publication that silently filtered it
    // out (declared complete). The fingerprint shows the pool leave and
    // return; the blank-share measure flags both boundaries.
    expect(fingerprint('2025-04-08', 'product')?.blank).toBeGreaterThan(40_000);
    expect(fingerprint('2025-06-04', 'product')?.blank).toBe(0);
    expect(fingerprint('2025-11-11', 'product')?.blank).toBeGreaterThan(40_000);

    const shifts = signalsFor('product', 'blank-share-shift').map(s => `${s.fromVintage}->${s.toVintage}`);
    expect(shifts).toContain('2025-04-08->2025-05-27'); // the pool leaves
    expect(shifts).toContain('2025-06-08->2025-11-11'); // the pool returns
  });

  // --- Ground truth (d): export-variant / schema drift --------------------

  it('DateFormatChange_BareIsoToDatetime_SurfacesAsLengthAndCharacterShifts', () => {
    // The v2025-friendly variant renders created/last-modified dates with a
    // time-of-day (16 chars) where earlier variants render a bare ISO day (10
    // chars): the mean length jumps and a colon and a space appear.
    const lengthShift = signalsFor('created_date', 'length-shift').find(s => s.toVintage === '2025-05-27');
    expect(lengthShift?.detail).toContain('10.00 -> 16.00');
    const colon = signalsFor('created_date', 'character-appeared').find(s => s.toVintage === '2025-05-27' && s.detail.includes('`:`'));
    expect(colon).toBeDefined();
  });

  it('ColumnPopulationDrift_AcrossExportVariants_SurfacesAsColumnPopulatedAndEmptied', () => {
    // The canonical schema is stable, but which columns a variant populates is
    // not: `type` is emptied in the v2023-mmsi vintage and returns; the
    // licence-version columns arrive only with the v2026 family. These are the
    // normalised reflection of raw header/schema drift.
    const typeEmptied = signalsFor('type', 'column-emptied').map(s => s.toVintage);
    expect(typeEmptied).toContain('2023-02-20');
    const typePopulated = signalsFor('type', 'column-populated').map(s => s.toVintage);
    expect(typePopulated).toContain('2025-04-08');
    const lvosPopulated = signalsFor('licence_version_original_start_date', 'column-populated').map(s => `${s.fromVintage}->${s.toVintage}`);
    expect(lvosPopulated).toContain('2025-06-08->2025-11-11');
  });

  // --- The detector stays honest about what it did NOT flag ---------------

  it('StableContamination_NbspBearingCallsigns_StaysInTheFingerprintButBelowTheDriftFloor', () => {
    // Three heritage callsigns carry a trailing non-breaking space across
    // every open-data vintage — real contamination, surfaced in the char-class
    // profile (non-ASCII present), but NOT a drift: it is stable, so it never
    // trips character-appeared/vanished. Flag movement, not standing state.
    const callsign = fingerprint('2026-06-23', 'callsign');
    expect(callsign?.classCounts.nonascii).toBeGreaterThan(0);
    const nbspDrift = drift.signals.filter(s => s.column === 'callsign' && (s.kind === 'character-appeared' || s.kind === 'character-vanished') && s.detail.includes('U+00A0'));
    expect(nbspDrift).toEqual([]);
  });
});
