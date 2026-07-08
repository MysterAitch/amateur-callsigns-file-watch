import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { validateFoiEntry, validateFoiLaneAt } from './validate-foi.ts';
import type { FoiEntryMeta } from '../shared/foi-archive.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The FOI-lane merge gate (ADR 0004 point 4): a well-formed entry passes;
// tampered bytes, undeclared files, vocabulary violations, dangling
// references, and half-authored scaffolds (TODO placeholders) all fail with
// a problem naming the offending path. Fixtures are scratch entries built
// per test; one test runs the validator against the real archive, which
// must always be clean.

const REAL_FOI_DIR = path.resolve(import.meta.dirname, '..', '..', 'archive', 'foi');

const DATA_CSV = 'callsign,status\nM7TEE,Available\nG5ABC,Available\n';
const CORRESPONDENCE = '# FOI publication record - test fixture\n';

function sha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

let foiDir: string;

beforeEach(() => {
  foiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-foi-test-'));
});

afterEach(() => {
  fs.rmSync(foiDir, { recursive: true, force: true });
});

// Writes a well-formed wdtk-keyed entry (a data CSV + correspondence), then
// applies the caller's meta mutation before serialising - each red case is
// one deliberate deviation from this fixture.
function writeFoiEntry(key = 'wdtk-123456--test-entry', mutate?: (meta: FoiEntryMeta) => void): string {
  const dir = path.join(foiDir, key);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'data.csv'), DATA_CSV);
  fs.writeFileSync(path.join(dir, 'correspondence.md'), CORRESPONDENCE);
  const meta: FoiEntryMeta = {
    schemaVersion: 1,
    sourceKey: key.startsWith('ofcom-') ? 'ofcom-foi' : 'wdtk-foi',
    requestId: key.startsWith('ofcom-') ? null : 123456,
    ofcomReference: null,
    requestUrl: null,
    title: 'Test entry',
    requester: null,
    requestedAt: '2015-01-07',
    respondedAt: '2015-02-25',
    outcome: 'successful',
    dataVintage: '2015-02',
    datasetClasses: ['available-pool'],
    converter: null,
    files: {
      'data.csv': { bytes: Buffer.byteLength(DATA_CSV), sha256: sha256(DATA_CSV), role: 'data' },
      'correspondence.md': { bytes: Buffer.byteLength(CORRESPONDENCE), sha256: sha256(CORRESPONDENCE), role: 'transcript' },
    },
  };
  mutate?.(meta);
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  return dir;
}

// Removes the fixture's data file from disk AND the declaration - the
// record-only / unrecovered-dataset shapes.
function removeDataFile(dir: string, meta: FoiEntryMeta): void {
  fs.rmSync(path.join(dir, 'data.csv'));
  delete meta.files['data.csv'];
}

function writeRecordOnlyEntry(key: string, mutate?: (meta: FoiEntryMeta) => void): void {
  writeFoiEntry(key, meta => {
    delete meta.files['data.csv'];
    meta.dataVintage = null;
    meta.datasetClasses = ['reference-context'];
    mutate?.(meta);
  });
  fs.rmSync(path.join(foiDir, key, 'data.csv'));
}

describe('validateFoiEntry - shape and vocabularies', () => {
  it('FoiEntry_WellFormedFixture_Passes', () => {
    writeFoiEntry();
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry')).toEqual([]);
  });

  it('FoiEntry_MetaJsonMissing_Fails', () => {
    const dir = writeFoiEntry();
    fs.rmSync(path.join(dir, 'meta.json'));
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry')[0].problem).toMatch(/meta.json is missing/);
  });

  it('FoiEntry_MetaJsonInvalidJson_Fails', () => {
    const dir = writeFoiEntry();
    fs.writeFileSync(path.join(dir, 'meta.json'), '{ not json');
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry')[0].problem).toMatch(/not valid JSON/);
  });

  it('FoiEntry_UnknownOutcome_Fails', () => {
    writeFoiEntry(undefined, meta => { meta.outcome = 'partially successful'; });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/outcome "partially successful"/);
  });

  it('FoiEntry_UnknownDatasetClass_Fails_TopLevelAndPerFile', () => {
    writeFoiEntry(undefined, meta => {
      meta.datasetClasses = ['available-pool', 'mystery-class'];
      meta.files['data.csv'].datasetClasses = ['another-mystery'];
    });
    const problems = validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join('\n');
    expect(problems).toMatch(/unknown dataset class "mystery-class"/);
    expect(problems).toMatch(/unknown dataset class "another-mystery"/);
  });

  it('FoiEntry_UnknownRole_Fails', () => {
    writeFoiEntry(undefined, meta => { meta.files['data.csv'].role = 'attachment'; });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/unknown role "attachment"/);
  });

  it('FoiEntry_SourceKeyDisagreesWithKeyPrefix_Fails', () => {
    writeFoiEntry(undefined, meta => { meta.sourceKey = 'ofcom-foi'; });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/disagrees with the entry-key prefix/);
  });

  it('FoiEntry_RequestIdMismatch_Fails', () => {
    writeFoiEntry(undefined, meta => { meta.requestId = 999; });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/requestId 999 does not match/);
  });

  it('FoiEntry_OfcomEntryWithNonNullRequestId_Fails', () => {
    writeFoiEntry('ofcom-987654--test-entry', meta => { meta.requestId = 987654; });
    expect(validateFoiEntry(foiDir, 'ofcom-987654--test-entry').map(p => p.problem).join()).toMatch(/requestId must be null for ofcom-foi/);
  });
});

describe('validateFoiEntry - dates', () => {
  it('FoiEntry_NullRespondedAtWithoutNote_Fails', () => {
    writeFoiEntry(undefined, meta => { meta.respondedAt = null; });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/respondedAt is null without a respondedAtNote/);
  });

  it('FoiEntry_NullRespondedAtWithNote_Passes', () => {
    // The undated published letters (ofcom-285990/299351) carry note fields
    // explaining the bound - that is an honest record, not a gap.
    writeFoiEntry(undefined, meta => {
      meta.respondedAt = null;
      meta.respondedAtNote = 'the published letter is undated; bounded by the list applicability date';
    });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry')).toEqual([]);
  });

  it('FoiEntry_TodoDatePlaceholder_Fails', () => {
    // A scaffolded entry must be unmergeable until authored.
    writeFoiEntry(undefined, meta => { meta.requestedAt = 'TODO'; });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/requestedAt is not a parseable date: "TODO"/);
  });
});

describe('validateFoiEntry - dataVintage and datasetRecovery', () => {
  it('FoiEntry_DataFileWithNullDataVintage_Fails', () => {
    writeFoiEntry(undefined, meta => { meta.dataVintage = null; });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/dataVintage is null but the entry declares data files/);
  });

  it('FoiEntry_AttestedVintageWithoutDataFiles_RequiresDatasetRecovery', () => {
    const dir = writeFoiEntry(undefined, meta => { removeDataFile(path.join(foiDir, 'wdtk-123456--test-entry'), meta); });
    void dir;
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/declare datasetRecovery/);
  });

  it('FoiEntry_AttestedVintageWithDatasetRecovery_Passes', () => {
    // The ofcom-285990 shape: the response disclosed a dataset at a known
    // vintage, but the bytes were never recovered.
    writeFoiEntry(undefined, meta => {
      removeDataFile(path.join(foiDir, 'wdtk-123456--test-entry'), meta);
      meta.datasetRecovery = 'unrecovered';
    });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry')).toEqual([]);
  });

  it('FoiEntry_RecordOnlyEntry_PassesWithoutDatasetRecovery', () => {
    writeRecordOnlyEntry('wdtk-123456--test-entry');
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry')).toEqual([]);
  });

  it('FoiEntry_DatasetRecoveryWithoutAttestation_Fails', () => {
    writeRecordOnlyEntry('wdtk-123456--test-entry', meta => { meta.datasetRecovery = 'unrecovered'; });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/nothing is attested/);
  });

  it('FoiEntry_UnrecoveredContradictsDataFiles_Fails', () => {
    writeFoiEntry(undefined, meta => { meta.datasetRecovery = 'unrecovered'; });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/contradicts the declared data files/);
  });
});

describe('validateFoiEntry - referential integrity', () => {
  it('FoiEntry_UnknownConverterVariant_Fails', () => {
    writeFoiEntry(undefined, meta => { meta.converter = { script: 'src/shared/foi-normalise.ts', variant: 'no-such-variant' }; });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/"no-such-variant" is not in the conversion registry/);
  });

  it('FoiEntry_ConverterSourceFileNotDeclared_Fails', () => {
    // A real registry variant whose source files the fixture does not carry.
    writeFoiEntry(undefined, meta => { meta.converter = { script: 'src/shared/foi-normalise.ts', variant: 'wdtk-1180568-csv-pair' }; });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/reads "FOI 1900117 .+ sheet 1.csv" which is not declared/);
  });

  it('FoiEntry_DanglingKeyShapedRelatedEntry_Fails', () => {
    writeFoiEntry(undefined, meta => { meta.relatedEntries = [{ entry: 'wdtk-999999--gone', relation: 'sibling' }]; });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/no such sibling entry exists/);
  });

  it('FoiEntry_FreeTextRelatedEntry_Passes', () => {
    // 4 real entries carry drop-zone references - provenance prose, not links.
    writeFoiEntry(undefined, meta => {
      meta.relatedEntries = [{ entry: 'ofcom-foi-log/ukgwa 90397--Callsign-database-20-Sep.xlsx (drop zone)', relation: 'vintage sibling in the drop zone' }];
    });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry')).toEqual([]);
  });

  it('FoiEntry_DanglingExtractOf_Fails', () => {
    writeFoiEntry(undefined, meta => { meta.files['data.csv'].extractOf = 'workbook-that-was-never-declared.xlsx'; });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/extractOf references "workbook-that-was-never-declared.xlsx"/);
  });

  it('FoiEntry_MissingCorrespondenceDeclaration_Fails', () => {
    const dir = writeFoiEntry(undefined, meta => { delete meta.files['correspondence.md']; });
    fs.rmSync(path.join(dir, 'correspondence.md'));
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/must declare correspondence.md/);
  });
});

describe('validateFoiEntry - byte integrity', () => {
  it('FoiEntry_TamperedFileContent_FailsWithSha256Mismatch', () => {
    const dir = writeFoiEntry();
    // Same length, different bytes: the hash is the only witness.
    fs.writeFileSync(path.join(dir, 'data.csv'), DATA_CSV.replace('M7TEE', 'M0EVL'));
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/sha256 mismatch/);
  });

  it('FoiEntry_SizeMismatch_ReportsRootCauseWithoutHashNoise', () => {
    const dir = writeFoiEntry();
    fs.appendFileSync(path.join(dir, 'data.csv'), 'EXTRA,ROW\n');
    const problems = validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem);
    expect(problems.join()).toMatch(/size mismatch/);
    expect(problems.join()).not.toMatch(/sha256 mismatch/);
  });

  it('FoiEntry_DeclaredFileMissingFromDisk_Fails', () => {
    const dir = writeFoiEntry();
    fs.rmSync(path.join(dir, 'data.csv'));
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/absent from disk/);
  });

  it('FoiEntry_UndeclaredFileOnDisk_Fails', () => {
    const dir = writeFoiEntry();
    fs.writeFileSync(path.join(dir, 'stray-notes.txt'), 'not part of the record');
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/stray-notes.txt present on disk but not declared/);
  });

  it('FoiEntry_MalformedSha256Declaration_Fails', () => {
    writeFoiEntry(undefined, meta => { meta.files['data.csv'].sha256 = 'not-a-hash'; });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/sha256 must be 64 lowercase hex/);
  });
});

describe('validateFoiLaneAt', () => {
  it('FoiLane_MissingFoiDirectory_PassesWithZeroEntries', () => {
    const result = validateFoiLaneAt(path.join(foiDir, 'does-not-exist'));
    expect(result.problems).toEqual([]);
    expect(result.checkedEntries).toBe(0);
  });

  it('FoiLane_PresentButEmptyDirectory_Fails', () => {
    expect(validateFoiLaneAt(foiDir).problems[0].problem).toMatch(/contains no entries/);
  });

  it('FoiLane_RealArchive_AllEntriesPass', () => {
    // The merge gate applied to the actual record: every declared file in
    // every FOI entry hash-verified, every reference resolvable.
    const result = validateFoiLaneAt(REAL_FOI_DIR);
    expect(result.problems).toEqual([]);
    expect(result.checkedEntries).toBeGreaterThanOrEqual(25);
  });
});
