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

describe('validateFoiEntry - shape and vocabularies', { tags: ['unit'] }, () => {
  it('FoiEntry_WellFormedFixture_Passes', () => {
    writeFoiEntry();
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry')).toEqual([]);
  });

  it('FoiEntry_TitleWithBacktickCodeSpan_Fails', () => {
    // A backtick in the title renders as a literal backtick in the escaped
    // page <title>/<h1>, not a code span (#332).
    writeFoiEntry(undefined, meta => { meta.title = 'Register snapshot (Ofcom `__data` asset)'; });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/title contains markdown syntax/);
  });

  it('FoiEntry_TitleWithInlineLink_Fails', () => {
    writeFoiEntry(undefined, meta => { meta.title = 'See [the workbook](https://example.test/x)'; });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/title contains markdown syntax/);
  });

  it('FoiEntry_TitleWithLiteralUnderscoresButNoMarkdown_Passes', () => {
    // The legitimate literal (an Ofcom `__data` asset name) with the backticks
    // removed must NOT trip the guard - underscores are not forbidden.
    writeFoiEntry(undefined, meta => { meta.title = 'Amateur callsign database (Ofcom __data asset)'; });
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

describe('validateFoiEntry - dates', { tags: ['unit'] }, () => {
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

describe('validateFoiEntry - dataVintage and datasetRecovery', { tags: ['unit'] }, () => {
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

describe('validateFoiEntry - referential integrity', { tags: ['unit'] }, () => {
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

// relatedEntries' typed relation (#580): 'same-dataset' asserts the SAME
// underlying dataset obtained through a different source, an identity that
// is symmetric by definition - the validator requires both sides to declare
// each other, on top of the untyped existence-only check every relation gets.
describe('validateFoiEntry - relatedEntries relationType (#580)', { tags: ['unit'] }, () => {
  it('FoiEntry_UntypedRelatedEntry_DoesNotRequireSymmetry', () => {
    // The pre-existing, still-supported shape: free-prose cross-references
    // with no relationType are one-sided by design and stay existence-only.
    writeFoiEntry('wdtk-654321--other-entry');
    writeFoiEntry(undefined, meta => {
      meta.relatedEntries = [{ entry: 'wdtk-654321--other-entry', relation: 'an earlier disclosure covering the same period' }];
    });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry')).toEqual([]);
  });

  it('FoiEntry_UnknownRelationType_Fails', () => {
    writeFoiEntry('wdtk-654321--other-entry');
    writeFoiEntry(undefined, meta => {
      meta.relatedEntries = [{ entry: 'wdtk-654321--other-entry', relation: 'x', relationType: 'mystery-type' }];
    });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/relationType "mystery-type" is not in the vocabulary/);
  });

  it('FoiEntry_SameDatasetRelationTypeOnFreeTextReference_Fails', () => {
    // A typed identity claim needs a real sibling to check reciprocity
    // against - a free-text drop-zone note cannot reciprocate anything.
    writeFoiEntry(undefined, meta => {
      meta.relatedEntries = [{ entry: 'ofcom-foi-log/drop-zone-note (drop zone)', relation: 'suspected sibling', relationType: 'same-dataset' }];
    });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/requires a real sibling entry, not the free-text reference/);
  });

  it('FoiEntry_SameDatasetRelationOneSided_Fails', () => {
    // A declares B a same-dataset sibling; B says nothing back - a one-sided
    // identity claim, which the symmetry rule must catch.
    writeFoiEntry('wdtk-654321--other-entry');
    writeFoiEntry(undefined, meta => {
      meta.relatedEntries = [{ entry: 'wdtk-654321--other-entry', relation: 'the same export via a different channel', relationType: 'same-dataset' }];
    });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join())
      .toMatch(/declares "wdtk-654321--other-entry" as relationType "same-dataset", but "wdtk-654321--other-entry" does not declare "wdtk-123456--test-entry" back.*must be symmetric/);
  });

  it('FoiEntry_SameDatasetRelationReciprocated_Passes', () => {
    writeFoiEntry('wdtk-654321--other-entry', meta => {
      meta.requestId = 654321;
      meta.relatedEntries = [{ entry: 'wdtk-123456--test-entry', relation: 'the same export via a different channel', relationType: 'same-dataset' }];
    });
    writeFoiEntry(undefined, meta => {
      meta.relatedEntries = [{ entry: 'wdtk-654321--other-entry', relation: 'the same export via a different channel', relationType: 'same-dataset' }];
    });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry')).toEqual([]);
    expect(validateFoiEntry(foiDir, 'wdtk-654321--other-entry')).toEqual([]);
  });

  it('FoiEntry_SameDatasetRelationWhereSiblingReciprocatesUntyped_Fails', () => {
    // B references A back, but with no relationType at all (an untyped,
    // free-prose cross-reference) - that is not a reciprocation of the
    // typed identity claim.
    writeFoiEntry('wdtk-654321--other-entry', meta => {
      meta.relatedEntries = [{ entry: 'wdtk-123456--test-entry', relation: 'covers an overlapping period' }];
    });
    writeFoiEntry(undefined, meta => {
      meta.relatedEntries = [{ entry: 'wdtk-654321--other-entry', relation: 'the same export via a different channel', relationType: 'same-dataset' }];
    });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/must be symmetric/);
  });

  it('FoiEntry_SameDatasetRelationWhereSiblingReciprocatesWithADifferentRelationType_Fails', () => {
    // B references A back under a DIFFERENT relationType (a hypothetical
    // second type, distinct from the vocabulary check above) - reciprocation
    // requires the SAME type, not merely a typed relation of some kind.
    writeFoiEntry('wdtk-654321--other-entry', meta => {
      meta.relatedEntries = [{ entry: 'wdtk-123456--test-entry', relation: 'a differently-typed back-reference', relationType: 'variant-of' }];
    });
    writeFoiEntry(undefined, meta => {
      meta.relatedEntries = [{ entry: 'wdtk-654321--other-entry', relation: 'the same export via a different channel', relationType: 'same-dataset' }];
    });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/must be symmetric/);
  });

  it('FoiEntry_SiblingWithMalformedRelatedEntries_FailsWithoutThrowing', () => {
    // A validator must locate malformation, not crash on it: a sibling whose
    // own relatedEntries is not an array (a string, here) must be reported as
    // a clear, locatable failure rather than throwing and aborting the run.
    writeFoiEntry('wdtk-654321--other-entry', meta => {
      // @ts-expect-error - deliberately malformed to exercise the guard.
      meta.relatedEntries = 'not-an-array';
    });
    writeFoiEntry(undefined, meta => {
      meta.relatedEntries = [{ entry: 'wdtk-654321--other-entry', relation: 'the same export via a different channel', relationType: 'same-dataset' }];
    });
    expect(() => validateFoiEntry(foiDir, 'wdtk-123456--test-entry')).not.toThrow();
    const problems = validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join();
    expect(problems).toMatch(/"wdtk-654321--other-entry"'s own relatedEntries is malformed \(not an array\)/);
  });

  it('FoiEntry_SiblingWithMalformedItemInRelatedEntries_FailsWithoutThrowing', () => {
    // The sibling's relatedEntries IS an array (so the array-shape guard
    // above does not fire), but one of its items is null - reading `.entry`
    // on it must not throw. It simply cannot reciprocate, so the ordinary
    // non-reciprocation failure fires (the sibling's own malformed item is
    // reported by the sibling's own validation pass, not duplicated here).
    writeFoiEntry('wdtk-654321--other-entry', meta => {
      // @ts-expect-error - deliberately malformed to exercise the guard.
      meta.relatedEntries = [null];
    });
    writeFoiEntry(undefined, meta => {
      meta.relatedEntries = [{ entry: 'wdtk-654321--other-entry', relation: 'the same export via a different channel', relationType: 'same-dataset' }];
    });
    expect(() => validateFoiEntry(foiDir, 'wdtk-123456--test-entry')).not.toThrow();
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/must be symmetric/);
  });

  it('FoiEntry_WithMalformedOwnRelatedEntries_FailsWithoutThrowing', () => {
    // The same guard, applied to the entry's OWN relatedEntries: a non-array
    // value must be reported, not thrown through a `for..of` that assumes
    // an array.
    writeFoiEntry(undefined, meta => {
      // @ts-expect-error - deliberately malformed to exercise the guard.
      meta.relatedEntries = 42;
    });
    expect(() => validateFoiEntry(foiDir, 'wdtk-123456--test-entry')).not.toThrow();
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/relatedEntries is malformed \(not an array\)/);
  });

  it('FoiEntry_WithNullItemInOwnRelatedEntries_FailsWithoutThrowing', () => {
    // A well-formed array whose item is null (or otherwise not an object)
    // cannot be read as `related.entry` safely - guard the item, not just
    // the array shape.
    writeFoiEntry(undefined, meta => {
      // @ts-expect-error - deliberately malformed to exercise the guard.
      meta.relatedEntries = [null];
    });
    expect(() => validateFoiEntry(foiDir, 'wdtk-123456--test-entry')).not.toThrow();
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/relatedEntries items need non-empty entry and relation/);
  });
});

describe('validateFoiEntry - byte integrity', { tags: ['unit'] }, () => {
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

// recordCount (#683): the exact row count a converter computed while
// producing a normalised file, persisted alongside bytes/sha256 the same way
// ArchivedFileMeta.recordCount is for the open-data lane.
describe('validateFoiEntry - recordCount', { tags: ['unit'] }, () => {
  it('FoiEntry_NoRecordCountDeclared_Passes', () => {
    // The common case for files that were never mechanically parsed
    // (letters, transcripts) - recordCount is optional, not required.
    writeFoiEntry();
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry')).toEqual([]);
  });

  it('FoiEntry_NonNegativeIntegerRecordCount_Passes', () => {
    writeFoiEntry(undefined, meta => { meta.files['data.csv'].recordCount = 2; });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry')).toEqual([]);
  });

  it('FoiEntry_NegativeRecordCount_Fails', () => {
    writeFoiEntry(undefined, meta => { meta.files['data.csv'].recordCount = -1; });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/recordCount must be a non-negative integer/);
  });

  it('FoiEntry_NonIntegerRecordCount_Fails', () => {
    writeFoiEntry(undefined, meta => { meta.files['data.csv'].recordCount = 1.5; });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/recordCount must be a non-negative integer/);
  });
});

describe('validateFoiEntry - witness agreement and divergence (#618 increment 3)', { tags: ['unit'] }, () => {
  it('FoiWitness_WhenHashMatchesTheHeldFile_PassesAsCorroborating', () => {
    writeFoiEntry(undefined, meta => {
      meta.files['data.csv'].witnesses = [{ channel: 'wdtk', url: 'https://example.org/data.csv', sha256: sha256(DATA_CSV) }];
    });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry')).toEqual([]);
  });

  it('FoiWitness_WhenWitnessSha256Malformed_Fails', () => {
    writeFoiEntry(undefined, meta => {
      meta.files['data.csv'].witnesses = [{ channel: 'wdtk', url: 'https://example.org/data.csv', sha256: 'NOTAHASH' }];
    });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/witness sha256 must be 64 lowercase hex/);
  });

  it('FoiWitness_WhenHashMatchesNoHeldCopyAndNoDivergenceRecord_FailsLoudly', () => {
    writeFoiEntry(undefined, meta => {
      meta.files['data.csv'].witnesses = [{ channel: 'wdtk', url: 'https://example.org/other.csv', sha256: 'f'.repeat(64) }];
    });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/divergent.*but no divergence record explains it/);
  });

  it('FoiWitness_WhenDivergentHashPairedWithADivergenceRecord_Passes', () => {
    writeFoiEntry(undefined, meta => {
      meta.files['data.csv'].witnesses = [{ channel: 'wdtk', url: 'https://example.org/other.csv', sha256: 'f'.repeat(64) }];
      meta.divergences = [{
        file: 'data.csv',
        counterpart: { publisher: 'ofcom', url: 'https://example.org/other.csv', sha256: 'f'.repeat(64) },
        level: 'cells',
        summary: 'a differing copy of the same disclosure',
      }];
    });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry')).toEqual([]);
  });

  it('FoiEntry_WhenDivergentCopyHeldInFullWithValidDivergesFrom_Passes', () => {
    const DIVERGENT = DATA_CSV.replace('Available', 'Allocated');
    writeFoiEntry(undefined, meta => {
      meta.files['divergent-copy.csv'] = {
        bytes: Buffer.byteLength(DIVERGENT),
        sha256: sha256(DIVERGENT),
        role: 'divergent-copy',
        divergesFrom: 'data.csv',
      };
      meta.divergences = [{
        file: 'data.csv',
        counterpart: { publisher: 'ofcom', url: 'https://example.org/copy.csv', sha256: sha256(DIVERGENT), heldAs: 'divergent-copy.csv' },
        level: 'cells',
        summary: 'the status column differs',
      }];
    });
    fs.writeFileSync(path.join(foiDir, 'wdtk-123456--test-entry', 'divergent-copy.csv'), DIVERGENT);
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry')).toEqual([]);
  });

  it('FoiEntry_WhenDivergesFromReferencesAnUndeclaredFile_Fails', () => {
    const DIVERGENT = DATA_CSV.replace('Available', 'Allocated');
    writeFoiEntry(undefined, meta => {
      meta.files['divergent-copy.csv'] = {
        bytes: Buffer.byteLength(DIVERGENT),
        sha256: sha256(DIVERGENT),
        role: 'divergent-copy',
        divergesFrom: 'ghost.csv',
      };
    });
    fs.writeFileSync(path.join(foiDir, 'wdtk-123456--test-entry', 'divergent-copy.csv'), DIVERGENT);
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/divergesFrom references "ghost.csv" which is not declared/);
  });

  it('FoiEntry_WhenDivergenceRecordNamesAnUndeclaredFile_Fails', () => {
    writeFoiEntry(undefined, meta => {
      meta.divergences = [{
        file: 'ghost.csv',
        counterpart: { publisher: 'ofcom', url: 'https://example.org/other.csv', sha256: 'f'.repeat(64) },
        level: 'bytes',
        summary: 'names a file that does not exist',
      }];
    });
    expect(validateFoiEntry(foiDir, 'wdtk-123456--test-entry').map(p => p.problem).join()).toMatch(/divergences\[0\]\.file "ghost.csv" does not name a declared file/);
  });
});

describe('validateFoiLaneAt', { tags: ['data-validity'] }, () => {
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
