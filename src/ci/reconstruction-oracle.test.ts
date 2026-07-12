import { describe, it, expect } from 'vitest';
import {
  canonicaliseCsvText,
  reconstructCsvFromClaims,
  reconstructionResultFor,
  collectCsvReconstructionSources,
  assertReconstruction,
  listNotYetCovered,
  COVERED_FAMILIES,
} from './reconstruction-oracle.ts';
import {
  emitClaims,
  emitFileManifestClaims,
  columnPredicate,
  SUBJECT_PREDICATE,
  LISTED_PREDICATE,
  NORMALISES_TO_PREDICATE,
  CLEANED_CALLSIGN_RULE,
  FILE_LEVEL_ORDINAL,
  type Claim,
  type SourceObservationSet,
} from '../v2/claim.ts';
import { collectOpenDataRegisterSources } from '../v2/collectors/open-data-register.ts';
import { collectFoiRegisterSources } from '../v2/collectors/foi-register.ts';
import { collectAttributeAddendumSources } from '../v2/collectors/attribute-addendum.ts';
import type { ResolvedLedgerSource } from '../v2/collectors/types.ts';

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// The reconstruction oracle (issue #434) rebuilds each TEXT source from its
// raw-keyed-ledger claims ALONE and proves the rebuild equals the ORIGINAL raw
// bytes modulo the declared cosmetic axes. A pass is the canonicity claim: the
// raw layer carries the whole source, so the committed raw file is
// redundant-by-derivation. The load-bearing scenario is a user re-deriving the
// original publication from the claim stream and getting the same file back.

// ---- Cosmetic normaliser: ignore the declared axes, nothing more ------------

describe('the cosmetic normaliser ignores exactly the declared axes', () => {
  it('CsvText_WhenDifferingOnlyByBomLineEndingsQuotingAndTrailingNewline_CanonicaliseEqual', () => {
    const crlf = 'Value,Status\r\nM7TEE,Allocated\r\n';
    const withBom = '﻿Value,Status\nM7TEE,Allocated';
    const overQuoted = '"Value","Status"\n"M7TEE","Allocated"\n';
    const canonical = canonicaliseCsvText(crlf);
    expect(canonicaliseCsvText(withBom)).toBe(canonical);
    expect(canonicaliseCsvText(overQuoted)).toBe(canonical);
  });

  it('CsvText_WhenACellValueDiffers_CanonicaliseDivergently', () => {
    // A SIGNIFICANT difference (a data byte) must survive the normaliser.
    expect(canonicaliseCsvText('Value\nM7TEE\n')).not.toBe(canonicaliseCsvText('Value\nM7TEF\n'));
  });

  it('CsvText_WhenInteriorWhitespaceDiffers_CanonicaliseDivergently', () => {
    // A trailing space inside a cell is DATA, never cosmetic (the NBSP-twin
    // rationale): the normaliser must not trim it away.
    expect(canonicaliseCsvText('Value\nM7TEE \n')).not.toBe(canonicaliseCsvText('Value\nM7TEE\n'));
  });
});

// ---- Reconstruction from claims alone (synthetic, fast) ---------------------

function tinySource(): SourceObservationSet {
  return {
    sourceFile: 'synthetic/tiny.csv',
    vintage: '2026-01-01',
    columns: ['Status', 'Call Sign', 'Note'],
    subjectColumn: 'Call Sign',
    headerLine: 1,
    ignoredLines: [],
    encoding: 'utf8',
    rows: [
      { 'Status': 'Allocated', 'Call Sign': 'M7TEE', 'Note': 'has, comma' },
      { 'Status': 'Reserved', 'Call Sign': 'G0ABC', 'Note': '' },
    ],
  };
}

describe('a source reconstructs from its claim stream alone', () => {
  it('SyntheticSource_WhenReconstructedFromClaims_MatchesTheOriginalModuloCosmetics', () => {
    const source = tinySource();
    const original = 'Status,Call Sign,Note\nAllocated,M7TEE,"has, comma"\nReserved,G0ABC,\n';
    const claims = [...emitClaims(source), ...emitFileManifestClaims(source)];
    const reconstruction = reconstructCsvFromClaims(claims);
    expect(canonicaliseCsvText(reconstruction)).toBe(canonicaliseCsvText(original));
  });

  it('DerivedClaims_WhenPresentInTheStream_AreIgnoredByTheReconstruction', () => {
    // The reconstruction uses raw claims only; a fold output (a normalises_to
    // edge) must not perturb the rebuilt bytes.
    const source = tinySource();
    const base = [...emitClaims(source), ...emitFileManifestClaims(source)];
    const derived: Claim = {
      layer: 'derived', rawSubject: 'M7TEE', predicate: NORMALISES_TO_PREDICATE, object: 'M7TEE',
      rule: CLEANED_CALLSIGN_RULE,
      provenance: { sourceFile: source.sourceFile, ordinal: 0, vintage: source.vintage },
    };
    expect(reconstructCsvFromClaims([...base, derived])).toBe(reconstructCsvFromClaims(base));
  });

  it('ClaimStreamWithAnOrdinalHole_WhenReconstructed_FailsLoud', () => {
    // A missing ordinal is a corruption, not a blank row - the gap-free
    // invariant must throw rather than silently drop a row.
    const source = tinySource();
    const claims = [...emitClaims(source), ...emitFileManifestClaims(source)]
      .filter(claim => claim.provenance.ordinal !== 0);
    expect(() => reconstructCsvFromClaims(claims)).toThrow(/gap-free ordinal/);
  });

  it('ClaimStreamMissingItsManifest_WhenReconstructed_FailsLoud', () => {
    // Without the @column manifest there is no header to rebuild - fail loud
    // rather than emit a headerless file.
    const source = tinySource();
    expect(() => reconstructCsvFromClaims(emitClaims(source))).toThrow(/@column/);
  });

  it('ReconstructedHeader_WhenSubjectColumnIsNotFirst_IsPlacedByTheManifest', () => {
    // The manifest, not a positional guess, decides where the subject column
    // sits: here 'Call Sign' is the SECOND column and must reappear there.
    const claims = [...emitClaims(tinySource()), ...emitFileManifestClaims(tinySource())];
    const header = reconstructCsvFromClaims(claims).split('\n')[0];
    expect(header).toBe('Status,Call Sign,Note');
    // Sanity: the manifest genuinely names the subject and its index-1 column.
    const manifest = emitFileManifestClaims(tinySource());
    expect(manifest.find(c => c.predicate === SUBJECT_PREDICATE)?.object).toBe('Call Sign');
    expect(manifest.find(c => c.predicate === columnPredicate(1))?.object).toBe('Call Sign');
    expect(manifest.every(c => c.provenance.ordinal === FILE_LEVEL_ORDINAL)).toBe(true);
    // The @listed anchor rows carry real (non-sentinel) ordinals.
    expect(claims.some(c => c.predicate === LISTED_PREDICATE && c.provenance.ordinal === 0)).toBe(true);
  });
});

// ---- Real-archive per-lane oracle -------------------------------------------

function loadByEntry(resolved: readonly ResolvedLedgerSource[], entry: string, sourceFilePart?: string): SourceObservationSet {
  const matches = resolved.filter(source => source.entry === entry);
  const picked = sourceFilePart === undefined ? matches[0] : matches.find(source => source.jsonlStem.includes(sourceFilePart));
  if (picked === undefined) throw new Error(`no resolved source for entry ${entry}${sourceFilePart !== undefined ? ` matching ${sourceFilePart}` : ''}`);
  return picked.load();
}

describe('CSV-lane sources reconstruct byte-identically modulo cosmetics from the real archive', () => {
  it('OpenDataRawSource_WhenReconstructedFromClaims_MatchesOriginalModuloCosmetics', () => {
    // The strongest lane: parseRawRegister's line-accounting invariant rules out
    // multiline cells, so the CSV serialiser has no undetectable hazard. The
    // 2022-05-30 snapshot additionally carries salesforce FOOTER furniture, so
    // the @ignored manifest is genuinely exercised.
    const sources = collectOpenDataRegisterSources();
    for (const key of ['2022-05-30', '2025-05-27']) {
      const result = reconstructionResultFor(loadByEntry(sources, key));
      expect(result.detail ?? '').toBe('');
      expect(result.ok).toBe(true);
    }
  });

  it('FoiRegisterRawSource_WhenReconstructedFromClaims_MatchesOriginalModuloCosmetics', () => {
    // This disclosure's callsign column contains an RFC-4180 quoted value equal
    // to ",," - a data quote vs framing quote hazard the logical-cell comparison
    // must round-trip.
    const source = loadByEntry(collectFoiRegisterSources(), 'ofcom-01420046--allocated-reserved-callsigns');
    const result = reconstructionResultFor(source);
    expect(result.detail ?? '').toBe('');
    expect(result.ok).toBe(true);
  });

  it('AttributeAddendumRawSource_WhenReconstructedFromClaims_MatchesOriginalModuloCosmetics', () => {
    // ofcom-756622 is latin-1 with a raw 0xA0 NBSP and a TRUNCATED header
    // ('Licence Issued Dat') - the decoded-text comparison and the verbatim
    // header attestation are both exercised here.
    const addendum = collectAttributeAddendumSources();
    const latin1 = reconstructionResultFor(loadByEntry(addendum, 'ofcom-756622--published-register-csv'));
    expect(latin1.detail ?? '').toBe('');
    expect(latin1.ok).toBe(true);
    // The wdtk sheets are UTF-8 with a BOM and CRLF endings - the cosmetic axes.
    const bomSheet = reconstructionResultFor(loadByEntry(addendum, 'wdtk-1180568--licence-breakdown-duration-age', 'sheet-1'));
    expect(bomSheet.detail ?? '').toBe('');
    expect(bomSheet.ok).toBe(true);
  });

  it('EveryCoveredCsvSource_WhenReconstructed_PassesTheCommittedOracle', () => {
    // The committed corpus gate: every source across the three CSV families
    // round-trips, or the build fails loud with the offending source's diff.
    const sources = collectCsvReconstructionSources().map(resolved => resolved.load());
    expect(sources.length).toBeGreaterThan(0);
    const results = assertReconstruction(sources);
    expect(results.every(result => result.ok)).toBe(true);
  });
});

// ---- Honest non-coverage (Phase 3 shapes) -----------------------------------

describe('the oracle reports not-yet-covered shapes explicitly', () => {
  it('CoveredFamilies_WhenListed_AreExactlyTheThreeCsvLanes', () => {
    expect([...COVERED_FAMILIES].sort()).toEqual(['attribute-addendum', 'foi-register', 'open-data-register']);
  });

  it('MarkdownTableAndPreambleAndPrefixedSources_WhenEnumerated_AreFlaggedNotYetCovered', () => {
    // These shapes emit NO claims today, so they cannot be reconstructed. The
    // oracle surfaces them as explicit non-coverage (never a silent pass),
    // pending the ingest work (issue #434 Phase 3 / E3).
    const uncovered = listNotYetCovered();
    expect(uncovered.length).toBeGreaterThan(0);
    for (const item of uncovered) {
      expect(['markdown-table', 'preamble', 'prefixed-callsign']).toContain(item.shape);
      expect(item.reason).toMatch(/#434/);
    }
    // The known markdown-table transcription is among them.
    expect(uncovered.some(item => item.shape === 'markdown-table')).toBe(true);
  });
});
