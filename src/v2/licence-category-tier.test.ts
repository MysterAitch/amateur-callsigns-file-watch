import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import {
  emitLedger,
  emitLicenceCategoryClaims,
  LICENCE_CATEGORY_PREDICATE,
  LICENCE_CATEGORY_RULE,
  type Claim,
  type SourceObservationSet,
} from './claim.ts';
import { serialiseClaimsJsonl } from './serialise.ts';
import { buildLedgerSqlite } from './build-ledger-db.ts';
import { buildCompactLedgerSqlite } from './build-ledger-db-compact.ts';
import { registerSourcesFor, loadRegisterSource } from './collectors/foi-register.ts';
import { readFoiEntryMeta, defaultFoiDir } from '../shared/foi-archive.ts';
import { loadReferenceData, normaliseLicenceCategory } from '../sources/ofcom-amateur/components.ts';

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// The scenario is the derived licence-category TIER (issue #361 enabling work):
// beside the verbatim raw product/licence_class claim, the ledger carries an
// ADDITIONAL derived claim naming the canonical category the raw value collapses
// to. The category is LIFTED from reference-data/licence-category.csv via
// normaliseLicenceCategory - the one authoritative map - never a fresh
// vocabulary. The correctness gate is equivalence: every derived category claim
// must equal normaliseLicenceCategory over the raw product cell (the same map
// the legacy build-sqlite.ts folds), and the raw claim must survive unchanged so
// the two tiers coexist.

const REF = loadReferenceData();

// A representative product set spanning the map's deliberate distinctions - the
// vintage-spelling collapse (Full / Amateur Full Radio Licence), the
// must-not-collapse reciprocal pair, Club and Special Event, a blank product,
// and an unmapped non-blank product. The subject column is Ofcom's own 'Call
// Sign' header and the product column its 'Product' header, mirroring the raw
// register shapes.
const FIXTURE_ROWS: readonly Record<string, string>[] = [
  { 'Call Sign': 'G0AAA', Status: 'Allocated', Product: 'Full' },
  { 'Call Sign': 'G0BBB', Status: 'Allocated', Product: 'Amateur Full Radio Licence' },
  { 'Call Sign': '2E0CCC', Status: 'Allocated', Product: 'Amateur Foundation Radio Licence' },
  { 'Call Sign': 'M0DDD', Status: 'Allocated', Product: 'Amateur Temporary Reciprocal Radio Licence' },
  { 'Call Sign': 'M0EEE', Status: 'Allocated', Product: 'Amateur Full (Reciprocal) Radio Licence' },
  { 'Call Sign': 'GB0FFF', Status: 'Reserved', Product: 'Amateur Club Radio Licence' },
  { 'Call Sign': 'GB1GGG', Status: 'Allocated', Product: 'Special Event Station' },
  { 'Call Sign': 'M7HHH', Status: 'Reserved', Product: '' },
  { 'Call Sign': 'M7III', Status: 'Allocated', Product: 'Amateur Novice Radio Licence' },
];

const FIXTURE_SOURCE: SourceObservationSet = {
  sourceFile: 'fixture/licence-category/rows.csv',
  vintage: '2024-01',
  columns: ['Call Sign', 'Status', 'Product'],
  subjectColumn: 'Call Sign',
  categoryColumn: 'Product',
  rows: FIXTURE_ROWS,
};

function categoryClaimsOf(claims: readonly Claim[]): Claim[] {
  return claims.filter(claim => claim.predicate === LICENCE_CATEGORY_PREDICATE);
}

describe('derived licence-category tier equivalence to the lifted map', () => {
  it('LicenceCategoryClaims_WhenProductMaps_MatchNormaliseLicenceCategoryOutput', () => {
    const categoryClaims = categoryClaimsOf(emitLicenceCategoryClaims(FIXTURE_SOURCE, REF));

    // Every derived claim is layer 'derived', rule-attributed to the lifted map,
    // and its object EQUALS normaliseLicenceCategory over that row's raw product.
    // Building the expectation from the map itself (not hard-coded strings) makes
    // this literally an equivalence assertion against the authoritative rule.
    const byCallsign = new Map(categoryClaims.map(claim => [claim.rawSubject, claim]));
    for (const row of FIXTURE_ROWS) {
      const expected = normaliseLicenceCategory(row.Product, REF);
      const claim = byCallsign.get(row['Call Sign']);
      if (expected === null) {
        expect(claim).toBeUndefined();
      } else {
        expect(claim).toBeDefined();
        expect(claim?.layer).toBe('derived');
        expect(claim?.rule).toBe(LICENCE_CATEGORY_RULE);
        expect(claim?.object).toBe(expected);
      }
    }

    // One derived claim per mapped row, no more: the tier does not over-emit.
    const mappedRows = FIXTURE_ROWS.filter(row => normaliseLicenceCategory(row.Product, REF) !== null);
    expect(categoryClaims.length).toBe(mappedRows.length);
  });

  it('LicenceCategoryClaims_WhenTemporaryReciprocalVersusFullReciprocal_StayDistinct', () => {
    // The distinction a naive re-derivation most often loses. The tier must keep
    // the temporary visitor authorisation and the permanent full-on-reciprocal
    // licence in separate categories, exactly as the map does.
    const byCallsign = new Map(categoryClaimsOf(emitLicenceCategoryClaims(FIXTURE_SOURCE, REF)).map(c => [c.rawSubject, c.object]));
    const temporary = byCallsign.get('M0DDD');
    const full = byCallsign.get('M0EEE');
    expect(temporary).toBe('Temporary Reciprocal');
    expect(full).toBe('Full Reciprocal');
    expect(temporary).not.toBe(full);
  });

  it('LicenceCategoryClaims_WhenProductBlankOrUnmapped_EmitNoCategoryButKeepRawClaim', () => {
    // Blank and unmapped both mirror the legacy's null: NO derived category. The
    // unmapped non-blank product stays fully visible in its verbatim raw claim -
    // the surprise is surfaced, never silently dropped or bucketed.
    const ledger = emitLedger(FIXTURE_SOURCE, REF);
    const categoryByCallsign = new Map(categoryClaimsOf(ledger).map(c => [c.rawSubject, c]));
    expect(categoryByCallsign.has('M7HHH')).toBe(false);
    expect(categoryByCallsign.has('M7III')).toBe(false);

    // The unmapped product survives verbatim as a raw claim (source fidelity).
    const rawUnmapped = ledger.find(claim =>
      claim.layer === 'raw' && claim.rawSubject === 'M7III' && claim.predicate === 'Product');
    expect(rawUnmapped?.object).toBe('Amateur Novice Radio Licence');
  });
});

describe('raw and derived tiers coexist unchanged', () => {
  it('RawProductClaims_WhenCategoryTierAdded_SurviveVerbatimBesideTheDerivedClaims', () => {
    const ledger = emitLedger(FIXTURE_SOURCE, REF);

    // Every non-blank product row still carries its verbatim raw 'Product' claim
    // (the tier is additive, never a replacement).
    for (const row of FIXTURE_ROWS) {
      if (row.Product === '') continue;
      const raw = ledger.find(claim =>
        claim.layer === 'raw' && claim.rawSubject === row['Call Sign'] && claim.predicate === 'Product');
      expect(raw?.object).toBe(row.Product);
    }

    // A mapped row exposes BOTH tiers at once: the verbatim raw product AND the
    // derived canonical category, filterable by layer.
    const g0aaa = ledger.filter(claim => claim.rawSubject === 'G0AAA');
    expect(g0aaa.some(c => c.layer === 'raw' && c.predicate === 'Product' && c.object === 'Full')).toBe(true);
    expect(g0aaa.some(c => c.layer === 'derived' && c.predicate === LICENCE_CATEGORY_PREDICATE && c.object === 'Full')).toBe(true);
  });
});

describe('the derived tier over a real product-bearing register snapshot', () => {
  it('LicenceCategoryClaims_WhenBuiltFromRealSnapshot_MatchTheMapOverEveryProductCell', () => {
    // ofcom-2023-12-07 is a full register whose raw source carries a 'Product'
    // column, so registerSourcesFor binds a product column and the tier fires.
    const entry = 'ofcom-2023-12-07--open-data-call-sign-list--all-callsigns';
    const meta = readFoiEntryMeta(defaultFoiDir(), entry);
    const source = registerSourcesFor(meta).find(s => s.productColumn !== null);
    expect(source).toBeDefined();
    if (source === undefined) return;

    const observationSet = loadRegisterSource(defaultFoiDir(), entry, meta, source);
    expect(observationSet.categoryColumn).toBe(source.productColumn);
    const ledger = emitLedger(observationSet, REF);

    // Every derived category claim equals the map applied to that observation's
    // raw product cell - the equivalence to the legacy fold, checked per row.
    const categoryColumn = observationSet.categoryColumn;
    expect(categoryColumn).toBeDefined();
    let checked = 0;
    for (const claim of categoryClaimsOf(ledger)) {
      const rawProduct = observationSet.rows[claim.provenance.ordinal][categoryColumn ?? ''] ?? '';
      expect(claim.object).toBe(normaliseLicenceCategory(rawProduct, REF));
      checked += 1;
    }
    // The snapshot genuinely disclosed products, so the tier produced claims.
    expect(checked).toBeGreaterThan(0);

    // No claim was emitted for a blank/unmapped product (mirrors the map's null).
    const mappedCount = observationSet.rows.filter(row => normaliseLicenceCategory(row[categoryColumn ?? ''] ?? '', REF) !== null).length;
    expect(checked).toBe(mappedCount);
  });
});

describe('compact-DB parity on the derived licence-category tier', () => {
  it('CompactClaimsView_WhenLedgerHasCategoryClaims_ReconstructsThemIdenticallyToFatTable', () => {
    // A tiny synthetic ledger written to disk exercises the compact VIEW's
    // reconstruction of the derived category rows without a whole-corpus build.
    // The fat one-row-per-claim table stores them verbatim from the JSONL; the
    // compact schema stores each category once on its observation and synthesises
    // the row in the VIEW. Parity is the contract that lets the compact schema
    // drop in for the fat one, so the two must return an identical category-row
    // multiset.
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'licence-category-parity-'));
    try {
      const ledgerDir = path.join(workDir, 'ledger');
      fs.mkdirSync(ledgerDir, { recursive: true });
      fs.writeFileSync(path.join(ledgerDir, 'fixture.jsonl'), serialiseClaimsJsonl(emitLedger(FIXTURE_SOURCE, REF)));

      const fatPath = path.join(workDir, 'fat.sqlite');
      const compactPath = path.join(workDir, 'compact.sqlite.png');
      buildLedgerSqlite(ledgerDir, fatPath);
      buildCompactLedgerSqlite(ledgerDir, compactPath);

      const categoryRows = (file: string): Record<string, unknown>[] => {
        const db = new DatabaseSync(file, { readOnly: true });
        try {
          return db.prepare(
            `SELECT layer, raw_subject, cleaned, entity, predicate, object, IFNULL(rule, '') AS rule, source_file, ordinal, vintage
             FROM claims WHERE predicate = ? ORDER BY raw_subject, object`,
          ).all(LICENCE_CATEGORY_PREDICATE) as Record<string, unknown>[];
        } finally {
          db.close();
        }
      };

      const fatCategoryRows = categoryRows(fatPath);
      const compactCategoryRows = categoryRows(compactPath);

      // The tier genuinely populated the ledger, and the two schemas agree
      // row-for-row on every column - the reconstruction is faithful.
      const mappedCount = FIXTURE_ROWS.filter(row => normaliseLicenceCategory(row.Product, REF) !== null).length;
      expect(fatCategoryRows.length).toBe(mappedCount);
      expect(compactCategoryRows).toEqual(fatCategoryRows);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }, 120_000);
});
