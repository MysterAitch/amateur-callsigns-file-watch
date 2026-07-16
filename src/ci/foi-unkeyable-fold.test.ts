import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildFoiUnkeyableSummary } from './foi-unkeyable-fold.ts';
import { buildFoiObservations } from '../shared/foi-observations.ts';
import { defaultFoiDir } from '../shared/foi-archive.ts';
import { cleanedCallsign } from '../sources/ofcom-amateur/components.ts';

// Issue #632: the FOI lane's share of the callsign-shard build's unkeyable-row
// count (a row whose callsign cell, cleaned, carries no A-Z0-9/ character at
// all) has no committed report coverage - the data-quality rollup is
// open-data only by design. These tests pin the fold itself on a controlled
// fixture archive, then check it agrees with an independently-recomputed
// figure over the real archive/foi. Test names follow Subject_Scenario_Outcome
// per project convention.

function writeEntry(foiDir: string, entry: string, fileName: string, csvBody: string): void {
  const entryDir = path.join(foiDir, entry);
  fs.mkdirSync(entryDir, { recursive: true });
  fs.writeFileSync(path.join(entryDir, fileName), csvBody);
  fs.writeFileSync(path.join(entryDir, 'meta.json'), JSON.stringify({
    schemaVersion: 1,
    sourceKey: 'ofcom-foi',
    requestId: null,
    ofcomReference: null,
    requestUrl: null,
    title: entry,
    requester: null,
    requestedAt: null,
    respondedAt: null,
    outcome: 'successful',
    dataVintage: '2020-01-01',
    datasetClasses: ['register-snapshot'],
    converter: null,
    files: {
      [fileName]: { bytes: csvBody.length, sha256: '', role: 'normalised', datasetClasses: ['register-snapshot'] },
    },
  }));
}

describe('buildFoiUnkeyableSummary (fixture FOI archive)', { tags: ['unit'] }, () => {
  it('UnkeyableSummary_BlankAndPunctuationOnlyCells_AreCountedNotDroppedFromTheTotal', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foi-unkeyable-'));
    try {
      writeEntry(dir, 'wdtk-1--sample', 'normalised.csv',
        'callsign,status\nM7ABC,Allocated\n,Allocated\n",,",Allocated\nG0XYZ,Allocated\n');
      const summary = buildFoiUnkeyableSummary(dir);
      // Two unkeyable rows: the blank cell and the punctuation-only ",," cell.
      // The two real callsigns are not counted.
      expect(summary.total).toBe(2);
      expect(summary.files).toEqual([{ entry: 'wdtk-1--sample', file: 'normalised.csv', count: 2 }]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('UnkeyableSummary_FileWithNoUnkeyableRows_IsOmittedFromTheFileList', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foi-unkeyable-'));
    try {
      writeEntry(dir, 'wdtk-2--clean', 'normalised.csv', 'callsign,status\nM7ABC,Allocated\nG0XYZ,Allocated\n');
      const summary = buildFoiUnkeyableSummary(dir);
      expect(summary.total).toBe(0);
      expect(summary.files).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('UnkeyableSummary_MultipleEntriesAndFiles_SortsDeterministicallyByEntryThenFile', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foi-unkeyable-'));
    try {
      writeEntry(dir, 'wdtk-2--sample', 'normalised--sheet-2.csv', 'callsign,status\n,Allocated\n');
      writeEntry(dir, 'wdtk-1--sample', 'normalised--sheet-1.csv', 'callsign,status\n",,",Allocated\n');
      const summary = buildFoiUnkeyableSummary(dir);
      expect(summary.total).toBe(2);
      expect(summary.files.map(f => `${f.entry}/${f.file}`)).toEqual([
        'wdtk-1--sample/normalised--sheet-1.csv',
        'wdtk-2--sample/normalised--sheet-2.csv',
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('UnkeyableSummary_NonCallsignBearingFile_IsIgnoredNotCounted', () => {
    // A normalised file with no callsign column at all (e.g. a suffix-list or
    // counts-aggregate shape) never enters buildFoiObservations, so it cannot
    // contribute to the unkeyable count either.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foi-unkeyable-'));
    try {
      writeEntry(dir, 'wdtk-3--no-callsign-column', 'normalised.csv', 'suffix,status\nABC,forbidden\n');
      const summary = buildFoiUnkeyableSummary(dir);
      expect(summary.total).toBe(0);
      expect(summary.files).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The real-archive consistency check (mirrors foi-observations.test.ts's own
// precedent of asserting real-data invariants as a 'unit' test - the FOI
// corpus is small enough that this is cheap). Recomputed independently here
// rather than pinned to today's exact figure, so archive growth does not make
// this test brittle; build-callsign-shards.corpus.test.ts pins the SAME
// figure (its `dataset.unkeyable` sum) against the real archive already.
describe('buildFoiUnkeyableSummary (real archive/foi)', { tags: ['unit'] }, () => {
  it('UnkeyableSummary_RealFoiArchive_MatchesAnIndependentlyRecomputedTotal', () => {
    const foiDir = defaultFoiDir();
    const summary = buildFoiUnkeyableSummary(foiDir);
    const expectedTotal = buildFoiObservations(foiDir).filter(r => cleanedCallsign(r.callsign) === '').length;
    expect(summary.total).toBe(expectedTotal);
    expect(summary.files.reduce((sum, f) => sum + f.count, 0)).toBe(summary.total);
    // The known archive carries at least one unaddressable FOI row (issue
    // #632's investigation found 30 across 16 files) - never silently zero.
    expect(summary.total).toBeGreaterThan(0);
  });
});
