import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { validateArchiveEntry, deepValidateEntryCsv, validateLatestPointers, validateRepoData } from './validate-data.ts';
import { CONSTANTS } from '../shared/utils.ts';

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
      'raw.csv': { bytes: Buffer.byteLength(rawContent), sha256: sha256(rawContent), format: 'csv' },
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

// An entry with full line accounting: a v2022-minimal raw carrying one
// footer line, a normalised.csv, and the headerLines/ignoredLines
// declarations the sweep would write. Overrides let each test break one
// aspect of the contract.
function writeAccountedEntry(root: string, key: string, metaOverrides: Record<string, unknown> = {}): void {
  const raw = 'Value,Status,Type\nG5ABC,Allocated,Call Sign - Amateur\nM7TEE,Allocated,Call Sign - Amateur\nfooter text,,\n';
  const normalised = 'callsign,product,status,type,created_date,last_modified_date,licence_version_last_modified_date,licence_version_original_start_date\nG5ABC,,Allocated,Call Sign - Amateur,,,,\nM7TEE,,Allocated,Call Sign - Amateur,,,,\n';
  writeEntry(root, key, raw, {
    files: {
      'raw.csv': { bytes: Buffer.byteLength(raw), sha256: sha256(raw), format: 'csv' },
      'normalised.csv': { bytes: Buffer.byteLength(normalised), sha256: sha256(normalised), format: 'csv', recordCount: 2 },
    },
    normalised: { schemaVersion: 1, headerVariant: 'v2022-minimal' },
    headerLines: [{ line: 1, content: 'Value,Status,Type' }],
    ignoredLines: [{ line: 4, content: 'footer text,,', reason: 'no companion values (export furniture, not a register assertion)' }],
    ...metaOverrides,
  });
  fs.writeFileSync(path.join(root, CONSTANTS.DIRS.archive, key, 'normalised.csv'), normalised);
}

describe('validateArchiveEntry', { tags: ['unit'] }, () => {
  it('ArchiveEntry_WhenWellFormed_PassesValidation', () => {
    writeEntry(tmpRoot, '2026-06-23', CSV);
    const problems = validateArchiveEntry('2026-06-23');
    expect(problems).toEqual([]);
  });

  it('ArchiveEntry_WhenQualityObservationWellFormed_PassesValidation', () => {
    writeEntry(tmpRoot, '2026-06-23', CSV, {
      qualityObservations: [{ observedAt: '2026-07-09', statement: 'Omits blank-product records.', evidence: 'See issue #177.', coverageAffecting: true }],
    });
    expect(validateArchiveEntry('2026-06-23')).toEqual([]);
  });

  it('ArchiveEntry_WhenQualityObservationLacksEvidence_Fails', () => {
    // A cited observation with no citation is not an observation.
    writeEntry(tmpRoot, '2026-06-23', CSV, {
      qualityObservations: [{ observedAt: '2026-07-09', statement: 'Something is off.', evidence: '' }],
    });
    const problems = validateArchiveEntry('2026-06-23');
    expect(problems.some(p => p.problem.includes('qualityObservations[0].evidence'))).toBe(true);
  });

  it('ArchiveEntry_WhenLineAccountingComplete_PassesValidation', () => {
    writeAccountedEntry(tmpRoot, '2026-06-23');
    expect(validateArchiveEntry('2026-06-23')).toEqual([]);
  });

  it('ArchiveEntry_WhenIgnoredLineContentDrifts_Fails', () => {
    writeAccountedEntry(tmpRoot, '2026-06-23', {
      ignoredLines: [{ line: 4, content: 'something else entirely', reason: 'no companion values' }],
    });
    const problems = validateArchiveEntry('2026-06-23');
    expect(problems.some(p => p.problem.includes('content mismatch'))).toBe(true);
  });

  it('ArchiveEntry_WhenIgnoredLineHasNoReason_Fails', () => {
    // Curated ignores are human judgements; a non-empty reason is the
    // minimum audit trail (there is deliberately no mechanical
    // can-this-be-ignored predicate - explicitness plus review is the guard).
    writeAccountedEntry(tmpRoot, '2026-06-23', {
      ignoredLines: [{ line: 4, content: 'footer text,,', reason: '  ' }],
    });
    const problems = validateArchiveEntry('2026-06-23');
    expect(problems.some(p => p.problem.includes('has no reason'))).toBe(true);
  });

  it('ArchiveEntry_WhenRowsVanishWithoutEnumeration_FailsTheCountInvariant', () => {
    // The checksum property: raw lines = header + normalised rows +
    // ignored. A footer line with no ignoredLines entry (or any silent row
    // loss in the derivation chain) breaks the arithmetic.
    writeAccountedEntry(tmpRoot, '2026-06-23', { ignoredLines: undefined });
    const problems = validateArchiveEntry('2026-06-23');
    // The message names the parse source (raw.csv here; an extract when an
    // entry declares one), so match on the invariant clause.
    expect(problems.some(p => p.problem.includes('line accounting failed'))).toBe(true);
  });

  it('ArchiveEntry_WhenHeaderLineDrifts_Fails', () => {
    writeAccountedEntry(tmpRoot, '2026-06-23', {
      headerLines: [{ line: 1, content: 'Value,Status,Type,ExtraColumn' }],
    });
    const problems = validateArchiveEntry('2026-06-23');
    expect(problems.some(p => p.problem.includes('headerLines: line 1 content mismatch'))).toBe(true);
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
        'raw.csv': { bytes: Buffer.byteLength(CSV), sha256: sha256(CSV), format: 'csv' },
        'annex.pdf': { bytes: 123, sha256: 'abc', format: 'other' },
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

describe('validateArchiveEntry - witness agreement and divergence (#618 increment 3)', { tags: ['unit'] }, () => {
  it('Witness_WhenHashMatchesTheHeldRaw_PassesAsCorroborating', () => {
    writeEntry(tmpRoot, '2026-06-23', CSV, {
      witnesses: [{ channel: 'wayback', url: 'https://web.archive.org/x/raw.csv', fetchedAt: '2026-07-06', sha256: sha256(CSV) }],
    });
    expect(validateArchiveEntry('2026-06-23')).toEqual([]);
  });

  it('Witness_WhenWitnessSha256Malformed_Fails', () => {
    writeEntry(tmpRoot, '2026-06-23', CSV, {
      witnesses: [{ channel: 'wayback', url: 'https://web.archive.org/x/raw.csv', fetchedAt: '2026-07-06', sha256: 'NOTHEX' }],
    });
    expect(validateArchiveEntry('2026-06-23').map(p => p.problem).join()).toMatch(/witnesses\[0\]\.sha256 must be 64 lowercase hex/);
  });

  it('Witness_WhenHashMatchesNoHeldCopyAndNoDivergenceRecord_FailsLoudly', () => {
    writeEntry(tmpRoot, '2026-06-23', CSV, {
      witnesses: [{ channel: 'wayback', url: 'https://web.archive.org/x/other.csv', fetchedAt: '2026-07-06', sha256: 'e'.repeat(64) }],
    });
    expect(validateArchiveEntry('2026-06-23').map(p => p.problem).join()).toMatch(/divergent.*but no divergence record explains it/);
  });

  it('Witness_WhenDivergentHashPairedWithADivergenceRecord_Passes', () => {
    writeEntry(tmpRoot, '2026-06-23', CSV, {
      witnesses: [{ channel: 'wayback', url: 'https://web.archive.org/x/other.csv', fetchedAt: '2026-07-06', sha256: 'e'.repeat(64) }],
      divergences: [{
        file: 'raw.csv',
        counterpart: { publisher: 'internet-archive', url: 'https://web.archive.org/x/other.csv', sha256: 'e'.repeat(64) },
        level: 'bytes',
        summary: 'a differing capture claiming to be the same publication',
      }],
    });
    expect(validateArchiveEntry('2026-06-23')).toEqual([]);
  });
});

describe('deepValidateEntryCsv', { tags: ['unit'] }, () => {
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
      files: { 'raw.csv': { bytes: Buffer.byteLength(CSV), sha256: sha256(CSV), format: 'csv', recordCount: 999 } },
    });
    const problems = deepValidateEntryCsv('2026-06-23');
    expect(problems.some(p => p.problem.includes('recordCount'))).toBe(true);
  });

  // Uniqueness is NOTED on raw (stats detectors) but ENFORCED on normalised:
  // raw.csv mirrors the publication verbatim, duplicates and all, while
  // normalised.csv is this repository's contract and downstream joins key on
  // callsign. The converter is the decision point for resolving publisher
  // duplicates; this check makes an unresolved duplicate an invalid PR.

  it('DeepValidation_WhenNormalisedHasDuplicateCallsigns_Fails', () => {
    writeEntry(tmpRoot, '2026-06-23', CSV);
    const normalised =
      'callsign,product,status,type,created_date,last_modified_date,licence_version_last_modified_date,licence_version_original_start_date\n'
      + 'M7TEE,Amateur Foundation Radio Licence,Allocated,,,,,\n'
      + 'M7TEE,Amateur Foundation Radio Licence,Reserved,,,,,\n';
    fs.writeFileSync(path.join(tmpRoot, 'archive', '2026-06-23', 'normalised.csv'), normalised);

    const problems = deepValidateEntryCsv('2026-06-23');
    expect(problems.some(p => p.problem.includes('duplicate') && p.problem.includes('M7TEE'))).toBe(true);
  });

  it('DeepValidation_WhenNormalisedHasMultipleEmptyCallsigns_UniquenessCheckDoesNotFail', () => {
    // Empty callsigns are exempt from the uniqueness constraint: multiple
    // empties exist in real publications (2023-02-20 has two) and their
    // handling policy is deliberately undecided - they are surfaced by the
    // emptyCallsign quality detector, and join consumers must exclude them.
    writeEntry(tmpRoot, '2026-06-23', CSV);
    const normalised =
      'callsign,product,status,type,created_date,last_modified_date,licence_version_last_modified_date,licence_version_original_start_date\n'
      + ',Amateur Foundation Radio Licence,Available,,,,,\n'
      + ',Amateur Foundation Radio Licence,Available,,,,,\n'
      + 'M7TEE,Amateur Foundation Radio Licence,Allocated,,,,,\n';
    fs.writeFileSync(path.join(tmpRoot, 'archive', '2026-06-23', 'normalised.csv'), normalised);

    const problems = deepValidateEntryCsv('2026-06-23');
    expect(problems.filter(p => p.problem.includes('duplicate'))).toEqual([]);
  });

  it('DeepValidation_WhenEntryShapeMatchesNoAuthoredBinding_UniquenessCheckSkipped', () => {
    // An entry whose header shape resolves to no authored raw->canonical
    // binding has no known callsign column to police; the check skips
    // honestly, and the ledger projection refuses such an entry loudly
    // before any surface publishes it.
    writeEntry(tmpRoot, '2026-06-23', CSV);
    expect(deepValidateEntryCsv('2026-06-23')).toEqual([]);
  });

  it('DeepValidation_PostFreezeEntryWithUnattestedDuplicates_FailsOnTheParseSource', () => {
    // A post-freeze entry carries no committed normalised.csv (ADR 0021), but
    // the attestation gate must not retire with the derivation: the callsign
    // column resolves through the same authored binding the ledger projection
    // uses (here detected from the entry's own v2022-minimal header row), and
    // the duplicate set is identical to the one the normalised contract would
    // have carried - the normaliser copies the token verbatim, row for row.
    const raw = 'Value,Status,Type\nM7TEE,Allocated,Call Sign - Amateur\nM7TEE,Reserved,Call Sign - Amateur\n';
    writeEntry(tmpRoot, '2026-06-23', raw);

    const problems = deepValidateEntryCsv('2026-06-23');

    expect(problems.some(p => p.problem.includes('duplicate') && p.problem.includes('M7TEE'))).toBe(true);
  });

  it('DeepValidation_PostFreezeEntryWithAttestedDuplicates_Passes', () => {
    // The same publication with the duplicates attested in a curated
    // qualityObservation is preserved faithfully - loud, reviewed, and
    // machine-visible to join consumers - exactly as on the frozen baseline.
    const raw = 'Value,Status,Type\nM7TEE,Allocated,Call Sign - Amateur\nM7TEE,Reserved,Call Sign - Amateur\n';
    writeEntry(tmpRoot, '2026-06-23', raw, {
      qualityObservations: [{
        observedAt: '2026-07-17',
        statement: 'The publication repeats duplicate callsigns (M7TEE appears twice, Allocated and Reserved).',
        evidence: 'Rows 2-3 of raw.csv as published.',
      }],
    });

    const problems = deepValidateEntryCsv('2026-06-23');

    expect(problems.filter(p => p.problem.includes('duplicate'))).toEqual([]);
  });

  it('DeepValidation_PostFreezeEntryWithBoundVariantAndUniqueCallsigns_Passes', () => {
    // The happy path for the next live publication: an authored binding
    // resolves (detection), the callsign column carries no duplicates, and
    // the entry validates with nothing committed beyond raw + meta.
    const raw = 'Value,Status,Type\nG5ABC,Allocated,Call Sign - Amateur\nM7TEE,Allocated,Call Sign - Amateur\n';
    writeEntry(tmpRoot, '2026-06-23', raw);
    expect(deepValidateEntryCsv('2026-06-23')).toEqual([]);
  });
});

describe('validateLatestPointers', { tags: ['unit'] }, () => {
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

describe('validateRepoData (orchestrating check used by CI)', { tags: ['unit'] }, () => {
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

  it('RepoData_WithFoiLane_CountsBothLanesInReport', () => {
    // The FOI lane joins the same required check (ADR 0004 point 4): a
    // well-formed FOI entry is counted; a tampered one fails the report.
    writeEntry(tmpRoot, '2026-06-23', CSV);
    writeLatestSet(tmpRoot, '2026-06-23');
    const foiDirPath = path.join(tmpRoot, 'archive', 'foi', 'wdtk-111--fixture');
    fs.mkdirSync(foiDirPath, { recursive: true });
    const correspondence = '# record\n';
    fs.writeFileSync(path.join(foiDirPath, 'correspondence.md'), correspondence);
    fs.writeFileSync(path.join(foiDirPath, 'meta.json'), JSON.stringify({
      schemaVersion: 1,
      sourceKey: 'wdtk-foi',
      requestId: 111,
      ofcomReference: null,
      requestUrl: null,
      title: 'Fixture',
      requester: null,
      requestedAt: '2015-01-01',
      respondedAt: '2015-02-01',
      outcome: 'not held',
      dataVintage: null,
      datasetClasses: ['reference-context'],
      converter: null,
      files: { 'correspondence.md': { bytes: Buffer.byteLength(correspondence), sha256: sha256(correspondence), role: 'transcript' } },
    }, null, 2));
    const report = validateRepoData(['2026-06-23']);
    expect(report.ok).toBe(true);
    expect(report.checkedEntries).toBe(1);
    expect(report.checkedFoiEntries).toBe(1);

    fs.appendFileSync(path.join(foiDirPath, 'correspondence.md'), 'tamper\n');
    expect(validateRepoData(['2026-06-23']).ok).toBe(false);
  });
});
