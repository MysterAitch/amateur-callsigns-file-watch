import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import {
  emitLedger,
  LISTED_PREDICATE,
  NORMALISES_TO_PREDICATE,
  CLEANED_CALLSIGN_RULE,
} from './claim.ts';
import { projectNormalised } from './project-normalised.ts';
import { buildLedger, type LedgerBuildSummary } from './build-ledger.ts';
import {
  registerSourcesFor,
  loadRegisterSource,
  qualifyingRegisterEntries,
} from './collectors/foi-register.ts';
import {
  loadOpenDataRegisterSource,
  collectOpenDataRegisterSources,
  defaultArchiveDir,
} from './collectors/open-data-register.ts';
import {
  collectAttributeAddendumSources,
  attributeAddendumEntries,
} from './collectors/attribute-addendum.ts';
import { COLLECTORS } from './collectors/index.ts';
import { convertFoiSource } from '../shared/foi-normalise.ts';
import { readFoiEntryMeta, defaultFoiDir } from '../shared/foi-archive.ts';
import { loadReferenceData, cleanedCallsign } from '../sources/ofcom-amateur/components.ts';
import { convertRawCsv, CANONICAL_COLUMNS } from '../sources/ofcom-amateur/normalise.ts';
import type { ArchiveMeta } from '../shared/utils.ts';
import { renderCsv } from '../shared/normalise.ts';

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// The scenario is the whole thesis of issue #361: the CANONICAL ledger is built
// from the RAW published bytes (never the normalised CSVs), yet the committed
// normalised table is still fully recoverable from it, AND the raw layer
// preserves a fidelity the normalised store discards. The oracle is semantic
// equivalence (a multiset of parsed records), not byte-identity - no consumer
// pins the current bytes.

const REF = loadReferenceData();
const FOI_DIR = defaultFoiDir();

// A canonical, order-independent key for one parsed record over a fixed column
// set - the unit of the equivalence multiset.
function recordKey(values: Record<string, string>, columns: readonly string[]): string {
  return JSON.stringify(columns.map(column => [column, values[column] ?? '']));
}

function multiset(records: readonly Record<string, string>[], columns: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = recordKey(record, columns);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function multisetsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, count] of a) {
    if (b.get(key) !== count) return false;
  }
  return true;
}

// The three real register snapshots the equivalence oracle covers, chosen for
// variety: a workbook-extract snapshot whose callsign column carries an
// RFC-4180 quoted ",," value and a trailing-NBSP twin (ofcom-01420046); a
// CSV-native disclosure that carries a day-first date column the normalisation
// converts to ISO (ofcom-2023-12-07); and the sparsest two-column shape held
// (ofcom-2016-09-20). Each is named by its ENTRY key only - the raw source file
// and callsign column are read from the authored converter binding, never
// hard-coded here.
const ROUND_TRIP_ENTRIES = [
  { entry: 'ofcom-01420046--allocated-reserved-callsigns', label: 'QuotedFieldWorkbookSnapshot' },
  { entry: 'ofcom-2023-12-07--open-data-call-sign-list--all-callsigns', label: 'DatedCsvNativeSnapshot' },
  { entry: 'ofcom-2016-09-20--callsign-database--all-callsigns', label: 'SparseTwoColumnSnapshot' },
];

describe('raw->claims->normalised round-trip on real register snapshots', () => {
  for (const { entry, label } of ROUND_TRIP_ENTRIES) {
    it(`NormalisedTable_When${label}_IsRecoverableFromRawKeyedLedger`, () => {
      const meta = readFoiEntryMeta(FOI_DIR, entry);
      const sources = registerSourcesFor(meta);
      expect(sources.length).toBeGreaterThan(0);
      const source = sources[0];

      const observationSet = loadRegisterSource(FOI_DIR, entry, meta, source);
      expect(observationSet.rows.length).toBeGreaterThan(0);

      const ledger = emitLedger(observationSet, REF);
      const rawClaims = ledger.filter(claim => claim.layer === 'raw');

      // Hop 1 - the raw layer is a LOSSLESS encoding of the published bytes:
      // folding the raw claims back reproduces the raw source table exactly,
      // under Ofcom's own headers, order/quoting-independent. This is the hop
      // that carries the RFC-4180 quoted ",," value through claims and back.
      const projected = projectNormalised(rawClaims, observationSet.columns, observationSet.subjectColumn);
      expect(projected.length).toBe(observationSet.rows.length);
      const rawSourceMultiset = multiset(observationSet.rows, observationSet.columns);
      const reconstructedMultiset = multiset(projected.map(record => record.values), observationSet.columns);
      expect(multisetsEqual(reconstructedMultiset, rawSourceMultiset)).toBe(true);

      // Hop 2 - the committed normalisation is reproducible from that encoding:
      // render the ledger-reconstructed raw table and run the entry's authored,
      // deterministic converter (the named derivation rule), then compare to the
      // committed normalised--*.csv. Jointly the two hops prove the
      // raw->claims->normalised path loses nothing.
      const reconstructedRows = projected.map(record => observationSet.columns.map(column => record.values[column] ?? ''));
      const reconstructedCsv = renderCsv([...observationSet.columns], reconstructedRows);
      const converted = convertFoiSource(Buffer.from(reconstructedCsv, source.conversion.encoding), source.conversion);

      const normalisedColumns = source.conversion.columns.map(column => column.output);
      const convertedRecords = parse(converted.csv, { columns: true, bom: true }) as Record<string, string>[];
      const committedText = fs.readFileSync(path.join(FOI_DIR, entry, converted.outputFileName), 'utf8');
      const committedRecords = parse(committedText, { columns: true, bom: true }) as Record<string, string>[];

      expect(convertedRecords.length).toBe(committedRecords.length);
      expect(multisetsEqual(
        multiset(convertedRecords, normalisedColumns),
        multiset(committedRecords, normalisedColumns),
      )).toBe(true);
    });
  }
});

// The open-data-register family (issue #361 source-coverage extension): the
// SAME raw->claims->normalised equivalence oracle, now over Ofcom's open-data
// register publications (archive/<date>/raw.csv), chosen for awkward shapes:
// a 2022-minimal export whose raw carries FIVE footer-furniture lines curated
// out via meta.ignoredLines (2022-05-30, no product column); a 2023 export
// with a day-first date column the normalisation reorders to ISO (2023-02-20);
// and the live 2026 export whose header is BOM-prefixed and carries
// licence-version date columns (2026-06-23). Each is named by its archive-date
// key only - the raw source file, callsign column and product column are read
// from the authored header-variant registry, never hard-coded here.
const OPEN_DATA_ROUND_TRIP_ENTRIES = [
  { key: '2022-05-30', label: 'FooterFurnitureMinimalExport' },
  { key: '2023-02-20', label: 'DayFirstDateExport' },
  { key: '2026-06-23', label: 'BomPrefixedLicenceVersionExport' },
];

const ARCHIVE_DIR = defaultArchiveDir();

function readArchiveMetaSync(key: string): ArchiveMeta {
  return JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, key, 'meta.json'), 'utf8')) as ArchiveMeta;
}

describe('raw->claims->normalised round-trip on real open-data register publications', () => {
  for (const { key, label } of OPEN_DATA_ROUND_TRIP_ENTRIES) {
    it(`NormalisedTable_When${label}_IsRecoverableFromRawKeyedLedger`, () => {
      const meta = readArchiveMetaSync(key);
      const observationSet = loadOpenDataRegisterSource(ARCHIVE_DIR, key, meta);
      expect(observationSet.rows.length).toBeGreaterThan(0);

      const ledger = emitLedger(observationSet, REF);
      const rawClaims = ledger.filter(claim => claim.layer === 'raw');

      // Hop 1 - the raw layer is a LOSSLESS encoding of the DATA rows (footer
      // furniture already curated out before emission): folding the raw claims
      // back reproduces the register rows exactly, under Ofcom's own headers,
      // order/quoting-independent.
      const projected = projectNormalised(rawClaims, observationSet.columns, observationSet.subjectColumn);
      expect(projected.length).toBe(observationSet.rows.length);
      expect(multisetsEqual(
        multiset(projected.map(record => record.values), observationSet.columns),
        multiset(observationSet.rows, observationSet.columns),
      )).toBe(true);

      // Hop 2 - the committed normalisation is reproducible from that encoding:
      // render the ledger-reconstructed raw table (no footer furniture, so the
      // re-conversion needs no curated ignores) and run the AUTHORED converter,
      // then compare to the committed normalised.csv. Jointly the two hops
      // prove the raw->claims->normalised path loses nothing the family carries.
      const reconstructedRows = projected.map(record => observationSet.columns.map(column => record.values[column] ?? ''));
      const reconstructedCsv = renderCsv([...observationSet.columns], reconstructedRows);
      const referenceDateIso = meta.ofcomReportedUpdateIso ?? meta.fetchedAt.slice(0, 10);
      const converted = convertRawCsv(reconstructedCsv, { referenceDateIso }, []);

      const convertedRecords = parse(converted.csv, { columns: true, bom: true }) as Record<string, string>[];
      const committedText = fs.readFileSync(path.join(ARCHIVE_DIR, key, 'normalised.csv'), 'utf8');
      const committedRecords = parse(committedText, { columns: true, bom: true }) as Record<string, string>[];

      expect(convertedRecords.length).toBe(committedRecords.length);
      expect(multisetsEqual(
        multiset(convertedRecords, CANONICAL_COLUMNS),
        multiset(committedRecords, CANONICAL_COLUMNS),
      )).toBe(true);
    });
  }

  it('OpenDataRegisterFamily_WhenCollected_CoversEveryOfcomAmateurPublication', () => {
    // The family is discovered from the archive, not a hard-coded list, so a
    // newly-mirrored publication is covered automatically. Every collected
    // source names its raw bytes and a callsign column.
    const sources = collectOpenDataRegisterSources();
    expect(sources.length).toBeGreaterThanOrEqual(OPEN_DATA_ROUND_TRIP_ENTRIES.length);
    for (const source of sources) {
      expect(source.family).toBe('open-data-register');
      const observationSet = source.load();
      expect(observationSet.rows.length).toBeGreaterThan(0);
      expect(observationSet.subjectColumn.length).toBeGreaterThan(0);
      expect(observationSet.sourceFile).toBe(`opendata/${source.entry}/raw.csv`);
    }
  });
});

// The attribute-addendum family (issue #361 source-coverage extension): the
// SAME raw->claims->normalised equivalence oracle, now over the FOI entries
// whose datasetClasses carry 'attribute-addendum' - the per-callsign attribute
// rows the register family excludes at the entry level. Two entries qualify
// with callsign-row-per-line CSV sources: the 2024 duration-held CSV PAIR
// (wdtk-1180568), whose sheet 2 carries the original-start and created dates
// beyond the plain register row and whose callsign column is 'Call Sign'; and
// the 2019 published register (ofcom-756622), a latin-1 CSV carrying the
// truncated 'Licence Issued Dat' issue-date column. Each is named by its ENTRY
// key only - the raw source files and callsign columns are read from the
// authored converter binding, never hard-coded here.
const ATTRIBUTE_ADDENDUM_ROUND_TRIP_ENTRIES = [
  { entry: 'wdtk-1180568--licence-breakdown-duration-age', label: 'DurationHeldCsvPair' },
  { entry: 'ofcom-756622--published-register-csv', label: 'PublishedRegisterWithIssueDates' },
];

describe('raw->claims->normalised round-trip on real attribute-addendum entries', () => {
  for (const { entry, label } of ATTRIBUTE_ADDENDUM_ROUND_TRIP_ENTRIES) {
    it(`NormalisedTable_When${label}_IsRecoverableFromRawKeyedLedger`, () => {
      const meta = readFoiEntryMeta(FOI_DIR, entry);
      const sources = registerSourcesFor(meta);
      // At least one callsign-row-per-line CSV source; every one is round-tripped.
      expect(sources.length).toBeGreaterThan(0);

      for (const source of sources) {
        const observationSet = loadRegisterSource(FOI_DIR, entry, meta, source);
        expect(observationSet.rows.length).toBeGreaterThan(0);

        const ledger = emitLedger(observationSet, REF);
        const rawClaims = ledger.filter(claim => claim.layer === 'raw');

        // Hop 1 - the raw layer is a LOSSLESS encoding of the published rows:
        // folding the raw claims back reproduces the raw source table exactly,
        // under Ofcom's own headers, order/quoting-independent.
        const projected = projectNormalised(rawClaims, observationSet.columns, observationSet.subjectColumn);
        expect(projected.length).toBe(observationSet.rows.length);
        expect(multisetsEqual(
          multiset(projected.map(record => record.values), observationSet.columns),
          multiset(observationSet.rows, observationSet.columns),
        )).toBe(true);

        // Hop 2 - the committed normalisation is reproducible from that
        // encoding: render the ledger-reconstructed raw table and run the
        // entry's authored, deterministic converter, then compare to the
        // committed normalised--*.csv. Jointly the two hops prove the
        // raw->claims->normalised path loses nothing the addendum source carries.
        const reconstructedRows = projected.map(record => observationSet.columns.map(column => record.values[column] ?? ''));
        const reconstructedCsv = renderCsv([...observationSet.columns], reconstructedRows);
        const converted = convertFoiSource(Buffer.from(reconstructedCsv, source.conversion.encoding), source.conversion);

        const normalisedColumns = source.conversion.columns.map(column => column.output);
        const convertedRecords = parse(converted.csv, { columns: true, bom: true }) as Record<string, string>[];
        const committedText = fs.readFileSync(path.join(FOI_DIR, entry, converted.outputFileName), 'utf8');
        const committedRecords = parse(committedText, { columns: true, bom: true }) as Record<string, string>[];

        expect(convertedRecords.length).toBe(committedRecords.length);
        expect(multisetsEqual(
          multiset(convertedRecords, normalisedColumns),
          multiset(committedRecords, normalisedColumns),
        )).toBe(true);
      }
    });
  }

  it('AttributeAddendumFamily_WhenCollected_CoversEveryQualifyingCallsignSource', () => {
    // The family is discovered from the archive's datasetClasses, not a
    // hard-coded list, so a newly-classed addendum entry is covered
    // automatically. Every collected source names its raw bytes and a callsign
    // column, and is disjoint from the register family (which excludes these
    // very entries).
    const sources = collectAttributeAddendumSources();
    const expectedSourceCount = attributeAddendumEntries()
      .reduce((sum, { meta }) => sum + registerSourcesFor(meta).length, 0);
    expect(sources.length).toBe(expectedSourceCount);
    expect(sources.length).toBeGreaterThanOrEqual(ATTRIBUTE_ADDENDUM_ROUND_TRIP_ENTRIES.length);
    for (const source of sources) {
      expect(source.family).toBe('attribute-addendum');
      const observationSet = source.load();
      expect(observationSet.rows.length).toBeGreaterThan(0);
      expect(observationSet.subjectColumn.length).toBeGreaterThan(0);
      expect(observationSet.sourceFile.startsWith(`foi/${source.entry}/`)).toBe(true);
    }

    // Disjoint from the register family: no attribute-addendum entry is also a
    // qualifying register entry (EXCLUDED_CLASSES guarantees it), so nothing is
    // emitted twice.
    const registerEntryKeys = new Set(qualifyingRegisterEntries().map(e => e.entry));
    for (const { entry } of attributeAddendumEntries()) {
      expect(registerEntryKeys.has(entry)).toBe(false);
    }
  });
});

describe('raw-keyed fidelity the normalised store discards (G0TQK)', () => {
  it('RawCallsignTokens_WhenNbspTwinInSource_YieldTwoObservationsBothNormalisingToOneEntity', () => {
    // The 2022-03 register lists the entity G0TQK under two DISTINCT raw tokens
    // - "G0TQK" and "G0TQK" with a trailing non-breaking space - one Allocated,
    // one Reserved. The normalised CSV trims both to a clean "G0TQK", discarding
    // which row was damaged; the raw-keyed ledger keeps the tokens apart while
    // still resolving both to the single entity a user queries.
    const entry = 'ofcom-01420046--allocated-reserved-callsigns';
    const meta = readFoiEntryMeta(FOI_DIR, entry);
    const source = registerSourcesFor(meta)[0];
    const observationSet = loadRegisterSource(FOI_DIR, entry, meta, source);
    const ledger = emitLedger(observationSet, REF);

    const isTwin = (token: string): boolean => cleanedCallsign(token) === 'G0TQK';

    // Two distinct raw observations survive verbatim - the existence claims keep
    // the NBSP-bearing token apart from the clean one.
    const twinListed = ledger.filter(claim => claim.predicate === LISTED_PREDICATE && isTwin(claim.rawSubject));
    const twinTokens = twinListed.map(claim => claim.rawSubject);
    expect(twinListed.length).toBe(2);
    expect(new Set(twinTokens).size).toBe(2);
    expect(twinTokens.some(token => token === 'G0TQK')).toBe(true);
    expect(twinTokens.some(token => token !== 'G0TQK' && cleanedCallsign(token) === 'G0TQK')).toBe(true);

    // Both raw tokens carry a normalises_to edge (cleaned-callsign rule) to the
    // SAME entity - an auditable join, never a silent merge.
    const twinEdges = ledger.filter(claim =>
      claim.predicate === NORMALISES_TO_PREDICATE
      && claim.rule === CLEANED_CALLSIGN_RULE
      && isTwin(claim.rawSubject));
    expect(twinEdges.length).toBe(2);
    expect(twinEdges.every(edge => edge.object === 'G0TQK')).toBe(true);
    expect(new Set(twinEdges.map(edge => edge.rawSubject)).size).toBe(2);

    // The two statuses ride one observation each - the "dual status" is honestly
    // two co-temporal observations, not a conflict on one row.
    const twinStatuses = ledger
      .filter(claim => claim.layer === 'raw' && claim.predicate === 'Status' && isTwin(claim.rawSubject))
      .map(claim => claim.object)
      .sort();
    expect(twinStatuses).toEqual(['Allocated', 'Reserved']);
  });
});

describe('corpus scale sanity', () => {
  // The whole-archive ledger build is this file's heavy work (millions of claims
  // across every source family). Its inputs - the committed archive,
  // reference-data and the emit-path closure - change on few PRs, so CI caches the
  // built ledger directory under a key hashing exactly that closure (see the
  // build-ledger job in ci.yml) and hands the restored directory to this test via
  // LEDGER_CACHE_DIR. On a cache HIT we VERIFY the restored build instead of
  // rebuilding it - equivalent, because buildLedger is deterministic in the hashed
  // inputs, so anything that could change the ledger also changes the key and
  // forces a fresh build. The summary (asserted below) is persisted beside the
  // JSONL so a hit still has it. With no LEDGER_CACHE_DIR (local runs) it builds
  // into throwaway scratch.
  const SUMMARY_FILE = 'ledger-summary.json';
  let outputDir: string;
  let summary: LedgerBuildSummary;
  let ownsScratch = false;

  beforeAll(() => {
    const cacheDir = process.env.LEDGER_CACHE_DIR;
    const summaryPath = cacheDir ? path.join(cacheDir, SUMMARY_FILE) : '';
    if (cacheDir && fs.existsSync(summaryPath)) {
      outputDir = cacheDir;
      summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as LedgerBuildSummary;
      return;
    }
    outputDir = cacheDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'v2-ledger-'));
    ownsScratch = cacheDir === undefined;
    fs.mkdirSync(outputDir, { recursive: true });
    summary = buildLedger(outputDir, FOI_DIR, REF);
    if (cacheDir) fs.writeFileSync(summaryPath, JSON.stringify(summary));
  }, 300_000);

  afterAll(() => {
    // Only delete scratch we created; a cache directory is owned by the runner
    // and is saved by actions/cache after the job.
    if (ownsScratch) fs.rmSync(outputDir, { recursive: true, force: true });
  });

  it('RegisterLedger_WhenBuiltFromWholeArchive_ReachesMillionsOfClaimsWithNoEmptySource', () => {
      // All three families contribute. Every qualifying FOI register entry
      // produced at least one source; the open-data-register family adds every
      // mirrored Ofcom open-data publication; the attribute-addendum family adds
      // the per-callsign attribute entries the register family excludes - all
      // additive, the earlier counts intact.
      const foiEntries = qualifyingRegisterEntries(FOI_DIR).filter(e => registerSourcesFor(e.meta).length > 0).length;
      const openDataSources = collectOpenDataRegisterSources().length;
      const addendumEntries = attributeAddendumEntries(FOI_DIR).filter(e => registerSourcesFor(e.meta).length > 0).length;
      expect(summary.entriesByFamily['foi-register']).toBe(foiEntries);
      expect(summary.entriesByFamily['open-data-register']).toBe(openDataSources);
      expect(summary.entriesByFamily['open-data-register']).toBeGreaterThanOrEqual(OPEN_DATA_ROUND_TRIP_ENTRIES.length);
      expect(summary.entriesByFamily['attribute-addendum']).toBe(addendumEntries);
      expect(summary.entriesByFamily['attribute-addendum']).toBeGreaterThanOrEqual(ATTRIBUTE_ADDENDUM_ROUND_TRIP_ENTRIES.length);
      // The three callsign families contribute at least this many entries;
      // bespoke non-callsign families (forbidden-list, ...) only add to the
      // total, so this is a floor rather than an exact count.
      expect(summary.entriesProcessed).toBeGreaterThanOrEqual(foiEntries + openDataSources + addendumEntries);
      expect(summary.sourcesProcessed).toBeGreaterThanOrEqual(19 + OPEN_DATA_ROUND_TRIP_ENTRIES.length + ATTRIBUTE_ADDENDUM_ROUND_TRIP_ENTRIES.length);

      // Which families run the full emit path (callsign normalisation), read
      // from the registry so a newly-registered family is judged by its own
      // declared subjectKind rather than a hard-coded list.
      const callsignFamilies = new Set(COLLECTORS.filter(c => c.subjectKind === 'callsign').map(c => c.family));
      const registeredFamilies = COLLECTORS.map(c => c.family);

      // No source is silently empty (an empty source would be a converter/
      // filter defect); each carries a registered family tag. A callsign family
      // always derives normalisation edges; a non-callsign family (suffix /
      // aggregate / pool-slot) emits raw observations only, so it derives none.
      for (const s of summary.perSource) {
        expect(s.observations).toBeGreaterThan(0);
        expect(s.rawClaims).toBeGreaterThan(0);
        if (callsignFamilies.has(s.family)) {
          expect(s.derivedClaims).toBeGreaterThan(0);
        } else {
          expect(s.derivedClaims).toBe(0);
        }
        expect(registeredFamilies).toContain(s.family);
      }

      // The attribute-addendum family contributes real claims of its own
      // (hundreds of thousands of observations across the covered entries).
      const addendumClaims = summary.perSource.filter(s => s.family === 'attribute-addendum').reduce((sum, s) => sum + s.rawClaims + s.derivedClaims, 0);
      expect(addendumClaims).toBeGreaterThan(1_000_000);

      // The corpus runs to millions of claims (the #361 exploration measured a
      // comparable ~10.8M decomposing the normalised CSVs; keying off the wider
      // raw columns across both families is larger still). Both layers are
      // substantial, and each family contributes millions in its own right.
      expect(summary.totalClaims).toBeGreaterThan(10_000_000);
      expect(summary.totalRawClaims).toBeGreaterThan(5_000_000);
      expect(summary.totalDerivedClaims).toBeGreaterThan(3_000_000);
      expect(summary.totalClaims).toBe(summary.totalRawClaims + summary.totalDerivedClaims);
      const openDataClaims = summary.perSource.filter(s => s.family === 'open-data-register').reduce((sum, s) => sum + s.rawClaims + s.derivedClaims, 0);
      expect(openDataClaims).toBeGreaterThan(1_000_000);

      // The JSONL landed on disk, one file per source (the pipeline's output
      // shape), never committed to the repo.
      const written = fs.readdirSync(path.join(outputDir, 'ledger')).filter(name => name.endsWith('.jsonl'));
      expect(written.length).toBe(summary.sourcesProcessed);
  });
});
