import { describe, it, expect } from 'vitest';
import {
  canonicaliseCsvText,
  canonicaliseMarkdownTable,
  reconstructCsvFromClaims,
  reconstructMarkdownTableFromClaims,
  reconstructionResultFor,
  collectCsvReconstructionSources,
  collectReconstructionSources,
  listNotYetCovered,
  COVERED_FAMILIES,
  CSV_SERIALISED_FAMILIES,
  MARKDOWN_PROSE_SCOPE_NOTE,
} from './reconstruction-oracle.ts';
import {
  emitClaims,
  emitFileManifestClaims,
  isFileLevelClaim,
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
import { collectFoiVerbatimCsvSources } from '../v2/collectors/foi-verbatim-csv.ts';
import { collectFoiMarkdownTableSources } from '../v2/collectors/foi-markdown-table.ts';
import type { ResolvedLedgerSource } from '../v2/collectors/types.ts';

// CI parallelism (#478): the full-corpus reconstruction gates are embarrassingly
// parallel - every source round-trips independently, no cross-source sequencing.
// When RECON_SHARD="i/N" is set (CI fans the gate across N jobs), a gate
// reconstructs only its 1/N slice, chosen by index modulo N so every source lands
// in exactly ONE shard and the union across shards is the whole corpus. Unset
// (local / single run) reconstructs everything. Slicing the RESOLVED sources
// BEFORE .load() means each shard also parses only its slice - the load/parse is
// where much of the (v8-coverage-heavy) cost lives. An empty slice is a valid
// no-op (a shard count above the source count just leaves some shards idle).
function shardResolved(resolved: readonly ResolvedLedgerSource[]): ResolvedLedgerSource[] {
  const spec = process.env.RECON_SHARD;
  if (spec === undefined || spec.trim() === '') return [...resolved];
  const [i, n] = spec.split('/').map(Number);
  if (!Number.isInteger(i) || !Number.isInteger(n) || i < 1 || n < 1 || i > n) {
    throw new Error(`RECON_SHARD must be "i/N" with 1 <= i <= N, got "${spec}"`);
  }
  return resolved.filter((_, idx) => idx % n === i - 1);
}

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

  // The corpus gates as PER-SOURCE cases (it.each over a runtime-generated list):
  // each source round-trips independently, so the report names exactly which
  // file(s) fail rather than one aggregate assertion, and the cases shard across
  // CI jobs (RECON_SHARD, see shardResolved). Completeness is asserted unsliced.
  const csvAll = collectCsvReconstructionSources();
  const fullAll = collectReconstructionSources();
  const csvShard = shardResolved(csvAll);
  const fullShard = shardResolved(fullAll);
  // Observability: on a sharded run, record which slice this job carries.
  process.stderr.write(
    `[recon] shard ${process.env.RECON_SHARD ?? 'all'}: committed-CSV ${csvShard.length}/${csvAll.length}, ` +
      `full-corpus ${fullShard.length}/${fullAll.length} source(s) this run\n`,
  );

  it('TheCommittedCsvCorpus_IsNonEmpty', () => {
    expect(csvAll.length).toBeGreaterThan(0);
  });

  it('TheFullCorpus_SpansMoreThanTheCsvLanes', () => {
    expect(fullAll.length).toBeGreaterThan(csvAll.length);
  });

  it.each(csvShard)(
    'committed CSV corpus: $family/$jsonlStem reconstructs byte-identically modulo cosmetics',
    (resolved) => {
      const result = reconstructionResultFor(resolved.load());
      expect(result.ok, result.detail).toBe(true);
    },
  );

  it.each(fullShard)(
    'full corpus: $family/$jsonlStem reconstructs byte-identically modulo cosmetics',
    (resolved) => {
      const result = reconstructionResultFor(resolved.load());
      expect(result.ok, result.detail).toBe(true);
    },
  );
});

// ---- Phase 3 shapes: verbatim-CSV (preamble / prefixed) round-trip ----------

describe('FOI preamble and prefixed CSV sheets reconstruct from claims (issue #434 E3)', () => {
  it('PrefixedSuffixList_WhenReconstructedFromClaims_MatchesOriginalWithRawSuffixAsSubject', () => {
    // A 2013-style suffix list: a single-column CSV whose header is the sheet's
    // own 'Foundation = M6aaa' label and whose rows are bare suffixes. The raw
    // SUFFIX is the subject (design E3), never the synthesised M6 call sign, and
    // the file rebuilds byte-identically modulo cosmetics.
    const source = collectFoiVerbatimCsvSources()
      .map(resolved => resolved.load())
      .find(s => s.repoPath === 'archive/foi/wdtk-174341--available-callsigns-list/raw-extract-sheet-1-foundation.csv');
    expect(source).toBeDefined();
    if (source === undefined) return;
    expect(source.columns).toEqual(['Foundation = M6aaa']);
    expect(source.subjectColumn).toBe('Foundation = M6aaa');
    // The stored subject tokens are bare suffixes, not prefixed call signs.
    expect(source.rows[0]['Foundation = M6aaa']).not.toMatch(/^M6/);
    const result = reconstructionResultFor(source);
    expect(result.detail ?? '').toBe('');
    expect(result.ok).toBe(true);
  });

  it('PreambleSheet_WhenReconstructedFromClaims_ReinstatesThePreambleBeforeTheHeader', () => {
    // A pre-header preamble (wdtk-224333 foundation: an empty first row then a
    // 'Prefix = M6' statement, then the 'Suffix' header) must reappear ABOVE the
    // header - the positional furniture reinstatement, not an end-of-file append.
    const source = collectFoiVerbatimCsvSources()
      .map(resolved => resolved.load())
      .find(s => s.repoPath === 'archive/foi/wdtk-224333--available-callsigns-list/raw-extract-sheet-1-foundation.csv');
    expect(source).toBeDefined();
    if (source === undefined) return;
    expect(source.headerLine).toBe(3);
    expect((source.ignoredLines ?? []).map(l => l.line)).toEqual([1, 2]);
    const rebuilt = reconstructCsvFromClaims([...emitClaims(source), ...emitFileManifestClaims(source)]);
    const lines = rebuilt.split('\n');
    // The 'Prefix = M6' preamble line sits before the 'Suffix' header line.
    expect(lines.indexOf('Prefix = M6')).toBeLessThan(lines.indexOf('Suffix'));
    const result = reconstructionResultFor(source);
    expect(result.detail ?? '').toBe('');
    expect(result.ok).toBe(true);
  });

  it('PrewarAnnexTwoColumnSheet_WhenReconstructedFromClaims_MatchesOriginalModuloCosmetics', () => {
    // The pre-war annex sheet 1 (wdtk-238892): a two-column sheet whose preamble
    // carries an embedded-quote, embedded-comma title cell - exercising verbatim
    // cell fidelity through the furniture path and duplicate-callsign rows kept
    // distinct by ordinal.
    const source = collectFoiVerbatimCsvSources()
      .map(resolved => resolved.load())
      .find(s => s.repoPath === 'archive/foi/wdtk-238892--out-of-sequence-callsigns/raw-extract-sheet-1-callsigns.csv');
    expect(source).toBeDefined();
    if (source === undefined) return;
    expect(source.columns).toEqual(['Call Sign', 'Original Start Date']);
    const result = reconstructionResultFor(source);
    expect(result.detail ?? '').toBe('');
    expect(result.ok).toBe(true);
  });

  it('VerbatimCsvClaims_WhenEmitted_CarryNoPhantomObservationAtTheSentinel', () => {
    // Non-pollution: the manifest's file-level claims ride the sentinel ordinal,
    // the per-row claims the gap-free 0..n-1 range, so the two streams never
    // collide when a Phase 3 source joins the ledger.
    const source = collectFoiVerbatimCsvSources()
      .map(resolved => resolved.load())
      .find(s => s.repoPath === 'archive/foi/wdtk-238892--out-of-sequence-callsigns/raw-extract-sheet-2-database-fields.csv');
    expect(source).toBeDefined();
    if (source === undefined) return;
    const perRow = emitClaims(source);
    expect(perRow.some(isFileLevelClaim)).toBe(false);
    expect(perRow.every(c => c.provenance.ordinal >= 0)).toBe(true);
    const listed = perRow.filter(c => c.predicate === LISTED_PREDICATE);
    // One existence claim per data row - the row count is exactly the observations.
    expect(listed.length).toBe(source.rows.length);
  });
});

// ---- Phase 3 shapes: markdown-table (table region only) round-trip ----------

describe('FOI markdown-table transcriptions reconstruct their table region (issue #434 E3/E4)', () => {
  it('MarkdownTableSource_WhenReconstructedFromClaims_MatchesTableRegionModuloPadding', () => {
    // The counts table (wdtk-184767): right-aligned separator (|---:|) and
    // padded cells in the original; the reconstruction compares the canonical
    // table region only, so alignment and dash-count are ignored while every
    // cell value (thousands separators, en-dashes) must match.
    const source = collectFoiMarkdownTableSources()
      .map(resolved => resolved.load())
      .find(s => s.repoPath?.endsWith('raw-extract-number-of-licences-coleman.md') === true);
    expect(source).toBeDefined();
    if (source === undefined) return;
    const result = reconstructionResultFor(source);
    expect(result.detail ?? '').toBe('');
    expect(result.ok).toBe(true);
    // The prose exclusion is declared on the result, not silently applied.
    expect(result.scopeNote).toBe(MARKDOWN_PROSE_SCOPE_NOTE);
  });

  it('MarkdownTableSource_WhenTranscriptionCarriesWithheldColumns_ReconstructsEveryColumn', () => {
    // The transfers table (wdtk-251507) carries s.40-withheld name columns the
    // issuance-events dataset drops. The faithful mirror keeps ALL ten columns,
    // so the whole table region round-trips.
    const source = collectFoiMarkdownTableSources()
      .map(resolved => resolved.load())
      .find(s => s.repoPath?.endsWith('raw-extract-applicants-old-call-signs.md') === true);
    expect(source).toBeDefined();
    if (source === undefined) return;
    expect(source.columns).toContain('Title');
    expect(source.columns).toContain('Call Signs');
    const result = reconstructionResultFor(source);
    expect(result.detail ?? '').toBe('');
    expect(result.ok).toBe(true);
  });

  it('MarkdownTableCanonicaliser_WhenGivenTableDifferingOnlyByPaddingAndAlignment_CanonicaliseEqual', () => {
    // The declared markdown cosmetic axes (§4.5): cell padding, column alignment
    // markers, and separator dash-count are ignored; a cell value is not.
    const padded = '# Title\n\nprose\n\n| A | Long Header |\n|:---|---:|\n| x | 1 |\n\nmore prose\n';
    const tight = '| A | Long Header |\n| --- | --- |\n| x | 1 |\n';
    expect(canonicaliseMarkdownTable(padded, 'padded.md')).toBe(canonicaliseMarkdownTable(tight, 'tight.md'));
    // A changed cell value diverges.
    const changed = '| A | Long Header |\n| --- | --- |\n| y | 1 |\n';
    expect(canonicaliseMarkdownTable(tight, 't.md')).not.toBe(canonicaliseMarkdownTable(changed, 'c.md'));
  });

  it('MarkdownReconstruction_WhenBuiltFromClaims_EqualsTheCanonicalisedOriginalTableRegion', () => {
    // The round-trip proved at the function level: reconstructing from the claim
    // stream yields exactly the canonicalised table region of the original file.
    const source = collectFoiMarkdownTableSources()
      .map(resolved => resolved.load())
      .find(s => s.repoPath?.endsWith('raw-extract-number-of-licences-coleman.md') === true);
    expect(source).toBeDefined();
    if (source === undefined) return;
    const claims = [...emitClaims(source), ...emitFileManifestClaims(source)];
    const reconstruction = reconstructMarkdownTableFromClaims(claims);
    expect(reconstruction.startsWith('| period (1 April')).toBe(true);
    // The reconstruction is already canonical, so re-canonicalising is a no-op -
    // idempotence confirms the two renderers agree.
    expect(canonicaliseMarkdownTable(reconstruction, source.sourceFile)).toBe(reconstruction);
  });
});

// ---- Coverage bookkeeping ---------------------------------------------------

describe('the oracle declares its coverage and any residual gaps explicitly', () => {
  it('CoveredFamilies_WhenListed_AreTheThreeCsvLanesPlusTheTwoPhase3Mirrors', () => {
    expect([...COVERED_FAMILIES].sort()).toEqual([
      'attribute-addendum', 'foi-markdown-table', 'foi-register', 'foi-verbatim-csv', 'open-data-register',
    ]);
    // The markdown mirror is the only family NOT reconstructed through the CSV
    // serialiser.
    expect([...CSV_SERIALISED_FAMILIES].sort()).toEqual([
      'attribute-addendum', 'foi-register', 'foi-verbatim-csv', 'open-data-register',
    ]);
  });

  it('EveryPhase3TextShape_WhenCrossChecked_IsIngestedByAReconstructionMirror', () => {
    // E3 landed every markdown-table, preamble and prefixed shape into a mirror,
    // so the honest non-coverage list is now EMPTY - the coverage guarantee. A
    // future shape that slipped both mirrors would resurface here.
    expect(listNotYetCovered()).toEqual([]);
  });
});
