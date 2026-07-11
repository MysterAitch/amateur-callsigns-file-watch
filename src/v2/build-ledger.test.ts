import { describe, it, expect } from 'vitest';
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
import { registerSourcesFor, loadRegisterSource, buildLedger, qualifyingRegisterEntries } from './build-ledger.ts';
import { convertFoiSource } from '../shared/foi-normalise.ts';
import { readFoiEntryMeta, defaultFoiDir } from '../shared/foi-archive.ts';
import { loadReferenceData, cleanedCallsign } from '../sources/ofcom-amateur/components.ts';
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
  it('RegisterLedger_WhenBuiltFromWholeArchive_ReachesMillionsOfClaimsWithNoEmptySource', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-ledger-'));
    try {
      const summary = buildLedger(outputDir, FOI_DIR, REF);

      // Every qualifying register entry produced at least one source, and none
      // is silently empty (an empty source would be a converter/filter defect).
      expect(summary.entriesProcessed).toBe(qualifyingRegisterEntries(FOI_DIR).filter(e => registerSourcesFor(e.meta).length > 0).length);
      expect(summary.sourcesProcessed).toBeGreaterThanOrEqual(19);
      for (const s of summary.perSource) {
        expect(s.observations).toBeGreaterThan(0);
        expect(s.rawClaims).toBeGreaterThan(0);
        expect(s.derivedClaims).toBeGreaterThan(0);
      }

      // The corpus runs to millions of claims (the #361 exploration measured a
      // comparable ~10.8M decomposing the normalised CSVs; keying off the wider
      // raw columns is larger still). Both layers are substantial.
      expect(summary.totalClaims).toBeGreaterThan(5_000_000);
      expect(summary.totalRawClaims).toBeGreaterThan(1_000_000);
      expect(summary.totalDerivedClaims).toBeGreaterThan(1_000_000);
      expect(summary.totalClaims).toBe(summary.totalRawClaims + summary.totalDerivedClaims);

      // The JSONL landed on disk, one file per source (the pipeline's output
      // shape), never committed to the repo.
      const written = fs.readdirSync(path.join(outputDir, 'ledger')).filter(name => name.endsWith('.jsonl'));
      expect(written.length).toBe(summary.sourcesProcessed);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  }, 300_000);
});
