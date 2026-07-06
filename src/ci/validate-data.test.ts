import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { validateArchiveEntry, deepValidateEntryCsv, validateLatestPointers, validateRepoData } from './validate-data';
import { CONSTANTS } from '../shared/utils';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// These validate the data-integrity checks that gate auto-merge of data PRs
// (issues #14/#15): a well-formed publication passes; tampered, incomplete,
// or malformed entries fail with a problem naming the offending path. Tests
// run against a temporary directory laid out like the repo root.

const CSV = 'Value,Prefix,Suffix,Type,Status\nM7TEE,M7,TEE,Call Sign - Amateur,Allocated\nG5ABC,G5,ABC,Call Sign - Amateur,Allocated\n';

function sha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function writeEntry(root: string, key: string, rawContent: string, metaOverrides: Record<string, unknown> = {}): void {
  const dir = path.join(root, CONSTANTS.DIRS.archive, key);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'raw.csv'), rawContent);
  const meta = {
    schemaVersion: 1,
    sourceKey: CONSTANTS.SOURCES.OFCOM_AMATEUR,
    provenance: 'live',
    fetchedAt: '2026-07-06T18:00:00.000Z',
    files: {
      'raw.csv': { size: Buffer.byteLength(rawContent), sha256: sha256(rawContent), format: 'csv' },
    },
    ...metaOverrides,
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
}

function writeLatestSet(root: string, fromKey: string): void {
  const entryDir = path.join(root, CONSTANTS.DIRS.archive, fromKey);
  fs.copyFileSync(path.join(entryDir, 'raw.csv'), path.join(root, CONSTANTS.FILES.latestRawCsv));
  fs.copyFileSync(path.join(entryDir, 'meta.json'), path.join(root, CONSTANTS.FILES.latestMeta));
  const records = [
    { Value: 'M7TEE', Prefix: 'M7', Suffix: 'TEE', Type: 'Call Sign - Amateur', Status: 'Allocated' },
    { Value: 'G5ABC', Prefix: 'G5', Suffix: 'ABC', Type: 'Call Sign - Amateur', Status: 'Allocated' },
  ];
  const sorted = [...records].sort((a, b) => a.Value.localeCompare(b.Value));
  fs.writeFileSync(path.join(root, CONSTANTS.FILES.latestJson), JSON.stringify(records));
  fs.writeFileSync(path.join(root, CONSTANTS.FILES.latestRawSortedJson), JSON.stringify(sorted));
  fs.writeFileSync(
    path.join(root, CONSTANTS.FILES.latestRawSortedCsv),
    'Value,Prefix,Suffix,Type,Status\nG5ABC,G5,ABC,Call Sign - Amateur,Allocated\nM7TEE,M7,TEE,Call Sign - Amateur,Allocated\n',
  );
}

let tmpRoot: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'callsigns-validate-test-'));
  process.chdir(tmpRoot);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('validateArchiveEntry', () => {
  it('ArchiveEntry_WhenWellFormed_PassesValidation', () => {
    writeEntry(tmpRoot, '2026-06-23', CSV);
    const problems = validateArchiveEntry('2026-06-23');
    expect(problems).toEqual([]);
  });

  it('ArchiveEntry_WhenMetaJsonMissing_Fails', () => {
    writeEntry(tmpRoot, '2026-06-23', CSV);
    fs.rmSync(path.join(tmpRoot, 'archive', '2026-06-23', 'meta.json'));
    const problems = validateArchiveEntry('2026-06-23');
    expect(problems.some(p => p.problem.includes('meta.json') && p.problem.includes('missing'))).toBe(true);
  });

  it('ArchiveEntry_WhenMetaJsonMalformed_Fails', () => {
    writeEntry(tmpRoot, '2026-06-23', CSV);
    fs.writeFileSync(path.join(tmpRoot, 'archive', '2026-06-23', 'meta.json'), '{ not json');
    const problems = validateArchiveEntry('2026-06-23');
    expect(problems.some(p => p.problem.includes('not valid JSON'))).toBe(true);
  });

  it('ArchiveEntry_WhenRawCsvMissing_Fails', () => {
    writeEntry(tmpRoot, '2026-06-23', CSV);
    fs.rmSync(path.join(tmpRoot, 'archive', '2026-06-23', 'raw.csv'));
    const problems = validateArchiveEntry('2026-06-23');
    expect(problems.length).toBeGreaterThan(0);
  });

  it('ArchiveEntry_WhenRawCsvEmpty_Fails', () => {
    writeEntry(tmpRoot, '2026-06-23', '');
    const problems = validateArchiveEntry('2026-06-23');
    expect(problems.some(p => p.problem.includes('empty'))).toBe(true);
  });

  it('ArchiveEntry_WhenRawBytesTamperedSizeMismatch_Fails', () => {
    // Tamper scenario: raw.csv modified after meta was written; recorded size
    // no longer matches the bytes on disk.
    writeEntry(tmpRoot, '2026-06-23', CSV);
    fs.appendFileSync(path.join(tmpRoot, 'archive', '2026-06-23', 'raw.csv'), 'EXTRA,XX,TRA,Injected,Row\n');
    const problems = validateArchiveEntry('2026-06-23');
    expect(problems.some(p => p.problem.includes('size'))).toBe(true);
  });

  it('ArchiveEntry_WhenRawBytesTamperedSamesizeHashMismatch_Fails', () => {
    // Same-length substitution defeats the size check; sha256 catches it.
    const tampered = CSV.replace('M7TEE', 'M7XXX');
    writeEntry(tmpRoot, '2026-06-23', CSV);
    fs.writeFileSync(path.join(tmpRoot, 'archive', '2026-06-23', 'raw.csv'), tampered);
    const problems = validateArchiveEntry('2026-06-23');
    expect(problems.some(p => p.problem.includes('sha256'))).toBe(true);
  });

  it('ArchiveEntry_WhenUnexpectedFilePresent_Fails', () => {
    // Nothing may live in an archive entry that meta.json does not declare -
    // catches accidental (or malicious) extra files riding along in a data PR.
    writeEntry(tmpRoot, '2026-06-23', CSV);
    fs.writeFileSync(path.join(tmpRoot, 'archive', '2026-06-23', 'stray-file.txt'), 'should not be here');
    const problems = validateArchiveEntry('2026-06-23');
    expect(problems.some(p => p.problem.includes('stray-file.txt'))).toBe(true);
  });

  it('ArchiveEntry_WhenMetaDeclaresFileAbsentFromDisk_Fails', () => {
    writeEntry(tmpRoot, '2026-06-23', CSV, {
      files: {
        'raw.csv': { size: Buffer.byteLength(CSV), sha256: sha256(CSV), format: 'csv' },
        'annex.pdf': { size: 123, sha256: 'abc', format: 'other' },
      },
    });
    const problems = validateArchiveEntry('2026-06-23');
    expect(problems.some(p => p.problem.includes('annex.pdf'))).toBe(true);
  });

  it('ArchiveEntry_WhenRequiredMetaFieldMissing_Fails', () => {
    writeEntry(tmpRoot, '2026-06-23', CSV, { sourceKey: undefined });
    const problems = validateArchiveEntry('2026-06-23');
    expect(problems.some(p => p.problem.includes('sourceKey'))).toBe(true);
  });

  it('ArchiveEntry_WhenProvenanceIsReconstructedFromPriorDownload_Passes', () => {
    // Entries can be imported from downloads the maintainer retained outside
    // this repository - a legitimate provenance distinct from live fetches
    // and git-history reconstruction.
    writeEntry(tmpRoot, '2023-02-20', CSV, { provenance: 'reconstructed-from-prior-download' });
    expect(validateArchiveEntry('2023-02-20')).toEqual([]);
  });

  it('ArchiveEntry_WhenProvenanceUnrecognised_Fails', () => {
    writeEntry(tmpRoot, '2026-06-23', CSV, { provenance: 'downloaded-from-somewhere' });
    const problems = validateArchiveEntry('2026-06-23');
    expect(problems.some(p => p.problem.includes('provenance'))).toBe(true);
  });

  it('ArchiveEntry_WhenIntendedCoverageDeclaredPartialWithScopeNotes_Passes', () => {
    // FOI-style partial views declare their scope; missing rows are scope,
    // not change.
    writeEntry(tmpRoot, '2026-06-23', CSV, {
      intendedCoverage: { complete: false, scopeNotes: 'FOI response limited to Foundation licence callsigns' },
    });
    expect(validateArchiveEntry('2026-06-23')).toEqual([]);
  });

  it('ArchiveEntry_WhenIntendedCoverageDeclaredWithoutCompleteBoolean_Fails', () => {
    writeEntry(tmpRoot, '2026-06-23', CSV, { intendedCoverage: { scopeNotes: 'shapeless' } });
    const problems = validateArchiveEntry('2026-06-23');
    expect(problems.some(p => p.problem.includes('intendedCoverage.complete'))).toBe(true);
  });

  it('ArchiveEntry_WhenIntendedCoverageIsNull_FailsWithProblemNotCrash', () => {
    // null passes an !== undefined guard but must not crash the validator -
    // one malformed meta should be a reported problem, never an aborted run.
    writeEntry(tmpRoot, '2026-06-23', CSV, { intendedCoverage: null });
    const problems = validateArchiveEntry('2026-06-23');
    expect(problems.some(p => p.problem.includes('intendedCoverage'))).toBe(true);
  });
});

describe('deepValidateEntryCsv', () => {
  it('DeepValidation_WhenCsvParsesWithRecords_Passes', () => {
    writeEntry(tmpRoot, '2026-06-23', CSV);
    expect(deepValidateEntryCsv('2026-06-23')).toEqual([]);
  });

  it('DeepValidation_WhenCsvUnparseable_Fails', () => {
    const broken = 'Value,Prefix\n"unterminated quote,M7\n';
    // meta is consistent with the bytes (size/hash match) - only the deep CSV
    // parse can catch this class of corruption.
    writeEntry(tmpRoot, '2026-06-23', broken);
    const problems = deepValidateEntryCsv('2026-06-23');
    expect(problems.some(p => p.problem.includes('parse'))).toBe(true);
  });

  it('DeepValidation_WhenRecordCountDisagreesWithMeta_Fails', () => {
    writeEntry(tmpRoot, '2026-06-23', CSV, {
      files: { 'raw.csv': { size: Buffer.byteLength(CSV), sha256: sha256(CSV), format: 'csv', recordCount: 999 } },
    });
    const problems = deepValidateEntryCsv('2026-06-23');
    expect(problems.some(p => p.problem.includes('recordCount'))).toBe(true);
  });
});

describe('validateLatestPointers', () => {
  it('LatestPointers_WhenConsistentWithNewestEntry_Pass', () => {
    writeEntry(tmpRoot, '2026-06-23', CSV);
    writeLatestSet(tmpRoot, '2026-06-23');
    expect(validateLatestPointers()).toEqual([]);
  });

  it('LatestPointers_WhenLatestRawDiffersFromNewestEntry_Fails', () => {
    // The latest-raw pointer must always mirror the newest archive entry -
    // a divergence means the pointer set and archive moved independently.
    writeEntry(tmpRoot, '2026-06-23', CSV);
    writeLatestSet(tmpRoot, '2026-06-23');
    fs.appendFileSync(path.join(tmpRoot, CONSTANTS.FILES.latestRawCsv), 'DRIFT,DR,IFT,Call Sign - Amateur,Allocated\n');
    const problems = validateLatestPointers();
    expect(problems.some(p => p.path.includes('latest-raw.csv'))).toBe(true);
  });

  it('LatestPointers_WhenLatestJsonMalformed_Fails', () => {
    writeEntry(tmpRoot, '2026-06-23', CSV);
    writeLatestSet(tmpRoot, '2026-06-23');
    fs.writeFileSync(path.join(tmpRoot, CONSTANTS.FILES.latestJson), '[{ truncated');
    const problems = validateLatestPointers();
    expect(problems.some(p => p.path.includes('latest.json'))).toBe(true);
  });
});

describe('validateRepoData (orchestrating check used by CI)', () => {
  it('RepoData_WhenAllEntriesAndPointersWellFormed_ReportsOk', () => {
    writeEntry(tmpRoot, '2025-06-08', CSV);
    writeEntry(tmpRoot, '2026-06-23', CSV);
    writeLatestSet(tmpRoot, '2026-06-23');
    const report = validateRepoData(['2026-06-23']);
    expect(report.ok).toBe(true);
    expect(report.checkedEntries).toBe(2);
  });

  it('RepoData_WhenAnyEntryTampered_ReportsFailureNamingEntry', () => {
    writeEntry(tmpRoot, '2025-06-08', CSV);
    writeEntry(tmpRoot, '2026-06-23', CSV);
    writeLatestSet(tmpRoot, '2026-06-23');
    fs.appendFileSync(path.join(tmpRoot, 'archive', '2025-06-08', 'raw.csv'), 'tamper\n');
    const report = validateRepoData(['2026-06-23']);
    expect(report.ok).toBe(false);
    expect(report.problems.some(p => p.path.includes('2025-06-08'))).toBe(true);
  });
});
