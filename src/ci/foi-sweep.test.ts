import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sweepFoiLane, sweepFoiLaneAt, FOI_ARCHIVE_DIR } from './foi-sweep.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The FOI derivation sweep (issue #149): re-executes every mechanical
// derivation in archive/foi/ from committed bytes and verifies byte-identity
// with the committed derivatives, reporting honest states for entries with
// nothing to derive. These tests run the sweep against the real archive -
// which must always verify clean - and against a deliberately corrupted
// copy of an entry, which must be called out as drift.

describe('FOI derivation sweep', { tags: ['unit'] }, () => {
  const report = sweepFoiLane();

  it('FoiSweep_RealArchive_EveryEntryReportsAndNoneFailOrDrift', { timeout: 600_000 }, () => {
    const entryKeys = fs.readdirSync(FOI_ARCHIVE_DIR)
      .filter(name => fs.statSync(path.join(FOI_ARCHIVE_DIR, name)).isDirectory());
    expect(report.entries.map(e => e.entryKey).sort()).toEqual(entryKeys.sort());
    expect(report.failed).toEqual([]);
  });

  it('FoiSweep_EntriesWithConverters_ReportVerified', () => {
    const byKey = new Map(report.entries.map(e => [e.entryKey, e]));
    expect(byKey.get('wdtk-1180568--licence-breakdown-duration-age')?.state).toBe('verified');
    expect(byKey.get('wdtk-596532--allocated-reserved-forbidden')?.state).toBe('verified');
  });

  it('FoiSweep_NotHeldAndUnrecoveredEntries_ReportRecordOnlyNotFailure', () => {
    // Entries with no dataset bytes are a legitimate end state, reported
    // honestly rather than as gaps: the not-held trilogy and any entry
    // whose disclosed dataset has not been recovered.
    const recordOnly = report.entries.filter(e => e.state === 'record-only').map(e => e.entryKey);
    expect(recordOnly).toContain('ofcom-518689--suffix-availability-not-held');
    expect(recordOnly).toContain('ofcom-612185--unallocated-callsigns-not-held');
  });

  it('FoiSweep_CoverageMarkdown_CarriesLaneHeaderAndOneRowPerEntry', () => {
    expect(report.coverageMarkdown).toContain(`## FOI lane (${report.entries.length} entries`);
    for (const entry of report.entries) {
      expect(report.coverageMarkdown).toContain(`| ${entry.entryKey} |`);
    }
  });

  it('FoiSweep_TamperedNormalisedFile_ReportedAsDrift', () => {
    // Corrupt a copy of a converter-bound entry: the sweep must name the
    // drifted file and the run must go red (failed list non-empty). The
    // sweep reads the archive dir constant, so exercise the per-entry logic
    // via a scratch archive with one doctored entry.
    const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foi-sweep-'));
    try {
      const source = path.join(FOI_ARCHIVE_DIR, 'ofcom-498903--reissued-callsigns-since-2010');
      const target = path.join(scratchRoot, 'ofcom-498903--reissued-callsigns-since-2010');
      fs.cpSync(source, target, { recursive: true });
      const victim = path.join(target, 'normalised--sheet-1-sheet1.csv');
      fs.appendFileSync(victim, 'M0FAKE,reissued,2016-01-01\n');

      const tamperedReport = sweepFoiLaneAt(scratchRoot);
      expect(tamperedReport.failed).toHaveLength(1);
      expect(tamperedReport.failed[0].state).toBe('drift');
      expect(tamperedReport.failed[0].note).toContain('normalised--sheet-1-sheet1.csv');
    } finally {
      fs.rmSync(scratchRoot, { recursive: true, force: true });
    }
  });
});
