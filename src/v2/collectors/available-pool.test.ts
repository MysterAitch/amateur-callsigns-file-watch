import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  emitClaims,
  emitLedger,
  LISTED_PREDICATE,
  NORMALISES_TO_PREDICATE,
  LICENCE_CATEGORY_PREDICATE,
} from '../claim.ts';
import { buildLedger } from '../build-ledger.ts';
import {
  collectAvailablePoolSources,
  availablePoolEntries,
  AVAILABLE_POOL_CLASS,
} from './available-pool.ts';
import { qualifyingRegisterEntries } from './foi-register.ts';
import { loadReferenceData } from '../../sources/ofcom-amateur/components.ts';

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// The scenario is the available-pool family's claim standing (issue #361):
// Ofcom holds no list of available call signs - availability is generated on
// demand - so each row is a vintage-scoped snapshot of a 2013-2016 export, an
// existence-plus-attributes assertion that is deliberately NOT a call sign
// register row. Two sub-shapes carry it (2013/14 bare suffixes; 2015/16 typed
// exports whose Value is a full call sign), and BOTH are subjectKind
// 'pool-slot', so neither acquires the callsign normalisation/category derived
// layer.

const REF = loadReferenceData();

// Stable archived entry keys - the raw source files and columns are read from
// the authored converter binding, never hard-coded in the test.
const SUFFIX_ENTRY = 'wdtk-174341--available-callsigns-list'; // sub-shape A (2013-09)
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
});

describe('sub-shape A - the 2013/14 suffix-shaped lists', { tags: ['data-validity'] }, () => {
  it('SuffixList_WhenEmitted_YieldsExistenceAndClassPrefixClaimsKeyedOnTheBareSuffix', () => {
    const source = sourceFor(SUFFIX_ENTRY, file => file.includes('foundation'));
    const obs = source.load();
    expect(obs.subjectColumn).toBe('suffix');
    expect(obs.columns).toEqual(['suffix', 'licence_class', 'prefix']);

    const claims = emitClaims(obs);

    // One existence anchor per listed suffix; the subject is the bare suffix
    // VERBATIM (the M6xxx call sign is deliberately not synthesised here).
    const listed = claims.filter(c => c.predicate === LISTED_PREDICATE);
    expect(listed.length).toBe(obs.rows.length);
    for (const claim of listed.slice(0, 50)) {
      expect(claim.layer).toBe('raw');
      expect(claim.rawSubject.length).toBeGreaterThan(0);
      // Bare suffix - no prefix letters synthesised onto it.
      expect(claim.rawSubject.startsWith('M6')).toBe(false);
      expect(claim.provenance.vintage).toBe('2013-09-06');
    }

    // The sheet's own stated class and prefix ride as attribute claims on the
    // same subject (Foundation = M6aaa).
    const first = listed[0].rawSubject;
    const attrs = claims.filter(c => c.rawSubject === first && c.predicate !== LISTED_PREDICATE);
    expect(attrs.find(c => c.predicate === 'licence_class')?.object).toBe('Foundation');
    expect(attrs.find(c => c.predicate === 'prefix')?.object).toBe('M6');
  });
});

describe('sub-shape B - the 2015/16 typed Siebel exports', { tags: ['data-validity'] }, () => {
  it('TypedExport_WhenEmitted_YieldsExistenceClassAndSuffixClaimsKeyedOnTheFullCallSign', () => {
    const source = sourceFor(TYPED_ENTRY, file => file.includes('foundation'));
    const obs = source.load();
    expect(obs.subjectColumn).toBe('callsign');
    expect(obs.columns).toEqual(['callsign', 'licence_class', 'suffix']);

    const claims = emitClaims(obs);

    const listed = claims.filter(c => c.predicate === LISTED_PREDICATE);
    expect(listed.length).toBe(obs.rows.length);

    // The subject is the full call sign carried verbatim; the raw Product rides
    // as licence_class and the raw Reference as suffix (both verbatim, spaces
    // and case intact).
    const first = listed[0].rawSubject;
    expect(first.startsWith('M6')).toBe(true);
    const attrs = claims.filter(c => c.rawSubject === first && c.predicate !== LISTED_PREDICATE);
    const licenceClass = attrs.find(c => c.predicate === 'licence_class')?.object ?? '';
    const suffix = attrs.find(c => c.predicate === 'suffix')?.object ?? '';
    expect(licenceClass).toBe('Amateur Foundation Radio Licence');
    // The Reference suffix is the call sign's own trailing three letters here.
    expect(first.endsWith(suffix)).toBe(true);
    for (const claim of listed.slice(0, 50)) {
      expect(claim.provenance.vintage).toBe('2015-02-25');
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

      // One JSONL file per source landed on disk (never committed).
      const written = fs.readdirSync(path.join(outputDir, 'ledger')).filter(name => name.endsWith('.jsonl'));
      expect(written.length).toBe(summary.sourcesProcessed);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  }, 120_000);
});
