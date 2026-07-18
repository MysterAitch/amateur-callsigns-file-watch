import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { verifyFoiLane, verifyFoiLaneAt, FOI_ARCHIVE_DIR } from './foi-verification.ts';
import type { FoiEntryMeta } from '../shared/foi-archive.ts';
import { parseJsonObject } from '../shared/json-shape.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The FOI derivation verification (issue #149; the daily sweep converted to
// this per-PR gate by #447): re-executes every mechanical derivation in
// archive/foi/ from committed bytes and verifies byte-identity with the
// committed derivatives, reporting honest states for entries with nothing to
// derive. Because these cases run against the REAL archive on every pull
// request and push, they are the whole-lane completeness guard the retired
// daily schedule provided - and a tighter one: the committed bytes they
// police can only change via a merge, and every merge runs them. The tamper
// case proves the drift detection would actually fire.

describe('FOI derivation verification', { tags: ['unit'] }, () => {
  const report = verifyFoiLane();

  it('FoiVerification_RealArchive_EveryEntryReportsAndNoneFailOrDrift', { timeout: 600_000 }, () => {
    const entryKeys = fs.readdirSync(FOI_ARCHIVE_DIR)
      .filter(name => fs.statSync(path.join(FOI_ARCHIVE_DIR, name)).isDirectory());
    expect(report.entries.map(e => e.entryKey).sort()).toEqual(entryKeys.sort());
    expect(report.failed).toEqual([]);
  });

  it('FoiVerification_EntriesWithConverters_ReportVerified', () => {
    const byKey = new Map(report.entries.map(e => [e.entryKey, e]));
    expect(byKey.get('wdtk-1180568--licence-breakdown-duration-age')?.state).toBe('verified');
    expect(byKey.get('wdtk-596532--allocated-reserved-forbidden')?.state).toBe('verified');
  });

  it('FoiVerification_NotHeldAndUnrecoveredEntries_ReportRecordOnlyNotFailure', () => {
    // Entries with no dataset bytes are a legitimate end state, reported
    // honestly rather than as gaps: the not-held trilogy and any entry
    // whose disclosed dataset has not been recovered.
    const recordOnly = report.entries.filter(e => e.state === 'record-only').map(e => e.entryKey);
    expect(recordOnly).toContain('ofcom-518689--suffix-availability-not-held');
    expect(recordOnly).toContain('ofcom-612185--unallocated-callsigns-not-held');
  });

  it('FoiVerification_TamperedRecordCountDeclaration_ReportedAsDrift', () => {
    // The committed CSV re-derives byte-identical (so a naive byte check alone
    // would pass), but the persisted recordCount (#683) no longer matches the
    // converter's own count for those identical bytes - a hand-edit that must
    // still be caught and named.
    const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foi-verification-recordcount-'));
    try {
      const source = path.join(FOI_ARCHIVE_DIR, 'ofcom-498903--reissued-callsigns-since-2010');
      const target = path.join(scratchRoot, 'ofcom-498903--reissued-callsigns-since-2010');
      fs.cpSync(source, target, { recursive: true });
      const metaPath = path.join(target, 'meta.json');
      const meta = parseJsonObject(fs.readFileSync(metaPath, 'utf8'), metaPath) as FoiEntryMeta;
      const declared = meta.files['normalised--sheet-1-sheet1.csv'];
      expect(declared.recordCount).toBeGreaterThan(0);
      declared.recordCount = 999999;
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

      const tamperedReport = verifyFoiLaneAt(scratchRoot);
      expect(tamperedReport.failed).toHaveLength(1);
      expect(tamperedReport.failed[0].state).toBe('drift');
      expect(tamperedReport.failed[0].note).toContain('recordCount');
      expect(tamperedReport.failed[0].note).toContain('999999');
    } finally {
      fs.rmSync(scratchRoot, { recursive: true, force: true });
    }
  });

  it('FoiVerification_TamperedNormalisedFile_ReportedAsDrift', () => {
    // Corrupt a copy of a converter-bound entry: the verification must name
    // the drifted file and the run must go red (failed list non-empty). The
    // lane runner reads the archive dir constant, so exercise the per-entry
    // logic via a scratch archive with one doctored entry.
    const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foi-verification-'));
    try {
      const source = path.join(FOI_ARCHIVE_DIR, 'ofcom-498903--reissued-callsigns-since-2010');
      const target = path.join(scratchRoot, 'ofcom-498903--reissued-callsigns-since-2010');
      fs.cpSync(source, target, { recursive: true });
      const victim = path.join(target, 'normalised--sheet-1-sheet1.csv');
      fs.appendFileSync(victim, 'M0FAKE,reissued,2016-01-01\n');

      const tamperedReport = verifyFoiLaneAt(scratchRoot);
      expect(tamperedReport.failed).toHaveLength(1);
      expect(tamperedReport.failed[0].state).toBe('drift');
      expect(tamperedReport.failed[0].note).toContain('normalised--sheet-1-sheet1.csv');
    } finally {
      fs.rmSync(scratchRoot, { recursive: true, force: true });
    }
  });
});
