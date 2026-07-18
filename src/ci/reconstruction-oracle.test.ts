import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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
import { buildLedger } from '../v2/build-ledger.ts';
import { parseClaimsJsonl } from '../v2/serialise.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';
import { defaultFoiDir } from '../shared/foi-archive.ts';
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
import { collectAvailablePoolSources } from '../v2/collectors/available-pool.ts';
import { collectFoiVerbatimCsvSources } from '../v2/collectors/foi-verbatim-csv.ts';
import { collectStatisticsSources } from '../v2/collectors/statistics.ts';
import { collectIssuanceEventsSources } from '../v2/collectors/issuance-events.ts';
import { collectForbiddenListSources } from '../v2/collectors/forbidden-list.ts';
import { COLLECTORS } from '../v2/collectors/index.ts';
import type { ResolvedLedgerSource } from '../v2/collectors/types.ts';

// The repo root, two levels up from src/ci/ (as the oracle module resolves it),
// so a source's repo-relative repoPath resolves to the real archived file.
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

// CI parallelism (#478; full rationale + mental model in src/testing/CI-SHARDING.md
// - read it before changing the shard setup, esp. why the parallelism lives at the
// CI-job level, not the test-case level). The full-corpus reconstruction gates are
// embarrassingly parallel - every source round-trips independently, no cross-source
// sequencing.
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

describe('the cosmetic normaliser ignores exactly the declared axes', { tags: ['unit'] }, () => {
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

describe('a source reconstructs from its claim stream alone', { tags: ['unit'] }, () => {
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

describe('CSV-lane sources reconstruct byte-identically modulo cosmetics from the real archive', { tags: ['data-validity'] }, () => {
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

// ---- Canonicity: reconstruct straight off the PERSISTED ledger (issue #455) --

describe('a source reconstructs from the ledger a build actually persists', { tags: ['data-validity'] }, () => {
  it('FoiRegisterSource_WhenReconstructedFromThePersistedLedgerJsonl_MatchesTheOriginalModuloCosmetics', () => {
    // The load-bearing #455 claim: the MAIN ledger a build writes carries the
    // whole source structure, so a reader rebuilds the original publication from
    // the ledger ALONE - not from a parallel oracle-only projection. Emit the
    // real ledger for one FOI-register entry, then reconstruct straight off the
    // JSONL file on disk (parsed through the ledger's own parser), and prove the
    // file-level manifest genuinely rode that persisted ledger.
    const entry = 'ofcom-01420046--allocated-reserved-callsigns';
    const source = loadByEntry(collectFoiRegisterSources(), entry);
    expect(source.repoPath).toBeDefined();
    const repoPath = source.repoPath;
    if (repoPath === undefined) return;

    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'recon-from-ledger-'));
    try {
      buildLedger(scratch, defaultFoiDir(), loadReferenceData(), key => key === entry);
      const ledgerDir = path.join(scratch, 'ledger');
      const files = fs.readdirSync(ledgerDir).filter(name => name.endsWith('.jsonl'));

      let reconstruction: string | undefined;
      for (const file of files) {
        const claims = parseClaimsJsonl(fs.readFileSync(path.join(ledgerDir, file), 'utf8'));
        if (claims[0]?.provenance.sourceFile !== source.sourceFile) continue;
        // The manifest rode the persisted ledger: its @subject and @column
        // file-level claims are on disk, so the header/subject placement is read
        // from the ledger, never re-derived from the loader.
        expect(claims.some(c => isFileLevelClaim(c) && c.predicate === SUBJECT_PREDICATE)).toBe(true);
        expect(claims.some(c => isFileLevelClaim(c) && c.predicate === columnPredicate(0))).toBe(true);
        reconstruction = reconstructCsvFromClaims(claims);
      }
      expect(reconstruction).toBeDefined();
      if (reconstruction === undefined) return;

      const original = fs.readFileSync(path.join(REPO_ROOT, repoPath)).toString(source.encoding ?? 'utf8');
      expect(canonicaliseCsvText(reconstruction)).toBe(canonicaliseCsvText(original));
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('PrewarAnnexSheets_WhenReconstructedFromThePersistedLedgerJsonl_MatchTheOriginalsModuloCosmetics', () => {
    // The Stage B canonicity claim (issue #813): the annex sheets were
    // previously covered only via the oracle's own in-memory stream; now the
    // family is REGISTERED, the ledger a build persists must carry their whole
    // structure - including sheet 2's EMPTY-STRING first header, which must
    // survive the JSONL serialiser round-trip as a genuine empty @column/0
    // object, and sheet 1's preamble title as positioned @ignored furniture.
    const entry = 'wdtk-238892--out-of-sequence-callsigns';
    const sources = collectFoiVerbatimCsvSources().filter(resolved => resolved.entry === entry).map(resolved => resolved.load());
    expect(sources).toHaveLength(2);

    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'recon-annex-ledger-'));
    try {
      buildLedger(scratch, defaultFoiDir(), loadReferenceData(), key => key === entry);
      const ledgerDir = path.join(scratch, 'ledger');
      const files = fs.readdirSync(ledgerDir).filter(name => name.endsWith('.jsonl'));
      expect(files).toHaveLength(2);

      for (const source of sources) {
        const persisted = files
          .map(file => parseClaimsJsonl(fs.readFileSync(path.join(ledgerDir, file), 'utf8')))
          .find(claims => claims[0]?.provenance.sourceFile === source.sourceFile);
        expect(persisted, `no persisted ledger for ${source.sourceFile}`).toBeDefined();
        if (persisted === undefined) continue;
        // The registered emit is raw-only for a 'token' subject: the persisted
        // stream carries NO derived claims of any kind.
        expect(persisted.every(c => c.layer === 'raw')).toBe(true);
        // The manifest rode the persisted ledger - sheet 2's first header is
        // the EMPTY STRING and must read back as exactly that, not a dropped
        // or undefined key.
        const columnZero = persisted.find(c => isFileLevelClaim(c) && c.predicate === columnPredicate(0));
        expect(columnZero).toBeDefined();
        if (source.sourceFile.endsWith('raw-extract-sheet-2-database-fields.csv')) {
          expect(columnZero?.object).toBe('');
        }
        const reconstruction = reconstructCsvFromClaims(persisted);
        const repoPath = source.repoPath;
        expect(repoPath).toBeDefined();
        if (repoPath === undefined) continue;
        const original = fs.readFileSync(path.join(REPO_ROOT, repoPath)).toString(source.encoding ?? 'utf8');
        expect(canonicaliseCsvText(reconstruction)).toBe(canonicaliseCsvText(original));
      }
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});

// ---- Phase 3 shapes: available-pool (registered, lossless-canonical) and the
// ---- verbatim-CSV mirror round-trip ----------------------------------------

describe('available-pool sources reconstruct from their REGISTERED claims (issue #813 Stage A)', { tags: ['data-validity'] }, () => {
  it('PrefixedSuffixList_WhenReconstructedFromClaims_MatchesOriginalWithRawSuffixAsSubject', () => {
    // A 2013-style suffix list: a single-column CSV whose header is the sheet's
    // own 'Foundation = M6aaa' label and whose rows are bare suffixes. The raw
    // SUFFIX is the subject (design E3), never the synthesised M6 call sign, and
    // the file rebuilds byte-identically modulo cosmetics - from the
    // available-pool family's own registered emit, not a parallel mirror.
    const source = collectAvailablePoolSources()
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
    const source = collectAvailablePoolSources()
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

  it('TypedExportSheet_WhenReconstructedFromClaims_MatchesOriginalWithTheValueColumnAsSubject', () => {
    // A 2015 typed Siebel export: eight physical columns, the authored Value
    // column (a full call sign) as the subject - NOT the first physical column
    // (Country) - so the manifest, not position, places the subject on rebuild.
    // Newly reconstruction-covered by Stage A: the family's old role-vocabulary
    // emit could not rebuild this file at all.
    const source = collectAvailablePoolSources()
      .map(resolved => resolved.load())
      .find(s => s.repoPath === 'archive/foi/wdtk-247308--available-callsigns-list/raw-extract-sheet-1-foundation.csv');
    expect(source).toBeDefined();
    if (source === undefined) return;
    expect(source.columns.length).toBe(8);
    expect(source.subjectColumn).toBe('Value');
    expect(source.columns[0]).not.toBe('Value');
    const result = reconstructionResultFor(source);
    expect(result.detail ?? '').toBe('');
    expect(result.ok).toBe(true);
  });

  it('AvailablePoolSources_WhenResolvedForTheOracle_AppearInExactlyOneFamily', () => {
    // The structural no-double-count invariant (issue #813 Stage A): the
    // verbatim-CSV mirror no longer resolves any available-pool source, so each
    // reconstructs from exactly one family's claims - the registered one.
    const poolRepoPaths = new Set(
      collectAvailablePoolSources().map(resolved => resolved.load().repoPath ?? ''),
    );
    expect(poolRepoPaths.size).toBe(25);
    for (const resolved of collectFoiVerbatimCsvSources()) {
      const mirrored = resolved.load().repoPath ?? '';
      expect(poolRepoPaths.has(mirrored), `${mirrored} mirrored twice`).toBe(false);
    }
  });
});

describe('the pre-war annex reconstructs from its REGISTERED claims (issue #813 Stage B)', { tags: ['data-validity'] }, () => {

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

describe('FOI markdown-table transcriptions reconstruct their table region (issue #434 E3/E4)', { tags: ['data-validity'] }, () => {
  it('StatisticsCountsTable_WhenReconstructedFromItsRegisteredClaims_MatchesTableRegionModuloPadding', () => {
    // The counts table (wdtk-184767): right-aligned separator (|---:|) and
    // padded cells in the original; the reconstruction compares the canonical
    // table region only, so alignment and dash-count are ignored while every
    // cell value (thousands separators, en-dashes) must match. Since issue
    // #813 Stage C1 the source is the REGISTERED statistics-aggregate family's
    // own verbatim emit, not the retired mirror coverage.
    const source = collectStatisticsSources()
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

  it('MarkdownSources_WhenResolvedAcrossTheRegistry_AreEmittedByExactlyOneFamilyEach', () => {
    // The structural no-double-count invariant (issue #813 Stages C1/C2/D):
    // every markdown-table extract reconstructs from exactly one family's
    // claims - its REGISTERED analytical owner (statistics-aggregate for the
    // counts table, issuance-events for the transfers table); the oracle-only
    // markdown mirror is deleted. Asserted over the registry's declared source
    // keys, the same keys buildLedger's emit-time sole-emitter check guards.
    const markdownKeys = collectReconstructionSources()
      .filter(source => source.sourceFile.toLowerCase().endsWith('.md'))
      .map(source => source.sourceFile)
      .sort();
    expect(markdownKeys).toEqual([
      'foi/wdtk-184767--annual-licence-counts/raw-extract-number-of-licences-coleman.md',
      'foi/wdtk-251507--reissue-policy/raw-extract-applicants-old-call-signs.md',
    ]);
  });

  it('TransfersTable_WhenTranscriptionCarriesWithheldColumns_ReconstructsEveryColumn', () => {
    // The transfers table (wdtk-251507) carries s.40-withheld name columns the
    // old issuance-events projection dropped. The lossless-canonical family
    // emit (issue #813 Stage C2) keeps ALL ten columns - the 'S40' marker cells
    // are published bytes - so the whole table region round-trips from the
    // REGISTERED family's own claims.
    const source = collectIssuanceEventsSources()
      .map(resolved => resolved.load())
      .find(s => s.repoPath?.endsWith('raw-extract-applicants-old-call-signs.md') === true);
    expect(source).toBeDefined();
    if (source === undefined) return;
    expect(source.columns).toContain('Title');
    expect(source.columns).toContain('Call Signs');
    expect(source.subjectColumn).toBe('Call Signs');
    const result = reconstructionResultFor(source);
    expect(result.detail ?? '').toBe('');
    expect(result.ok).toBe(true);
    expect(result.scopeNote).toBe(MARKDOWN_PROSE_SCOPE_NOTE);
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
    // stream yields exactly the canonicalised table region of the original file
    // - under the table's VERBATIM period header (issue #813 Stage C1), the
    // registered family's own emit.
    const source = collectStatisticsSources()
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

  it('StatisticsCountsTable_WhenReconstructedFromThePersistedLedgerJsonl_MatchesTheOriginalTableRegion', () => {
    // The Stage C1 canonicity claim (issue #813): the counts table was
    // previously covered only via the mirror's oracle-only stream; now the
    // statistics-aggregate family emits it losslessly, the ledger a build
    // PERSISTS must carry the whole table region - the manifest presenting the
    // VERBATIM published headers (the '(1 April – 31 March)' boundary
    // qualifier intact, 'Amateur Radio'/'Business Radio' as published), never
    // the authored output names the old emit mis-presented As-published.
    const entry = 'wdtk-184767--annual-licence-counts';
    const sources = collectStatisticsSources().filter(resolved => resolved.entry === entry).map(resolved => resolved.load());
    expect(sources).toHaveLength(1);
    const source = sources[0];

    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'recon-statistics-ledger-'));
    try {
      buildLedger(scratch, defaultFoiDir(), loadReferenceData(), key => key === entry);
      const ledgerDir = path.join(scratch, 'ledger');
      const files = fs.readdirSync(ledgerDir).filter(name => name.endsWith('.jsonl'));
      expect(files).toHaveLength(1);
      const persisted = parseClaimsJsonl(fs.readFileSync(path.join(ledgerDir, files[0]), 'utf8'));
      expect(persisted[0]?.provenance.sourceFile).toBe(source.sourceFile);

      // The registered emit is raw-only for an 'aggregate' subject: the
      // persisted stream carries NO derived claims (the #824/#830 edge gate
      // reads this as emits_edges = 0 - a period never gains a normalisation
      // edge).
      expect(persisted.every(c => c.layer === 'raw')).toBe(true);
      expect(persisted.some(c => c.predicate === NORMALISES_TO_PREDICATE)).toBe(false);

      // The manifest rode the persisted ledger with the verbatim spellings.
      const manifest = persisted.filter(isFileLevelClaim);
      expect(manifest.find(c => c.predicate === SUBJECT_PREDICATE)?.object).toBe('period (1 April – 31 March)');
      expect(manifest.find(c => c.predicate === columnPredicate(0))?.object).toBe('period (1 April – 31 March)');
      expect(manifest.find(c => c.predicate === columnPredicate(1))?.object).toBe('Amateur Radio');
      expect(manifest.find(c => c.predicate === columnPredicate(2))?.object).toBe('Business Radio');

      // And the table region rebuilds from the persisted claims alone, equal to
      // the canonicalised original extract.
      const reconstruction = reconstructMarkdownTableFromClaims(persisted);
      const repoPath = source.repoPath;
      expect(repoPath).toBeDefined();
      if (repoPath === undefined) return;
      const original = fs.readFileSync(path.join(REPO_ROOT, repoPath)).toString(source.encoding ?? 'utf8');
      expect(reconstruction).toBe(canonicaliseMarkdownTable(original, source.sourceFile));
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('TransfersTable_WhenReconstructedFromThePersistedLedgerJsonl_MatchesTheOriginalTableRegion', () => {
    // The Stage C2 canonicity claim (issue #813): the transfers table was
    // previously covered only via the mirror's oracle-only stream; now the
    // issuance-events family emits it losslessly, the ledger a build PERSISTS
    // must carry the whole table region - the manifest presenting all TEN
    // verbatim published headers (the three s.40-withheld name columns
    // included) with the raw callsign header as the subject, the authored
    // event word riding as a DERIVED claim under its named rule, and NO raw
    // claim presenting an authored spelling As-published.
    const entry = 'wdtk-251507--reissue-policy';
    const sources = collectIssuanceEventsSources().filter(resolved => resolved.entry === entry).map(resolved => resolved.load());
    expect(sources).toHaveLength(1);
    const source = sources[0];

    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'recon-transfers-ledger-'));
    try {
      buildLedger(scratch, defaultFoiDir(), loadReferenceData(), key => key === entry);
      const ledgerDir = path.join(scratch, 'ledger');
      const files = fs.readdirSync(ledgerDir).filter(name => name.endsWith('.jsonl'));
      expect(files).toHaveLength(1);
      const persisted = parseClaimsJsonl(fs.readFileSync(path.join(ledgerDir, files[0]), 'utf8'));
      expect(persisted[0]?.provenance.sourceFile).toBe(source.sourceFile);

      // The manifest rode the persisted ledger with the verbatim spellings -
      // the published header order, 'S40' marker columns included.
      const manifest = persisted.filter(isFileLevelClaim);
      expect(manifest.find(c => c.predicate === SUBJECT_PREDICATE)?.object).toBe('Call Signs');
      const headerObjects = [...Array(10).keys()].map(index =>
        manifest.find(c => c.predicate === columnPredicate(index))?.object);
      expect(headerObjects).toEqual([
        'Con Id', 'Licence Number', 'Call Signs', 'Licence Product', 'Status',
        'Title', 'First_name', 'Last_name', 'Start date', 'Reason',
      ]);

      // The authored event word is DERIVED (Looked-up), never As-published: no
      // raw claim carries the 'event' predicate or the 'reallocated' object,
      // while every observation carries exactly one derived event claim.
      expect(persisted.some(c => c.layer === 'raw' && (c.predicate === 'event' || c.object === 'reallocated'))).toBe(false);
      const eventClaims = persisted.filter(c => c.layer === 'derived' && c.predicate === 'event');
      expect(eventClaims.length).toBe(source.rows.length);
      expect(eventClaims.every(c => c.rule === 'authored-event-vocabulary' && c.object === 'reallocated')).toBe(true);

      // A callsign subject: the derived normalisation edges ride the persisted
      // stream too (the #830 edge gate reads emits_edges = 1).
      expect(persisted.some(c => c.predicate === NORMALISES_TO_PREDICATE && c.rule === CLEANED_CALLSIGN_RULE)).toBe(true);

      // And the table region rebuilds from the persisted claims alone, equal
      // to the canonicalised original extract (derived claims ignored).
      const reconstruction = reconstructMarkdownTableFromClaims(persisted);
      const repoPath = source.repoPath;
      expect(repoPath).toBeDefined();
      if (repoPath === undefined) return;
      const original = fs.readFileSync(path.join(REPO_ROOT, repoPath)).toString(source.encoding ?? 'utf8');
      expect(reconstruction).toBe(canonicaliseMarkdownTable(original, source.sourceFile));
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('IssuanceCsvExport_WhenReconstructedFromThePersistedLedgerJsonl_MatchesTheOriginalModuloCosmetics', () => {
    // The Stage C2 canonicity claim for the CSV lane (issue #813): the two
    // ofcom event exports had NO reconstruction path at all (a silent gap -
    // not an E3 shape, invisible to listNotYetCovered). Now the family emits
    // them losslessly with attested line numbers, the persisted ledger must
    // rebuild the file byte-identically modulo cosmetics, under the verbatim
    // headers ('Original Start Date','Call Sign T-Number') with the callsign
    // header as the manifest-placed subject (NOT column 0).
    const entry = 'ofcom-498903--reissued-callsigns-since-2010';
    const sources = collectIssuanceEventsSources().filter(resolved => resolved.entry === entry).map(resolved => resolved.load());
    expect(sources).toHaveLength(1);
    const source = sources[0];
    expect(source.columns).toEqual(['Original Start Date', 'Call Sign T-Number']);
    expect(source.subjectColumn).toBe('Call Sign T-Number');

    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'recon-issuance-csv-ledger-'));
    try {
      buildLedger(scratch, defaultFoiDir(), loadReferenceData(), key => key === entry);
      const ledgerDir = path.join(scratch, 'ledger');
      const files = fs.readdirSync(ledgerDir).filter(name => name.endsWith('.jsonl'));
      expect(files).toHaveLength(1);
      const persisted = parseClaimsJsonl(fs.readFileSync(path.join(ledgerDir, files[0]), 'utf8'));
      expect(persisted[0]?.provenance.sourceFile).toBe(source.sourceFile);

      // No raw claim presents the authored vocabulary; the event word is a
      // derived claim per observation.
      expect(persisted.some(c => c.layer === 'raw' && (c.predicate === 'event' || c.predicate === 'event_date'))).toBe(false);
      const eventClaims = persisted.filter(c => c.layer === 'derived' && c.predicate === 'event');
      expect(eventClaims.length).toBe(source.rows.length);
      expect(eventClaims.every(c => c.rule === 'authored-event-vocabulary' && c.object === 'reissued')).toBe(true);

      const reconstruction = reconstructCsvFromClaims(persisted);
      const repoPath = source.repoPath;
      expect(repoPath).toBeDefined();
      if (repoPath === undefined) return;
      const original = fs.readFileSync(path.join(REPO_ROOT, repoPath)).toString(source.encoding ?? 'utf8');
      expect(canonicaliseCsvText(reconstruction)).toBe(canonicaliseCsvText(original));
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('ForbiddenSheetWithConstantTypeColumn_WhenReconstructedFromThePersistedLedgerJsonl_MatchesTheOriginal', () => {
    // The Stage D losslessness claim (issue #813, D-4): the wdtk-356636
    // forbidden sheet's constant 'Type' column ('Forbidden' on every row) is a
    // published byte the old emit did not carry, so the sheet could not
    // round-trip. The lossless forbidden emit carries it as raw claims, and
    // the sheet rebuilds byte-identically modulo cosmetics from the ledger a
    // build persists - with the 'Value' suffix column as the manifest-placed
    // subject and zero derived claims (a suffix stays edge-free).
    const entry = 'wdtk-356636--all-callsigns-plus-forbidden';
    const sources = collectForbiddenListSources().filter(resolved => resolved.entry === entry).map(resolved => resolved.load());
    expect(sources).toHaveLength(1);
    const source = sources[0];
    expect(source.columns).toEqual(['Value', 'Type']);
    expect(source.subjectColumn).toBe('Value');

    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'recon-forbidden-ledger-'));
    try {
      buildLedger(scratch, defaultFoiDir(), loadReferenceData(), key => key === entry);
      const ledgerDir = path.join(scratch, 'ledger');
      // The container entry also emits its register sheet (the foi-register
      // family's); the forbidden family's own stream is the one under test.
      const files = fs.readdirSync(ledgerDir).filter(name => name.startsWith('forbidden-') && name.endsWith('.jsonl'));
      expect(files).toHaveLength(1);
      const persisted = parseClaimsJsonl(fs.readFileSync(path.join(ledgerDir, files[0]), 'utf8'));
      expect(persisted[0]?.provenance.sourceFile).toBe(source.sourceFile);

      // Raw-only (a suffix subject derives nothing), with the Type cells
      // present as raw claims and both columns in the manifest.
      expect(persisted.every(c => c.layer === 'raw')).toBe(true);
      const manifest = persisted.filter(isFileLevelClaim);
      expect(manifest.find(c => c.predicate === SUBJECT_PREDICATE)?.object).toBe('Value');
      expect(manifest.find(c => c.predicate === columnPredicate(1))?.object).toBe('Type');
      const typeClaims = persisted.filter(c => !isFileLevelClaim(c) && c.predicate === 'Type');
      expect(typeClaims.length).toBe(source.rows.length);
      expect(typeClaims.every(c => c.object === 'Forbidden')).toBe(true);

      const reconstruction = reconstructCsvFromClaims(persisted);
      const repoPath = source.repoPath;
      expect(repoPath).toBeDefined();
      if (repoPath === undefined) return;
      const original = fs.readFileSync(path.join(REPO_ROOT, repoPath)).toString(source.encoding ?? 'utf8');
      expect(canonicaliseCsvText(reconstruction)).toBe(canonicaliseCsvText(original));
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});

// ---- Coverage bookkeeping ---------------------------------------------------

describe('the oracle declares its coverage and any residual gaps explicitly', { tags: ['unit'] }, () => {
  it('CoveredFamilies_WhenListed_AreIdenticallyTheCollectorRegistry', () => {
    // Structural coverage (issue #813 Stage D): the reconstruction corpus IS
    // the registry - COVERED_FAMILIES is derived from COLLECTORS, so a newly
    // registered family cannot exist outside the oracle's scope, and the old
    // hand-maintained list (with its oracle-only mirror families) is gone.
    expect(COVERED_FAMILIES).toEqual(COLLECTORS.map(collector => collector.family));
    expect([...COVERED_FAMILIES].sort()).toEqual([
      'attribute-addendum', 'available-pool', 'foi-register', 'foi-verbatim-csv', 'forbidden-list', 'issuance-events', 'open-data-register', 'statistics-aggregate',
    ]);
    // The statistics-aggregate family holds a markdown-table extract only; the
    // issuance-events family routes per source (two CSV exports, one markdown
    // table) by its .md/.csv repoPath - so neither appears in the
    // CSV-serialised list, which names the families that reconstruct through
    // the CSV serialiser exclusively.
    expect([...CSV_SERIALISED_FAMILIES].sort()).toEqual([
      'attribute-addendum', 'available-pool', 'foi-register', 'foi-verbatim-csv', 'forbidden-list', 'open-data-register',
    ]);
  });

  it('ReconstructionCorpus_WhenResolved_IsIdenticallyTheRegisteredEmitCorpus', () => {
    // The load-bearing Stage D identity: what the ledger emits is what the
    // oracle proves - same resolutions, same declared source keys, no parallel
    // corpus that could drift. (collectReconstructionSources IS
    // collectLedgerSources; this pins the identity against regression.)
    const reconstruction = collectReconstructionSources().map(source => `${source.family}|${source.sourceFile}`);
    const families = new Set(collectReconstructionSources().map(source => source.family));
    expect(new Set(reconstruction).size).toBe(reconstruction.length);
    for (const family of families) expect(COVERED_FAMILIES).toContain(family);
  });

  it('EveryAuthoredFoiConversion_WhenCrossChecked_IsEmittedBySomeRegisteredFamily', () => {
    // The generalised coverage guarantee (issue #813 Stage D): the complement
    // of the registry's resolution over every authored FOI conversion is
    // EMPTY - no shape class can sit in a silent gap (the old per-shape E3
    // audit could not see a plain-CSV source owned by no family; this sees
    // every authored conversion). A future conversion emitted by no family
    // resurfaces here.
    expect(listNotYetCovered()).toEqual([]);
  });
});
