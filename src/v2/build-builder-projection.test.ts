import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildBuilderProjection, entryDerivativesFor, PROJECTED_ENTRY_FILES } from './build-builder-projection.ts';
import { projectPublicationFromClaims } from './build-projection-db.ts';
import { serialiseClaimsJsonl } from './serialise.ts';
import { LISTED_PREDICATE, type Claim } from './claim.ts';
import { convertRawCsv } from '../sources/ofcom-amateur/normalise.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';
import { renderStatsJson } from '../shared/stats.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The builder-facing ledger projection (issue #629 phase 1) on synthetic
// sources: the same rows travel BOTH lanes - the converter lane (a raw CSV
// through convertRawCsv, the lane that writes the committed archive files) and
// the ledger lane (claims through the fold and entryDerivativesFor) - and the
// serialised derivative files must agree byte for byte. The full-corpus twin
// of this obligation (every real archive entry, both lanes) is the heavy
// parity gate in builder-projection-parity.test.ts.

const REF = loadReferenceData();

// Fixture claims for one open-data source: the @listed anchor per row plus one
// raw attribute claim per non-empty non-subject cell - exactly the multiset the
// raw emit stores (raw-emit.ts), so the fold is exercised on the stored shape.
function claimsFor(key: string, subjectColumn: string, rows: Record<string, string>[]): Claim[] {
  const sourceFile = `opendata/${key}/raw.csv`;
  const claims: Claim[] = [];
  rows.forEach((row, ordinal) => {
    const rawSubject = row[subjectColumn] ?? '';
    const provenance = { sourceFile, ordinal, vintage: key };
    claims.push({ layer: 'raw', rawSubject, predicate: LISTED_PREDICATE, object: '', provenance });
    for (const [column, value] of Object.entries(row)) {
      if (column === subjectColumn || value === '') continue;
      claims.push({ layer: 'raw', rawSubject, predicate: column, object: value, provenance });
    }
  });
  return claims;
}

// A CSV cell rendered as Ofcom's exports render it (no embedded quotes/commas
// in these fixtures, so verbatim), for building the converter lane's raw text.
function rawCsvFor(header: string[], rows: Record<string, string>[]): string {
  const lines = [header.join(',')];
  for (const row of rows) lines.push(header.map(column => row[column] ?? '').join(','));
  return lines.join('\n') + '\n';
}

// One deliberately interesting register: date columns (day-first), a duplicate
// callsign pair (whole-row tie-break), an artefact-bearing callsign that
// collides with its stripped twin (whole-set flag + quality detectors), a
// lowercase callsign, and a blank product.
const SALESFORCE_HEADER = ['Value__c', 'Product__c', 'Status__c', 'Type__c', 'CreatedDate', 'LastModifiedDate'];
const FIXTURE_ROWS: Record<string, string>[] = [
  { 'Value__c': 'M7TEE', 'Product__c': 'Amateur Radio (Foundation)', 'Status__c': 'Allocated', 'Type__c': 'Amateur', 'CreatedDate': '23/06/2021 09:15:00', 'LastModifiedDate': '01/02/2023 10:11' },
  { 'Value__c': 'G0AAA', 'Product__c': 'Amateur Radio (Full)', 'Status__c': 'Allocated', 'Type__c': 'Amateur', 'CreatedDate': '15/03/1999', 'LastModifiedDate': '' },
  { 'Value__c': 'G0AAA', 'Product__c': 'Amateur Radio (Full)', 'Status__c': 'Reserved', 'Type__c': 'Amateur', 'CreatedDate': '15/03/1999', 'LastModifiedDate': '' },
  { 'Value__c': 'G6 FMU', 'Product__c': 'Amateur Radio (Full)', 'Status__c': 'Allocated', 'Type__c': 'Amateur', 'CreatedDate': '', 'LastModifiedDate': '' },
  { 'Value__c': 'G6FMU', 'Product__c': 'Amateur Radio (Full)', 'Status__c': 'Allocated', 'Type__c': 'Amateur', 'CreatedDate': '', 'LastModifiedDate': '' },
  { 'Value__c': 'g0jrk', 'Product__c': '', 'Status__c': 'Available', 'Type__c': 'Amateur', 'CreatedDate': '', 'LastModifiedDate': '' },
];

describe('entryDerivativesFor', { tags: ['unit'] }, () => {
  it('EntryDerivatives_SameRowsThroughConverterAndLedgerLanes_SerialiseByteIdentically', () => {
    // The two lanes: convertRawCsv over the raw text (what the sweep commits)
    // vs the claim fold + entryDerivativesFor (what the projection writes).
    // All three derivative files must agree byte for byte - the exact parity
    // obligation the heavy gate proves over the real corpus.
    const converted = convertRawCsv(rawCsvFor(SALESFORCE_HEADER, FIXTURE_ROWS), { referenceDateIso: '2099-01-01' });
    const publication = projectPublicationFromClaims(claimsFor('2099-01-01', 'Value__c', FIXTURE_ROWS), REF, 'v2025-salesforce');
    const derivatives = entryDerivativesFor(publication);
    expect(derivatives.normalisedCsv).toBe(converted.csv);
    expect(derivatives.componentsCsv).toBe(converted.componentsCsv);
    expect(derivatives.statsJson).toBe(renderStatsJson(converted.stats));
  });

  it('EntryDerivatives_StatsJson_CarriesTheDetectorAndFlagAggregates', () => {
    // The stats aggregate must reflect the fixture's deliberate anomalies -
    // the whitespace-bearing artefact, the lowercase callsign and the
    // stripped-collision flag - proving the ledger lane derives statistics
    // from its own folded rows, not from any committed file.
    const publication = projectPublicationFromClaims(claimsFor('2099-01-01', 'Value__c', FIXTURE_ROWS), REF, 'v2025-salesforce');
    const stats = JSON.parse(entryDerivativesFor(publication).statsJson) as {
      recordCount: number;
      callsignQuality: { whitespaceBearing: { count: number }; lowercaseBearing: { count: number; examples: string[] } };
      callsignFlags: Record<string, number>;
    };
    expect(stats.recordCount).toBe(FIXTURE_ROWS.length);
    expect(stats.callsignQuality.whitespaceBearing.count).toBe(1);
    expect(stats.callsignQuality.lowercaseBearing.examples).toContain('g0jrk');
    expect(stats.callsignFlags['stripped-collision']).toBe(1);
  });
});

describe('buildBuilderProjection', { tags: ['unit'] }, () => {
  let scratch: string;

  beforeAll(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-projection-test-'));
  });

  afterAll(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  // Materialise a scratch ledger emit + curated archive meta for one or more
  // fixture publications, mirroring the on-disk shape the deploy's shared
  // --ledger-dir emit has.
  // Each fixture publication's archive entry carries meta.json and, when
  // rawHeader is given, a raw.csv whose header row is the entry's OWN header
  // observation source (what a real fetch commits) - the projection resolves
  // the authored binding from it when meta declares nothing, and cross-checks
  // a declaration against it when it does.
  function stageFixture(name: string, publications: { key: string; rows: Record<string, string>[]; variant?: string; rawHeader?: string[] }[], extraLedgerFiles: Record<string, Claim[]> = {}): { ledgerRoot: string; archiveDir: string; outDir: string } {
    const root = path.join(scratch, name);
    const ledgerDir = path.join(root, 'ledger-root', 'ledger');
    const archiveDir = path.join(root, 'archive');
    fs.mkdirSync(ledgerDir, { recursive: true });
    for (const publication of publications) {
      fs.writeFileSync(
        path.join(ledgerDir, `opendata-${publication.key}.jsonl`),
        serialiseClaimsJsonl(claimsFor(publication.key, 'Value__c', publication.rows)),
      );
      const metaDir = path.join(archiveDir, publication.key);
      fs.mkdirSync(metaDir, { recursive: true });
      fs.writeFileSync(path.join(metaDir, 'meta.json'), JSON.stringify({
        normalised: publication.variant === undefined ? undefined : { headerVariant: publication.variant },
      }));
      if (publication.rawHeader !== undefined) {
        fs.writeFileSync(path.join(metaDir, 'raw.csv'), rawCsvFor(publication.rawHeader, publication.rows));
      }
    }
    for (const [fileName, claims] of Object.entries(extraLedgerFiles)) {
      fs.writeFileSync(path.join(ledgerDir, fileName), serialiseClaimsJsonl(claims));
    }
    return { ledgerRoot: path.join(root, 'ledger-root'), archiveDir, outDir: path.join(root, 'out') };
  }

  it('BuilderProjection_ReusedLedgerEmit_WritesEveryEntrysDerivativeFilesByteIdentically', () => {
    const { ledgerRoot, archiveDir, outDir } = stageFixture('two-publications', [
      { key: '2099-01-01', rows: FIXTURE_ROWS, variant: 'v2025-salesforce' },
      { key: '2099-06-01', rows: FIXTURE_ROWS.slice(0, 2), variant: 'v2025-salesforce' },
    ]);

    const result = buildBuilderProjection(outDir, { ledgerDir: ledgerRoot, archiveDir });

    expect(result.entries.map(e => e.key)).toEqual(['2099-01-01', '2099-06-01']);
    expect(result.entries.map(e => e.recordCount)).toEqual([6, 2]);
    for (const key of ['2099-01-01', '2099-06-01']) {
      for (const file of PROJECTED_ENTRY_FILES) {
        expect(fs.existsSync(path.join(outDir, key, file)), `${key}/${file}`).toBe(true);
      }
    }
    // The written bytes are the converter lane's bytes: the committed-file
    // equivalence the parity gate holds over the real corpus.
    const converted = convertRawCsv(rawCsvFor(SALESFORCE_HEADER, FIXTURE_ROWS), { referenceDateIso: '2099-01-01' });
    expect(fs.readFileSync(path.join(outDir, '2099-01-01', 'normalised.csv'), 'utf8')).toBe(converted.csv);
    expect(fs.readFileSync(path.join(outDir, '2099-01-01', 'components.csv'), 'utf8')).toBe(converted.componentsCsv);
    expect(fs.readFileSync(path.join(outDir, '2099-01-01', 'stats.json'), 'utf8')).toBe(renderStatsJson(converted.stats));
  });

  it('BuilderProjection_NonOpenDataLedgerFilesPresent_AreSkippedNotProjected', () => {
    // The deploy's shared emit carries the FOI families too; the builder
    // projection folds the open-data register lane only (the FOI derivatives
    // need the reconstruction tiers, #447), so a FOI ledger file must be
    // skipped without contaminating the output.
    const foiClaims: Claim[] = [{
      layer: 'raw', rawSubject: 'M7TEE', predicate: LISTED_PREDICATE, object: '',
      provenance: { sourceFile: 'foi/some-request/response.csv', ordinal: 0, vintage: '2099-01-01' },
    }];
    const { ledgerRoot, archiveDir, outDir } = stageFixture('with-foi', [
      { key: '2099-01-01', rows: FIXTURE_ROWS.slice(0, 1), variant: 'v2025-salesforce' },
    ], { 'foi-some-request.jsonl': foiClaims });

    const result = buildBuilderProjection(outDir, { ledgerDir: ledgerRoot, archiveDir });

    expect(result.entries.map(e => e.key)).toEqual(['2099-01-01']);
    expect(fs.readdirSync(outDir)).toEqual(['2099-01-01']);
  });

  it('BuilderProjection_FreshlyFetchedEntryWithoutDeclarations_ProjectsViaItsOwnHeaderRow', () => {
    // The new-publication lane (issue #629 phase 3): a freshly fetched entry
    // carries raw + meta only - no normalised.headerVariant (the derivation
    // lane used to write it) and no converter.variant. The authored registry
    // detects the variant from the entry's own header row - so the projection
    // must fold it without any curation, byte-identical to what the converter
    // lane would have derived.
    const { ledgerRoot, archiveDir, outDir } = stageFixture('fresh-fetch', [
      { key: '2099-01-01', rows: FIXTURE_ROWS, rawHeader: [...SALESFORCE_HEADER] },
    ]);

    const result = buildBuilderProjection(outDir, { ledgerDir: ledgerRoot, archiveDir });

    expect(result.entries.map(e => e.key)).toEqual(['2099-01-01']);
    const converted = convertRawCsv(rawCsvFor(SALESFORCE_HEADER, FIXTURE_ROWS), { referenceDateIso: '2099-01-01' });
    expect(fs.readFileSync(path.join(outDir, '2099-01-01', 'normalised.csv'), 'utf8')).toBe(converted.csv);
    expect(fs.readFileSync(path.join(outDir, '2099-01-01', 'components.csv'), 'utf8')).toBe(converted.componentsCsv);
    expect(fs.readFileSync(path.join(outDir, '2099-01-01', 'stats.json'), 'utf8')).toBe(renderStatsJson(converted.stats));
  });

  it('BuilderProjection_DeclaredVariantContradictingTheHeaderRow_FailsLoudly', () => {
    // A declaration that contradicts the published file's own header row is an
    // integrity failure - the projection must refuse rather than fold under
    // either binding.
    const { ledgerRoot, archiveDir, outDir } = stageFixture('contradicting-variant', [
      { key: '2099-01-01', rows: FIXTURE_ROWS.slice(0, 1), variant: 'v2022-minimal', rawHeader: [...SALESFORCE_HEADER] },
    ]);

    expect(() => buildBuilderProjection(outDir, { ledgerDir: ledgerRoot, archiveDir }))
      .toThrow(/contradicts the published header row/);
  });

  it('BuilderProjection_HeaderRowMatchingNoAuthoredVariant_FailsLoudly', () => {
    // A genuinely new export shape has no authored raw->canonical binding yet:
    // detection must refuse loudly (naming the headers), never guess one.
    const { ledgerRoot, archiveDir, outDir } = stageFixture('unknown-shape', [
      { key: '2099-01-01', rows: FIXTURE_ROWS.slice(0, 1), rawHeader: ['Mystery__c', 'Columns__c'] },
    ]);

    expect(() => buildBuilderProjection(outDir, { ledgerDir: ledgerRoot, archiveDir }))
      .toThrow(/matches no authored variant/);
  });

  it('BuilderProjection_EntryWithoutDeclarationsOrReadableHeader_FailsLoudly', () => {
    // No curated declaration AND no readable header row (no raw file staged):
    // there is nothing to resolve the authored binding from, so the build
    // must refuse rather than guess.
    const { ledgerRoot, archiveDir, outDir } = stageFixture('no-variant', [
      { key: '2099-01-01', rows: FIXTURE_ROWS.slice(0, 1) },
    ]);

    expect(() => buildBuilderProjection(outDir, { ledgerDir: ledgerRoot, archiveDir }))
      .toThrow(/cannot resolve the authored raw->canonical binding/);
  });

  it('BuilderProjection_UndeclaredTwinShapedSourceWithIsoDates_FailsLoudlyAtDateInterpretation', () => {
    // The ISO workbook-extract twin shares its header row with the day-first
    // primary, so header detection resolves the PRIMARY by authored design
    // (the twin exists only through a curated converter.variant). A
    // twin-shaped source left uncurated must therefore fail loudly when its
    // ISO date cells refuse the primary's day-first interpretation - never
    // fold silently under the wrong binding.
    const isoHeader = ['Callsign', 'Product__c', 'Status', 'Type__c', 'Licence_Version.LastModifiedDate', 'Licence_Version.Original_start_date__c'];
    const isoRows: Record<string, string>[] = [{
      'Callsign': 'M7TEE',
      'Product__c': 'Amateur Radio (Foundation)',
      'Status': 'Allocated',
      'Type__c': 'Amateur',
      'Licence_Version.LastModifiedDate': '2099-01-01 00:00:00',
      'Licence_Version.Original_start_date__c': '2099-01-01',
    }];
    const root = path.join(scratch, 'undeclared-iso-twin');
    const ledgerDir = path.join(root, 'ledger-root', 'ledger');
    const archiveDir = path.join(root, 'archive');
    fs.mkdirSync(ledgerDir, { recursive: true });
    fs.writeFileSync(path.join(ledgerDir, 'opendata-2099-01-01.jsonl'), serialiseClaimsJsonl(claimsFor('2099-01-01', 'Callsign', isoRows)));
    fs.mkdirSync(path.join(archiveDir, '2099-01-01'), { recursive: true });
    fs.writeFileSync(path.join(archiveDir, '2099-01-01', 'meta.json'), JSON.stringify({}));
    fs.writeFileSync(path.join(archiveDir, '2099-01-01', 'raw.csv'), rawCsvFor(isoHeader, isoRows));

    expect(() => buildBuilderProjection(path.join(root, 'out'), { ledgerDir: path.join(root, 'ledger-root'), archiveDir }))
      .toThrow(/unrecognised date format/);
  });
});
