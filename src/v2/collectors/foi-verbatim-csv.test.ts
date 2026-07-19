import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import {
  emitClaims,
  emitFileManifestClaims,
  LISTED_PREDICATE,
  NORMALISES_TO_PREDICATE,
  LICENCE_CATEGORY_PREDICATE,
  SUBJECT_PREDICATE,
  columnPredicate,
} from '../claim.ts';
import { buildLedger } from '../build-ledger.ts';
import { buildCompactLedgerSqlite } from '../build-ledger-db-compact.ts';
import { collectFoiVerbatimCsvSources, verbatimCsvSourcesFor, loadFoiVerbatimCsvSource } from './foi-verbatim-csv.ts';
import { attributeAddendumEntries } from './attribute-addendum.ts';
import { registerSourcesFor, qualifyingRegisterEntries, ATTRIBUTE_ADDENDUM_CLASS } from './foi-register.ts';
import { listFoiEntryKeys, readFoiEntryMeta, defaultFoiDir, type FoiEntryMeta } from '../../shared/foi-archive.ts';
import type { FoiSourceConversion } from '../../shared/foi-normalise.ts';
import { loadReferenceData } from '../../sources/ofcom-amateur/components.ts';

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// The scenario is issue #813 Stage B: the foi-verbatim-csv family - the shared
// structure-preserving loader, scoped since Stage A to exactly the 2015 pre-war
// annex (wdtk-238892) - is now REGISTERED in the collector registry, so the two
// annex sheets ride the canonical persisted ledger through the one emit path.
// Its subject kind is the explicitly raw-only 'token': a pre-war G-callsign is
// not a pool slot, and the family makes NO analytical claim about its subjects
// (deliberately no callsign tiers - promoting sheet 1 is the Stage D rider, a
// separate decision, not a Stage B side effect). The fragile complement that
// keeps the attribute-addendum family off these sheets (the preamble skip in
// registerSourcesFor) is asserted here BY SOURCEFILE, not by prose.

const REF = loadReferenceData();
const FOI_DIR = defaultFoiDir();

const ANNEX_ENTRY = 'wdtk-238892--out-of-sequence-callsigns';
const SHEET_1 = `foi/${ANNEX_ENTRY}/raw-extract-sheet-1-callsigns.csv`;
const SHEET_2 = `foi/${ANNEX_ENTRY}/raw-extract-sheet-2-database-fields.csv`;

// The committed recordCount for the normalised twin of one raw extract, read
// from the entry's meta.json (the converter's own cross-checked row count) so
// the ledger's row count is pinned against an INDEPENDENT committed figure,
// never against itself.
function committedRecordCount(rawExtractFile: string): number {
  const meta = readFoiEntryMeta(FOI_DIR, ANNEX_ENTRY);
  const declaration = Object.values(meta.files).find(file => file.role === 'normalised' && file.normalisedFrom === rawExtractFile);
  if (declaration?.recordCount === undefined) {
    throw new Error(`${ANNEX_ENTRY}: no committed recordCount for the normalised twin of ${rawExtractFile}`);
  }
  return declaration.recordCount;
}

describe('foi-verbatim-csv family registration (issue #813 Stage B)', { tags: ['data-validity'] }, () => {
  it('VerbatimCsvFamily_WhenCollected_ResolvesExactlyThePrewarAnnexSheetsAsRawOnlyTokens', () => {
    const sources = collectFoiVerbatimCsvSources();
    expect(sources).toHaveLength(2);
    for (const source of sources) {
      expect(source.family).toBe('foi-verbatim-csv');
      // The Stage B subject-kind correction: 'token' (explicitly raw-only), not
      // the pool-slot label the module carried while unregistered - a pre-war
      // G-callsign is not a pool slot.
      expect(source.subjectKind).toBe('token');
      expect(source.entry).toBe(ANNEX_ENTRY);
    }

    const loaded = sources.map(source => source.load());
    expect(loaded.map(s => s.sourceFile).sort()).toEqual([SHEET_1, SHEET_2]);
    for (const observationSet of loaded) {
      // The lossless attestation the reconstruction oracle rebuilds from.
      expect(observationSet.repoPath).toBe(`archive/${observationSet.sourceFile}`);
      expect(observationSet.headerLine).toBeGreaterThan(0);
      expect(observationSet.lineNumbers?.length).toBe(observationSet.rows.length);
      expect(observationSet.vintage).toBe('2015-01');
    }

    // Sheet 1: the two-column callsign list behind a two-row preamble (the
    // annex title line and a blank spacer), carried as positioned furniture.
    const sheet1 = loaded.find(s => s.sourceFile === SHEET_1);
    expect(sheet1).toBeDefined();
    if (sheet1 === undefined) return;
    expect(sheet1.columns).toEqual(['Call Sign', 'Original Start Date']);
    expect(sheet1.subjectColumn).toBe('Call Sign');
    expect(sheet1.headerLine).toBe(3);
    expect((sheet1.ignoredLines ?? []).map(l => l.line)).toEqual([1, 2]);
    expect(sheet1.rows.length).toBe(committedRecordCount('raw-extract-sheet-1-callsigns.csv'));
    expect(sheet1.rows.length).toBe(419);

    // Sheet 2: the disclosed licensing-database column headings, whose FIRST
    // header is the EMPTY STRING - a verbatim source fact, kept as-is.
    const sheet2 = loaded.find(s => s.sourceFile === SHEET_2);
    expect(sheet2).toBeDefined();
    if (sheet2 === undefined) return;
    expect(sheet2.columns).toEqual(['', 'Field Name']);
    expect(sheet2.subjectColumn).toBe('');
    expect(sheet2.headerLine).toBe(1);
    expect(sheet2.ignoredLines ?? []).toEqual([]);
    expect(sheet2.rows.length).toBe(committedRecordCount('raw-extract-sheet-2-database-fields.csv'));
    expect(sheet2.rows.length).toBe(41);
  });

  it('AnnexEntry_DespiteItsAddendumClass_ResolvesIntoTheVerbatimFamilyAndNotTheAddendumFamily', () => {
    // The fragile complement, dissolved by assertion (issue #813 Stage B): the
    // annex's entry class IS attribute-addendum, and ONLY the preamble skip in
    // registerSourcesFor keeps the addendum family off its sheets. Assert the
    // disjointness BY SOURCEFILE - the key the sole-emitter invariant (and the
    // whole double-count class) actually turns on - so a loosened predicate on
    // either side fails here by name.
    const annexMeta = readFoiEntryMeta(FOI_DIR, ANNEX_ENTRY);
    expect(annexMeta.datasetClasses).toContain(ATTRIBUTE_ADDENDUM_CLASS);
    // The addendum machinery resolves NOTHING for this entry (both conversions
    // declare a preamble), while the verbatim family resolves both sheets.
    expect(registerSourcesFor(annexMeta)).toEqual([]);
    expect(verbatimCsvSourcesFor(annexMeta).map(c => c.sourceFile).sort()).toEqual([
      'raw-extract-sheet-1-callsigns.csv',
      'raw-extract-sheet-2-database-fields.csv',
    ]);

    // Corpus-wide, by sourceFile: the verbatim family's keys intersect neither
    // the attribute-addendum family's nor the FOI-register family's.
    const addendumKeys = new Set(attributeAddendumEntries().flatMap(({ entry, meta }) =>
      registerSourcesFor(meta).map(source => `foi/${entry}/${source.conversion.sourceFile}`)));
    const registerKeys = new Set(qualifyingRegisterEntries().flatMap(({ entry, meta }) =>
      registerSourcesFor(meta).map(source => `foi/${entry}/${source.conversion.sourceFile}`)));
    const verbatimKeys = listFoiEntryKeys(FOI_DIR).flatMap(entry =>
      verbatimCsvSourcesFor(readFoiEntryMeta(FOI_DIR, entry)).map(conversion => `foi/${entry}/${conversion.sourceFile}`));
    expect(verbatimKeys.sort()).toEqual([SHEET_1, SHEET_2]);
    for (const key of verbatimKeys) {
      expect(addendumKeys.has(key), `${key} also resolved by attribute-addendum`).toBe(false);
      expect(registerKeys.has(key), `${key} also resolved by foi-register`).toBe(false);
    }
  });

  it('AnnexTokenSubjects_WhenEmitted_AcquireNoNormalisationEdgeOrDerivedTier', () => {
    // The epistemic guard behind the 'token' kind: sheet 1's subjects ARE
    // G-series callsign tokens, yet the family deliberately asserts nothing
    // about them beyond the published bytes - no normalises_to edge, no
    // licence-category tier, nothing derived at all. (Promotion to callsign
    // tiers would move the committed value-catalogue goldens; it is the Stage D
    // rider, a decision to be taken deliberately, not a side effect here.)
    for (const source of collectFoiVerbatimCsvSources()) {
      const claims = emitClaims(source.load());
      expect(claims.length).toBeGreaterThan(0);
      expect(claims.every(c => c.layer === 'raw')).toBe(true);
      expect(claims.some(c => c.predicate === NORMALISES_TO_PREDICATE)).toBe(false);
      expect(claims.some(c => c.predicate === LICENCE_CATEGORY_PREDICATE)).toBe(false);
    }
  });

  it('EmptyFirstHeader_WhenEmittedAsManifest_SurvivesAsAnEmptyColumnZeroAndSubjectObject', () => {
    // Sheet 2's empty-string first header is a round-trip hazard: it must ride
    // the manifest as a GENUINE empty @column/0 object (and the @subject object
    // must equal it), never dropped or coalesced.
    const sheet2 = collectFoiVerbatimCsvSources().map(s => s.load()).find(s => s.sourceFile === SHEET_2);
    expect(sheet2).toBeDefined();
    if (sheet2 === undefined) return;
    const manifest = emitFileManifestClaims(sheet2);
    expect(manifest.find(c => c.predicate === columnPredicate(0))?.object).toBe('');
    expect(manifest.find(c => c.predicate === columnPredicate(1))?.object).toBe('Field Name');
    expect(manifest.find(c => c.predicate === SUBJECT_PREDICATE)?.object).toBe('');
  });
});

describe('foi-verbatim-csv subject resolved by binding, not physical position (issue #847)', { tags: ['unit'] }, () => {
  // The subject is read from the authored binding's declared subjectColumn, not
  // from the first physical column - so a verbatim CSV whose subject is not
  // column 0 (a leading serial/index, a reordered export) fails loud rather than
  // silently storing a non-subject token as raw_subject, which no byte-parity or
  // reconstruction gate catches (the manifest places columns identically either
  // way). The loader ignores conversion.columns for PARSING - the raw header row
  // is authoritative - so these fixtures exercise the subject resolution alone.
  const META = { dataVintage: '2020-01' } as unknown as FoiEntryMeta;

  function conversionFor(sourceFile: string, subjectColumn: string | undefined): FoiSourceConversion {
    return {
      sourceFile,
      encoding: 'utf8',
      preamble: [],
      subjectColumn,
      columns: [{ source: 'Call Sign', output: 'callsign', kind: 'verbatim' }],
      ignoredColumns: [],
      rowOrder: 'source-order',
      orderRationale: 'test fixture',
    };
  }

  function loadFixture(header: string, subjectColumn: string | undefined) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verbatim-847-'));
    const entry = 'fixture-entry';
    const sourceFile = 'fixture.csv';
    fs.mkdirSync(path.join(dir, entry), { recursive: true });
    fs.writeFileSync(path.join(dir, entry, sourceFile), `${header}\n001,G2ABC\n`, 'utf8');
    try {
      return loadFoiVerbatimCsvSource(dir, entry, META, conversionFor(sourceFile, subjectColumn));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('VerbatimSubject_WhenBoundColumnIsNotFirst_ResolvesByNameNotPosition', () => {
    // A leading "Serial" column shifts the subject off column 0. Resolving by
    // the declared name pins the subject to "Call Sign", where a positional
    // read would have stored the serial ("Serial") as the subject.
    const loaded = loadFixture('Serial,Call Sign', 'Call Sign');
    expect(loaded.columns).toEqual(['Serial', 'Call Sign']);
    expect(loaded.subjectColumn).toBe('Call Sign');
  });

  it('VerbatimSubject_WhenBoundColumnAbsentFromRawHeader_ThrowsLoud', () => {
    // The raw header has been re-shaped (the subject column renamed) so the
    // binding's declared subject is gone: a changed shape must fail loud, not
    // fall back to some other column.
    expect(() => loadFixture('Serial,Callsign', 'Call Sign'))
      .toThrow(/authored subject column "Call Sign" absent from raw header/);
  });

  it('VerbatimSubject_WhenNoColumnBound_FallsBackToFirstPhysicalColumn', () => {
    // The shared-mirror path (available-pool / forbidden-list re-point the
    // subject after loading) declares no subjectColumn, so the first physical
    // column stands as the affirmed default.
    const loaded = loadFixture('Suffix,Note', undefined);
    expect(loaded.subjectColumn).toBe('Suffix');
  });
});

describe('the annex family through the registered build pipeline (issue #813 Stage B)', { tags: ['data-validity'] }, () => {
  it('AnnexLedger_WhenBuiltAndCompacted_StaysRawOnlyEdgeFreeAndRoundTripsTheEmptyHeader', () => {
    // End to end through the REGISTERED path: buildLedger persists the annex
    // JSONL through the one canonical emit, and the compact database re-presents
    // it - with the #824 edge gate recording emits_edges = 0 for both sheets,
    // ZERO derived rows in the claims VIEW (no fabricated edges), the @listed
    // count per sheet equal to the committed record counts, and sheet 2's
    // EMPTY-STRING first header surviving the file_claim dictionary.
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'annex-stage-b-'));
    try {
      const summary = buildLedger(workDir, FOI_DIR, REF, entry => entry === ANNEX_ENTRY);
      expect(summary.sourcesProcessed).toBe(2);
      expect(summary.sourcesByFamily['foi-verbatim-csv']).toBe(2);
      expect(summary.totalDerivedClaims).toBe(0);
      expect(summary.perSource.map(s => ({ sourceFile: s.sourceFile, observations: s.observations }))).toEqual([
        { sourceFile: SHEET_1, observations: 419 },
        { sourceFile: SHEET_2, observations: 41 },
      ]);

      const dbPath = path.join(workDir, 'annex-compact.sqlite');
      buildCompactLedgerSqlite(path.join(workDir, 'ledger'), dbPath);
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        // The #824 gate: the new family lands edge-less from its first build.
        const flags = db.prepare('SELECT source_file, emits_edges FROM source ORDER BY source_file').all() as { source_file: string; emits_edges: number }[];
        expect(flags).toEqual([
          { source_file: SHEET_1, emits_edges: 0 },
          { source_file: SHEET_2, emits_edges: 0 },
        ]);
        // No fabricated derived rows in the compact VIEW - it must agree with
        // the raw-only persisted ledger exactly.
        const derived = Number((db.prepare("SELECT COUNT(*) c FROM claims WHERE layer = 'derived'").get() as { c: number | bigint }).c);
        expect(derived).toBe(0);
        const edges = Number((db.prepare(`SELECT COUNT(*) c FROM claims WHERE predicate = '${NORMALISES_TO_PREDICATE}'`).get() as { c: number | bigint }).c);
        expect(edges).toBe(0);
        // @listed per sheet equals the committed record counts.
        const listed = db.prepare(`SELECT source_file, COUNT(*) c FROM claims WHERE predicate = '${LISTED_PREDICATE}' GROUP BY source_file ORDER BY source_file`).all() as { source_file: string; c: number | bigint }[];
        expect(listed.map(row => ({ source_file: row.source_file, c: Number(row.c) }))).toEqual([
          { source_file: SHEET_1, c: 419 },
          { source_file: SHEET_2, c: 41 },
        ]);
        // Sheet 2's empty first header round-trips the file_claim dictionary:
        // the VIEW re-presents @column/0 with a genuinely empty object.
        const columnZero = db.prepare(`SELECT object FROM claims WHERE source_file = ? AND predicate = '${columnPredicate(0)}'`).all(SHEET_2) as { object: string }[];
        expect(columnZero).toEqual([{ object: '' }]);
        const subject = db.prepare(`SELECT object FROM claims WHERE source_file = ? AND predicate = '${SUBJECT_PREDICATE}'`).all(SHEET_2) as { object: string }[];
        expect(subject).toEqual([{ object: '' }]);
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }, 120_000);
});
