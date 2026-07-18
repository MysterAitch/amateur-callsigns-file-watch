import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { emitClaimsParquet } from '../v2/build-ledger-db.ts';
import { duckDbAvailable, type ClaimsSource } from '../v2/report-fold.ts';
import { emitClaims, type SourceObservationSet, type Claim } from '../v2/claim.ts';
import {
  LISTED_PREDICATE,
  LICENCE_CATEGORY_PREDICATE,
  LICENCE_CATEGORY_RULE,
  PARSE_STATUS_PREDICATE,
  PREFIX_SERIES_PREDICATE,
  IMPLIED_CLASS_PREDICATE,
  RSL_PREDICATE,
  FLAG_PREDICATE,
  CALLSIGN_PATTERN_PREDICATE,
  PARSE_CALLSIGN_RULE,
} from '../v2/claim.ts';
import { serialiseClaimsJsonl } from '../v2/serialise.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';
import { foldLicenceCategories, foldParseFields } from './value-catalogue-fold.ts';
import {
  foldPrefixDistribution,
  foldClassProductMismatches,
  foldRegionalIdentifiers,
  foldCallsignPatternSeries,
} from './quality-report-fold.ts';
import { foldDataQuality } from './data-quality-fold.ts';
import {
  collectRawDisclosuresFromLedger,
  collectRawDisclosuresFromParquet,
  historyFromDisclosures,
  renderForbiddenSuffixHistory,
  type ForbiddenLedgerSource,
} from './forbidden-suffix-history.ts';

// Issue #403: every report fold now reads its claim rows through report-fold's
// ClaimsSource — the shared deploy-time claims.parquet when the workflow built
// one, or an on-demand JSONL ledger otherwise. This is the durable contract that
// the two code paths are behaviour-identical: for the SAME claims, folding from a
// Parquet emitted from a ledger directory must reproduce, byte-for-byte, the fold
// over that ledger directory. Test names follow Subject_Scenario_Outcome.

const ref = loadReferenceData();

// A raw/derived claim for the open-data fixture, defaulting the boilerplate.
function claim(over: Partial<Claim> & Pick<Claim, 'predicate' | 'object' | 'rawSubject'> & { ordinal: number }): Claim {
  return {
    layer: over.layer ?? 'raw',
    rawSubject: over.rawSubject,
    predicate: over.predicate,
    object: over.object,
    provenance: { sourceFile: 'opendata/2024-01-01/raw.csv', ordinal: over.ordinal, vintage: '2024-01-01' },
    rule: over.rule,
  };
}

// One open-data register observation, expressed as the claims the emit tiers
// would have produced: the raw @listed anchor plus product/status, and the
// derived licence-category / parse-attribute tiers each fold reads. The exact
// values are immaterial to the equivalence check — only that both sources fold
// them identically — but they are chosen to make every fold return non-trivial
// output (a category, parse fields, a prefix row, a mismatch, a regional row, a
// pattern series, and data-quality flags/empties).
function openDataClaims(): Claim[] {
  const claims: Claim[] = [];
  // Observation 0: G0AAA — Full, Allocated, cleanly parsed, G core (no RSL).
  claims.push(
    claim({ predicate: LISTED_PREDICATE, object: '', rawSubject: 'G0AAA', ordinal: 0 }),
    claim({ predicate: 'Product', object: 'Full', rawSubject: 'G0AAA', ordinal: 0 }),
    claim({ predicate: 'Status', object: 'Allocated', rawSubject: 'G0AAA', ordinal: 0 }),
    claim({ layer: 'derived', predicate: LICENCE_CATEGORY_PREDICATE, object: 'Full', rawSubject: 'G0AAA', ordinal: 0, rule: LICENCE_CATEGORY_RULE }),
    claim({ layer: 'derived', predicate: PREFIX_SERIES_PREDICATE, object: 'G', rawSubject: 'G0AAA', ordinal: 0, rule: PARSE_CALLSIGN_RULE }),
    claim({ layer: 'derived', predicate: IMPLIED_CLASS_PREDICATE, object: 'Full', rawSubject: 'G0AAA', ordinal: 0, rule: PARSE_CALLSIGN_RULE }),
    claim({ layer: 'derived', predicate: PARSE_STATUS_PREDICATE, object: 'parsed', rawSubject: 'G0AAA', ordinal: 0, rule: PARSE_CALLSIGN_RULE }),
    claim({ layer: 'derived', predicate: CALLSIGN_PATTERN_PREDICATE, object: 'LNLLL', rawSubject: 'G0AAA', ordinal: 0, rule: PARSE_CALLSIGN_RULE }),
  );
  // Observation 1: 2E0ABC — Foundation, Allocated, parsed, series-2 with an RSL.
  claims.push(
    claim({ predicate: LISTED_PREDICATE, object: '', rawSubject: '2E0ABC', ordinal: 1 }),
    claim({ predicate: 'Product', object: 'Foundation', rawSubject: '2E0ABC', ordinal: 1 }),
    claim({ predicate: 'Status', object: 'Allocated', rawSubject: '2E0ABC', ordinal: 1 }),
    claim({ layer: 'derived', predicate: LICENCE_CATEGORY_PREDICATE, object: 'Foundation', rawSubject: '2E0ABC', ordinal: 1, rule: LICENCE_CATEGORY_RULE }),
    claim({ layer: 'derived', predicate: PREFIX_SERIES_PREDICATE, object: '2E', rawSubject: '2E0ABC', ordinal: 1, rule: PARSE_CALLSIGN_RULE }),
    claim({ layer: 'derived', predicate: IMPLIED_CLASS_PREDICATE, object: 'Foundation', rawSubject: '2E0ABC', ordinal: 1, rule: PARSE_CALLSIGN_RULE }),
    claim({ layer: 'derived', predicate: PARSE_STATUS_PREDICATE, object: 'parsed', rawSubject: '2E0ABC', ordinal: 1, rule: PARSE_CALLSIGN_RULE }),
    claim({ layer: 'derived', predicate: RSL_PREDICATE, object: 'E', rawSubject: '2E0ABC', ordinal: 1, rule: PARSE_CALLSIGN_RULE }),
    claim({ layer: 'derived', predicate: CALLSIGN_PATTERN_PREDICATE, object: 'NLNLLL', rawSubject: '2E0ABC', ordinal: 1, rule: PARSE_CALLSIGN_RULE }),
  );
  // Observation 2: M7XYZ — declared Full but M7 implies Foundation, so the parse
  // raises class-product-mismatch (the mismatch fold's row).
  claims.push(
    claim({ predicate: LISTED_PREDICATE, object: '', rawSubject: 'M7XYZ', ordinal: 2 }),
    claim({ predicate: 'Product', object: 'Full', rawSubject: 'M7XYZ', ordinal: 2 }),
    claim({ predicate: 'Status', object: 'Allocated', rawSubject: 'M7XYZ', ordinal: 2 }),
    claim({ layer: 'derived', predicate: LICENCE_CATEGORY_PREDICATE, object: 'Full', rawSubject: 'M7XYZ', ordinal: 2, rule: LICENCE_CATEGORY_RULE }),
    claim({ layer: 'derived', predicate: PREFIX_SERIES_PREDICATE, object: 'M7', rawSubject: 'M7XYZ', ordinal: 2, rule: PARSE_CALLSIGN_RULE }),
    claim({ layer: 'derived', predicate: IMPLIED_CLASS_PREDICATE, object: 'Foundation', rawSubject: 'M7XYZ', ordinal: 2, rule: PARSE_CALLSIGN_RULE }),
    claim({ layer: 'derived', predicate: PARSE_STATUS_PREDICATE, object: 'parsed', rawSubject: 'M7XYZ', ordinal: 2, rule: PARSE_CALLSIGN_RULE }),
    claim({ layer: 'derived', predicate: FLAG_PREDICATE, object: 'class-product-mismatch', rawSubject: 'M7XYZ', ordinal: 2, rule: PARSE_CALLSIGN_RULE }),
    claim({ layer: 'derived', predicate: CALLSIGN_PATTERN_PREDICATE, object: 'LNLLL', rawSubject: 'M7XYZ', ordinal: 2, rule: PARSE_CALLSIGN_RULE }),
  );
  // Observation 3: a blank callsign — the @listed anchor with no parse_status
  // claim, so the folds recover the `empty` bucket from it.
  claims.push(
    claim({ predicate: LISTED_PREDICATE, object: '', rawSubject: '', ordinal: 3 }),
  );
  // Observation 4: a lowercase-bearing offender, flagged `lowercase` (a
  // data-quality detector row with an offender token).
  claims.push(
    claim({ predicate: LISTED_PREDICATE, object: '', rawSubject: 'm0zzz', ordinal: 4 }),
    claim({ predicate: 'Status', object: 'Allocated', rawSubject: 'm0zzz', ordinal: 4 }),
    claim({ layer: 'derived', predicate: PARSE_STATUS_PREDICATE, object: 'parsed', rawSubject: 'm0zzz', ordinal: 4, rule: PARSE_CALLSIGN_RULE }),
    claim({ layer: 'derived', predicate: PREFIX_SERIES_PREDICATE, object: 'M', rawSubject: 'm0zzz', ordinal: 4, rule: PARSE_CALLSIGN_RULE }),
    claim({ layer: 'derived', predicate: FLAG_PREDICATE, object: 'lowercase', rawSubject: 'm0zzz', ordinal: 4, rule: PARSE_CALLSIGN_RULE }),
    claim({ layer: 'derived', predicate: CALLSIGN_PATTERN_PREDICATE, object: 'LNLLL', rawSubject: 'm0zzz', ordinal: 4, rule: PARSE_CALLSIGN_RULE }),
  );
  return claims;
}

// A forbidden-suffix source as its RAW rows, the shape loadForbiddenSource yields.
function forbiddenSource(sourceFile: string, vintage: string, rows: Record<string, string>[]): SourceObservationSet {
  const columns = rows.some(r => 'LastModifiedDate' in r) ? ['Name', 'LastModifiedDate'] : ['Name'];
  return { sourceFile, vintage, columns, subjectColumn: 'Name', rows };
}

// Everything a fold consumes, computed from one claims source, so the whole set is
// compared in a single deep-equality assertion.
function runAllFolds(source: string | ClaimsSource): unknown {
  return {
    categories: foldLicenceCategories(source, ref),
    fields: foldParseFields(source),
    prefixes: foldPrefixDistribution(source),
    mismatches: foldClassProductMismatches(source),
    regional: foldRegionalIdentifiers(source),
    patterns: foldCallsignPatternSeries(source),
    dataQuality: foldDataQuality(source),
  };
}

describe.skipIf(!duckDbAvailable())('report folds — shared-Parquet vs on-demand ledger (issue #403)', { tags: ['data-validity'] }, () => {
  let root: string;
  let ledgerDir: string;
  let parquetSource: ClaimsSource;
  let forbiddenSources: ForbiddenLedgerSource[];

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'report-fold-parquet-equivalence-'));
    ledgerDir = path.join(root, 'ledger');
    fs.mkdirSync(ledgerDir, { recursive: true });

    // The open-data register lane, hand-built to exercise every open-data fold.
    fs.writeFileSync(path.join(ledgerDir, 'opendata-2024-01-01.jsonl'), serialiseClaimsJsonl(openDataClaims()));

    // Two forbidden-suffix disclosures, emitted through the real emit path, each
    // to its own JSONL file (a file IS a disclosure on the ledger path); the
    // Parquet path selects them out of the whole corpus by their sourceFile.
    const d0 = forbiddenSource('foi/fixture-2016/list.csv', '2016-09', [
      { Name: 'ABC' }, { Name: 'ZIT' }, { Name: 'ZIT' }, { Name: 'QNF' },
    ]);
    const d1 = forbiddenSource('foi/fixture-2024/list.csv', '2024-12', [
      { Name: 'ABC', LastModifiedDate: '29/07/2016 17:19' },
      { Name: 'JIZ', LastModifiedDate: '10/12/2020 09:10' },
    ]);
    const stem0 = 'forbidden-fixture-2016-list';
    const stem1 = 'forbidden-fixture-2024-list';
    fs.writeFileSync(path.join(ledgerDir, `${stem0}.jsonl`), serialiseClaimsJsonl(emitClaims(d0)));
    fs.writeFileSync(path.join(ledgerDir, `${stem1}.jsonl`), serialiseClaimsJsonl(emitClaims(d1)));
    forbiddenSources = [
      { entry: 'fixture-2016', vintage: '2016-09', normalisedFileName: 'normalised--list.csv', jsonlStem: stem0, sourceFile: 'foi/fixture-2016/list.csv', lastModifiedPredicate: null, emit: () => [] },
      { entry: 'fixture-2024', vintage: '2024-12', normalisedFileName: 'normalised--list.csv', jsonlStem: stem1, sourceFile: 'foi/fixture-2024/list.csv', lastModifiedPredicate: 'LastModifiedDate', emit: () => [] },
    ];

    // Emit the shared Parquet from the SAME ledger directory the on-demand path
    // reads, so any divergence is the source swap alone.
    const parquetPath = path.join(root, 'claims.parquet');
    emitClaimsParquet(ledgerDir, parquetPath);
    parquetSource = { kind: 'parquet', path: parquetPath };
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('ReportFolds_WhenSharedParquetPresent_ProduceIdenticalOutputToOnDemandMaterialisation', () => {
    // The whole open-data fold set is identical whether read from the Parquet or
    // the JSONL ledger — the behaviour-identical guarantee for the licence
    // catalogue, parse-field distributions, prefix / mismatch / regional /
    // callsign-pattern reports and the data-quality rollup.
    expect(runAllFolds(parquetSource)).toEqual(runAllFolds(ledgerDir));
  });

  it('ForbiddenSuffixHistoryFold_WhenSharedParquetPresent_ProducesIdenticalOutputToOnDemandMaterialisation', () => {
    const fromLedger = collectRawDisclosuresFromLedger(ledgerDir, forbiddenSources);
    const fromParquet = collectRawDisclosuresFromParquet(parquetSource, forbiddenSources);
    expect(fromParquet).toEqual(fromLedger);
    // And the rendered report — the committed golden's own text — is byte-identical.
    expect(renderForbiddenSuffixHistory(historyFromDisclosures(fromParquet)))
      .toBe(renderForbiddenSuffixHistory(historyFromDisclosures(fromLedger)));
  });
});
