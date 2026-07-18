import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  emitClaims,
  emitLedger,
  emitFileManifestClaims,
  LISTED_PREDICATE,
  NORMALISES_TO_PREDICATE,
  LICENCE_CATEGORY_PREDICATE,
  SUBJECT_PREDICATE,
  columnPredicate,
} from '../claim.ts';
import { buildLedger } from '../build-ledger.ts';
import {
  collectAvailablePoolSources,
  availablePoolEntries,
  AVAILABLE_POOL_CLASS,
} from './available-pool.ts';
import { verbatimCsvSourcesFor } from './foi-verbatim-csv.ts';
import { qualifyingRegisterEntries } from './foi-register.ts';
import { loadReferenceData } from '../../sources/ofcom-amateur/components.ts';

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// The scenario is the available-pool family's claim standing (issue #361) plus
// its lossless-canonical emit (issue #813 Stage A): Ofcom holds no list of
// available call signs - availability is generated on demand - so each row is a
// vintage-scoped snapshot of a 2013-2016 export, an existence-plus-attributes
// assertion that is deliberately NOT a call sign register row. Two sub-shapes
// carry it (2013/14 bare suffixes; 2015/16 typed exports whose Value is a full
// call sign), BOTH are subjectKind 'pool-slot' (so neither acquires the callsign
// normalisation/category derived layer), and BOTH now emit the source's
// verbatim structure - headers, physical columns, preamble furniture - rather
// than a reprojected role vocabulary.

const REF = loadReferenceData();

// Stable archived entry keys - the raw source files and columns are read from
// the authored converter binding, never hard-coded in the test.
const SUFFIX_ENTRY = 'wdtk-174341--available-callsigns-list'; // sub-shape A (2013-09)
const PREAMBLE_ENTRY = 'wdtk-224333--available-callsigns-list'; // sub-shape A with preamble (2014-08)
const TYPED_ENTRY = 'wdtk-247308--available-callsigns-list'; // sub-shape B (2015-02)

// The nine available-pool disclosures the family covers (2013-09..2016-01).
const AVAILABLE_POOL_ENTRY_KEYS = [
  'wdtk-174341', 'wdtk-197896', 'wdtk-224333', 'wdtk-247308', 'wdtk-261814',
  'wdtk-271469', 'wdtk-294011', 'wdtk-299321', 'wdtk-309076',
].map(prefix => `${prefix}--available-callsigns-list`);

function sourceFor(entry: string, sheetMatch: (file: string) => boolean) {
  const source = collectAvailablePoolSources().find(s => s.entry === entry && sheetMatch(s.jsonlStem));
  if (source === undefined) throw new Error(`no available-pool source for ${entry}`);
  return source;
}

describe('available-pool family collection', { tags: ['data-validity'] }, () => {
  it('AvailablePoolFamily_WhenCollected_CoversEveryAvailablePoolDisclosureAsPoolSlots', () => {
    // The family is discovered from datasetClasses, not a hard-coded list, so a
    // newly-classed disclosure is covered automatically.
    const entries = availablePoolEntries();
    expect(entries.map(e => e.entry).sort()).toEqual([...AVAILABLE_POOL_ENTRY_KEYS].sort());
    for (const { meta } of entries) {
      expect(meta.datasetClasses).toContain(AVAILABLE_POOL_CLASS);
    }

    const sources = collectAvailablePoolSources();
    // Eight three-sheet disclosures plus the one combined-sheet 2016 export.
    expect(sources.length).toBe(25);
    for (const source of sources) {
      expect(source.family).toBe('available-pool');
      expect(source.subjectKind).toBe('pool-slot');
      const obs = source.load();
      expect(obs.rows.length).toBeGreaterThan(0);
      expect(obs.subjectColumn.length).toBeGreaterThan(0);
      expect(obs.sourceFile.startsWith(`foi/${source.entry}/`)).toBe(true);
      // Every observation carries the disclosure's vintage - load-bearing for a
      // point-in-time availability snapshot.
      expect(obs.vintage.length).toBeGreaterThan(0);
      // The lossless emit (issue #813 Stage A) attests the structure the
      // reconstruction oracle rebuilds from: the real repo path, a header line,
      // and one source line per data row.
      expect(obs.repoPath).toBe(`archive/${obs.sourceFile}`);
      expect(obs.headerLine).toBeGreaterThan(0);
      expect(obs.lineNumbers?.length).toBe(obs.rows.length);
      // The subject column is one of the source's own verbatim headers.
      expect(obs.columns).toContain(obs.subjectColumn);
    }
  });

  it('AvailablePoolFamily_WhenComparedToRegisterFamily_IsDisjoint', () => {
    // No available-pool entry is also a qualifying register entry, so nothing is
    // emitted twice and a pool row never masquerades as a register row.
    const registerKeys = new Set(qualifyingRegisterEntries().map(e => e.entry));
    for (const { entry } of availablePoolEntries()) {
      expect(registerKeys.has(entry)).toBe(false);
    }
  });

  it('AvailablePoolEntries_NowLosslessCanonicalInTheMainLedger_AreRetiredFromTheVerbatimCsvMirror', () => {
    // The structural double-count resolution (issue #813 Stage A): exactly ONE
    // family carries each available-pool source's structure. The registered
    // available-pool family emits it losslessly, so the parallel oracle-only
    // foi-verbatim-csv mirror must resolve NOTHING for these entries.
    for (const { entry, meta } of availablePoolEntries()) {
      expect(verbatimCsvSourcesFor(meta), `${entry} still mirrored by foi-verbatim-csv`).toEqual([]);
    }
  });
});

describe('sub-shape A - the 2013/14 suffix-shaped lists', { tags: ['data-validity'] }, () => {
  it('SuffixList_WhenEmitted_YieldsOneExistenceClaimPerBareSuffixUnderTheVerbatimLabelHeader', () => {
    const source = sourceFor(SUFFIX_ENTRY, file => file.includes('foundation'));
    const obs = source.load();
    // The lossless shape: the sheet's own single label header, verbatim - the
    // sheet's stated class/prefix rule IS that header string, so the fact the
    // old role vocabulary derived from is still carried, as source structure.
    expect(obs.columns).toEqual(['Foundation = M6aaa']);
    expect(obs.subjectColumn).toBe('Foundation = M6aaa');

    const claims = emitClaims(obs);

    // One existence anchor per listed suffix; the subject is the bare suffix
    // VERBATIM (the M6xxx call sign is deliberately not synthesised here). A
    // single-column sheet emits NO attribute claims - the @listed anchor is the
    // whole per-row assertion.
    const listed = claims.filter(c => c.predicate === LISTED_PREDICATE);
    expect(listed.length).toBe(obs.rows.length);
    expect(claims.length).toBe(listed.length);
    for (const claim of listed.slice(0, 50)) {
      expect(claim.layer).toBe('raw');
      expect(claim.rawSubject.length).toBeGreaterThan(0);
      // Bare suffix - no prefix letters synthesised onto it.
      expect(claim.rawSubject.startsWith('M6')).toBe(false);
      expect(claim.provenance.vintage).toBe('2013-09-06');
    }

    // The deferred role vocabulary (issue #813, re-expressed as a fold in a
    // later stage) is NOT emitted as analytical claims here.
    for (const claim of claims) {
      expect(['licence_class', 'prefix', 'suffix']).not.toContain(claim.predicate);
    }

    // The sheet's stated rule survives in the file-level manifest: the verbatim
    // header rides @column/0 and @subject, so nothing the roles derived from is
    // dropped.
    const manifest = emitFileManifestClaims(obs);
    expect(manifest.find(c => c.predicate === columnPredicate(0))?.object).toBe('Foundation = M6aaa');
    expect(manifest.find(c => c.predicate === SUBJECT_PREDICATE)?.object).toBe('Foundation = M6aaa');
  });

  it('PreambleSuffixList_WhenLoaded_CarriesThePrefixStatementAsPositionedFurniture', () => {
    // The 2014-08 sheets state their prefix in a pre-header preamble (an empty
    // spacer row, then 'Prefix = M6', then the 'Suffix' header). The lossless
    // emit carries those rows as positioned @ignored furniture so the
    // reconstruction reinstates them - and so the prefix assertion is still a
    // stored source fact, not a dropped role claim.
    const source = sourceFor(PREAMBLE_ENTRY, file => file.includes('foundation'));
    const obs = source.load();
    expect(obs.columns).toEqual(['Suffix']);
    expect(obs.subjectColumn).toBe('Suffix');
    expect(obs.headerLine).toBe(3);
    expect((obs.ignoredLines ?? []).map(l => l.line)).toEqual([1, 2]);
    expect((obs.ignoredLines ?? []).map(l => l.content)).toContain('Prefix = M6');
  });
});

describe('sub-shape B - the 2015/16 typed Siebel exports', { tags: ['data-validity'] }, () => {
  it('TypedExport_WhenEmitted_YieldsEveryPhysicalColumnVerbatimKeyedOnTheFullCallSign', () => {
    const source = sourceFor(TYPED_ENTRY, file => file.includes('foundation'));
    const obs = source.load();
    // The lossless shape: every physical column, in source order, under the
    // export's own headers.
    expect(obs.columns).toEqual(['Country', 'Current Series', 'Reference', 'Value', 'Type', 'Product', 'Status', 'Allocated Flag']);
    // The subject stays the authored callsign column - the raw Value cell, NOT
    // blindly the first physical column - so the raw subject token (the thing
    // the value catalogue's Available membership bucket counts cleaned keys
    // over) is unchanged by the lossless cutover.
    expect(obs.subjectColumn).toBe('Value');

    const claims = emitClaims(obs);

    const listed = claims.filter(c => c.predicate === LISTED_PREDICATE);
    expect(listed.length).toBe(obs.rows.length);

    // The subject is the full call sign carried verbatim; the other columns ride
    // as raw attribute claims under their VERBATIM headers (Product/Reference,
    // not the retired licence_class/suffix role names).
    const first = listed[0].rawSubject;
    expect(first.startsWith('M6')).toBe(true);
    const attrs = claims.filter(c => c.rawSubject === first && c.provenance.ordinal === listed[0].provenance.ordinal && c.predicate !== LISTED_PREDICATE);
    expect(attrs.find(c => c.predicate === 'Product')?.object).toBe('Amateur Foundation Radio Licence');
    const suffix = attrs.find(c => c.predicate === 'Reference')?.object ?? '';
    // The Reference suffix is the call sign's own trailing three letters here.
    expect(first.endsWith(suffix)).toBe(true);
    // The sheet-level columns are stored verbatim too - what the export said,
    // never reinterpreted (the status fold scopes these sources out, so this
    // sheet framing never counts as an attested register status).
    expect(attrs.find(c => c.predicate === 'Status')?.object).toBe('Available');
    expect(attrs.find(c => c.predicate === 'Type')?.object).toBe('Call Sign');
    for (const claim of listed.slice(0, 50)) {
      expect(claim.provenance.vintage).toBe('2015-02-25');
    }

    // The retired role vocabulary is genuinely absent (issue #813 Stage A: the
    // roles become a fold over these verbatim columns in a later stage).
    for (const claim of claims) {
      expect(['licence_class', 'suffix', 'prefix', 'callsign']).not.toContain(claim.predicate);
    }
  });
});

describe('pool-slot subjects stay edge-free (the epistemic guard)', { tags: ['data-validity'] }, () => {
  it('TypedExportCallSign_WhenTreatedAsPoolSlot_AcquiresNoRegisterNormalisationOrCategoryEdge', () => {
    const source = sourceFor(TYPED_ENTRY, file => file.includes('foundation'));
    const obs = source.load();

    // buildLedger routes a non-callsign subjectKind through emitClaims (raw
    // only). The pool row's Value IS a call sign, yet it must NOT be normalised
    // as one - joining pool call signs to the register namespace is deferred
    // fold work, not a claim this family makes.
    const claims = emitClaims(obs);
    expect(claims.some(c => c.predicate === NORMALISES_TO_PREDICATE)).toBe(false);
    expect(claims.some(c => c.predicate === LICENCE_CATEGORY_PREDICATE)).toBe(false);
    expect(claims.every(c => c.layer === 'raw')).toBe(true);

    // Contrast: were the SAME rows treated as a register callsign source, the
    // callsign emit path WOULD attach normalises_to edges - so the pool-slot tag
    // is exactly what keeps the family honest, not an accident of the data.
    const asCallsign = emitLedger(obs, REF);
    expect(asCallsign.some(c => c.predicate === NORMALISES_TO_PREDICATE)).toBe(true);
  });

  it('SuffixList_WhenTreatedAsPoolSlot_AcquiresNoCallSignNormalisationEdge', () => {
    const source = sourceFor(SUFFIX_ENTRY, file => file.includes('foundation'));
    const claims = emitClaims(source.load());
    expect(claims.some(c => c.predicate === NORMALISES_TO_PREDICATE)).toBe(false);
    expect(claims.every(c => c.layer === 'raw')).toBe(true);
  });
});

describe('available-pool family through buildLedger', { tags: ['data-validity'] }, () => {
  it('AvailablePoolLedger_WhenBuiltForItsEntries_EmitsRawClaimsOnlyWithNoDerivedLayer', () => {
    const wanted = new Set(AVAILABLE_POOL_ENTRY_KEYS);
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'available-pool-ledger-'));
    try {
      const summary = buildLedger(outputDir, undefined, REF, entry => wanted.has(entry));

      // The selector isolates exactly this family: nine entries, every source
      // tagged available-pool.
      expect(summary.entriesByFamily['available-pool']).toBe(AVAILABLE_POOL_ENTRY_KEYS.length);
      expect(summary.sourcesProcessed).toBe(summary.sourcesByFamily['available-pool']);
      expect(summary.sourcesProcessed).toBeGreaterThanOrEqual(AVAILABLE_POOL_ENTRY_KEYS.length);

      for (const s of summary.perSource) {
        expect(s.family).toBe('available-pool');
        expect(s.observations).toBeGreaterThan(0);
        expect(s.rawClaims).toBeGreaterThan(0);
        // The whole point of the pool-slot tag: no normalisation/category edges.
        expect(s.derivedClaims).toBe(0);
        expect(s.vintage.length).toBeGreaterThan(0);
      }
      expect(summary.totalDerivedClaims).toBe(0);
      expect(summary.totalRawClaims).toBeGreaterThan(0);

      // Exactly one family emits per sourceFile: no source appears twice in the
      // emitted corpus (the no-double-count invariant, issue #813).
      const sourceFiles = summary.perSource.map(s => s.sourceFile);
      expect(new Set(sourceFiles).size).toBe(sourceFiles.length);

      // One JSONL file per source landed on disk (never committed).
      const written = fs.readdirSync(path.join(outputDir, 'ledger')).filter(name => name.endsWith('.jsonl'));
      expect(written.length).toBe(summary.sourcesProcessed);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  }, 120_000);
});
