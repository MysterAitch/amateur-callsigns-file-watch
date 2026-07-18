#!/usr/bin/env node

/**
 * The reconstruction oracle (issue #434, the fidelity programme under #431):
 * rebuild each TEXT source file from its raw-keyed-ledger claims ALONE, then
 * prove the rebuild equals the ORIGINAL raw source modulo a minimal, declared
 * set of cosmetic differences. A pass proves the raw claim layer is CANONICAL -
 * the committed raw files are redundant-by-derivation - and, conversely, a
 * regression that drops or corrupts source structure fails the build loudly.
 *
 * This is a stronger claim than the semantic-equivalence round-trip #361 proved
 * (which reprojected the NORMALISED derivative as a record multiset): here the
 * target is BYTE-IDENTITY-MODULO-COSMETICS against the original raw bytes, and
 * the reconstruction reads its whole structure - header set/order/exact strings,
 * subject-column placement, footer furniture - from the claim stream, never from
 * the loader or meta.json. The structural framing comes from the file-level
 * manifest claims (emitFileManifestClaims, claim.ts); the data grid from the
 * per-row claims (emitClaims).
 *
 * FROM THE LEDGER, NOT A PARALLEL PROJECTION (issue #455). The manifest now
 * rides the CANONICAL ledger emit (emitSourceLedgerClaims, build-ledger.ts), so
 * the persisted JSONL ledger a build writes carries the whole structure - the
 * committed raw file is redundant-by-derivation of the LEDGER itself. To keep
 * that honest, reconstructionResultFor reconstructs from claims taken through
 * the ledger's own JSONL serialiser (serialiseClaimsJsonl -> parseClaimsJsonl),
 * so a source proves it rebuilds from the PERSISTED claim form, not an in-memory
 * convenience; a committed test additionally emits the real ledger for a source
 * and reconstructs it straight off the JSONL on disk.
 *
 * SCOPE IS STRUCTURAL (issue #813 Stage D): the reconstruction corpus IS the
 * collector registry (collectLedgerSources) - every registered family emits its
 * sources losslessly through the ONE canonical emit, so every registered source
 * reconstructs from the ledger a build persists, and COVERED_FAMILIES is
 * derived from the registry rather than maintained beside it. The last
 * oracle-only mirror (foi-markdown-table) is deleted; each markdown-table
 * transcription reconstructs through its registered analytical owner
 * (statistics-aggregate since Stage C1, issuance-events since Stage C2). A
 * markdown source compares its TABLE REGION ONLY - the surrounding prose is
 * explicitly OUTSIDE the ledger's fidelity claim (MARKDOWN_PROSE_SCOPE_NOTE,
 * design E4), declared, never silently dropped; routing between the CSV and
 * markdown serialisers is per source, by repoPath extension. listNotYetCovered
 * generalises the old E3-shape check into the structural complement: every
 * authored FOI conversion must be emitted by SOME registered family (an empty
 * result is the coverage guarantee), so a silently-uncovered shape class can no
 * longer exist.
 * Comparison is at DECODED-TEXT level (each source read with the encoding its
 * loader used); a byte-level mode is a later phase (#434 Phase 2 / G6).
 *
 * The checks are pure over their inputs (a SourceObservationSet, or the resolved
 * corpus), so the committed test runs them over the real archive and
 * assertReconstruction throws on any miss - the same fail-loud, committed
 * self-check shape as src/ci/trust-rating.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { renderCell } from '../shared/normalise.ts';
import {
  emitClaims,
  emitFileManifestClaims,
  isFileLevelClaim,
  columnIndexOf,
  LISTED_PREDICATE,
  SUBJECT_PREDICATE,
  IGNORED_PREDICATE,
  type Claim,
  type SourceObservationSet,
} from '../v2/claim.ts';
import { collectOpenDataRegisterSources, defaultArchiveDir } from '../v2/collectors/open-data-register.ts';
import { collectFoiRegisterSources } from '../v2/collectors/foi-register.ts';
import { collectAttributeAddendumSources } from '../v2/collectors/attribute-addendum.ts';
import { COLLECTORS, collectLedgerSources } from '../v2/collectors/index.ts';
import { serialiseClaimsJsonl, parseClaimsJsonl } from '../v2/serialise.ts';
import type { ResolvedLedgerSource } from '../v2/collectors/types.ts';
import { listFoiEntryKeys, readFoiEntryMeta, defaultFoiDir } from '../shared/foi-archive.ts';
import { FOI_ENTRY_CONVERSIONS, parseMarkdownTable } from '../shared/foi-normalise.ts';

// The repo root, two levels up from src/ci/, so a source's repo-relative
// repoPath resolves to the real archived file.
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

// The families the oracle reconstructs: IDENTICALLY the collector registry
// (issue #813 Stage D). Derived, not maintained - a newly-registered family is
// reconstruction-covered by construction (its sources join the oracle corpus
// via collectReconstructionSources), and a family that cannot round-trip fails
// the corpus gate loudly rather than sitting in a silent gap.
export const COVERED_FAMILIES: readonly string[] = COLLECTORS.map(collector => collector.family);

// The families reconstructed through the CSV serialiser (canonicaliseCsvText +
// reconstructCsvFromClaims) EXCLUSIVELY, as opposed to the markdown serialiser
// (statistics-aggregate) or per-source routing by repoPath extension
// (issuance-events: two CSV exports plus the markdown transfers table).
export const CSV_SERIALISED_FAMILIES: readonly string[] = ['open-data-register', 'foi-register', 'attribute-addendum', 'forbidden-list', 'available-pool', 'foi-verbatim-csv'];

// The scope boundary the oracle declares for markdown sources (design E4): only
// the single table block is a dataset the ledger claims; the surrounding prose
// is deliberately not attested and not reconstructed. Surfaced on every markdown
// result so the exclusion is explicit, never a silent omission.
export const MARKDOWN_PROSE_SCOPE_NOTE = 'table region only; surrounding prose is outside the ledger fidelity claim (issue #434 E4)';

// ---- Cosmetic normalisation (design §4) -------------------------------------

// Canonicalise a CSV text so a comparison ignores exactly the declared cosmetic
// axes and nothing else. Applied IDENTICALLY to the original and the
// reconstruction, so any transform here is a fixed function of both sides:
//   1. strip a leading BOM;
//   2. normalise CRLF/CR -> LF;
//   3. re-render every field through the ONE minimal RFC-4180 renderer, which
//      canonicalises quoting STYLE (over-quoting, and quoting a field that needs
//      none) WITHOUT touching data quotes (those are inside the logical value
//      csv-parse already resolved);
//   4. exactly one trailing newline.
// Every SIGNIFICANT byte (cell values, column set/order, row count/order,
// furniture content/position) survives, so a real difference still diverges.
export function canonicaliseCsvText(text: string): string {
  const withoutBom = text.replace(/^﻿/, '');
  const lf = withoutBom.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // relax_column_count: the footer furniture (and, defensively, any ragged
  // line) must not abort the canonicalisation - the row simply re-renders as-is.
  const rows = parse(lf, { relax_column_count: true, skip_empty_lines: false }) as string[][];
  const lines = rows.map(row => row.map(renderCell).join(','));
  // A final newline yields no trailing record from csv-parse; a genuine trailing
  // blank line would. Drop trailing empties on both sides so a single vs absent
  // trailing newline is not a difference (cosmetic axis 3).
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.length > 0 ? lines.join('\n') + '\n' : '';
}

// ---- Reconstruction (design §7) ---------------------------------------------

function getOrCreate<K, V>(map: Map<K, V>, key: K, make: () => V): V {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const created = make();
  map.set(key, created);
  return created;
}

// Rebuild the CSV text for one source from its claim stream ALONE. The manifest
// (columns/subject/furniture) is read from the file-level claims; the data grid
// from the per-row claims grouped by ordinal. Derived claims are ignored (they
// are folds, not source bytes). A hole in the header index range or the ordinal
// range is a corruption, not a blank - fail loud (design §7.2).
export function reconstructCsvFromClaims(claims: readonly Claim[]): string {
  const headerByIndex = new Map<number, string>();
  let subjectColumn: string | undefined;
  let headerLine: number | undefined;
  const ignoredLines: { line: number; content: string }[] = [];

  for (const claim of claims) {
    if (!isFileLevelClaim(claim)) continue;
    const columnIndex = columnIndexOf(claim.predicate);
    if (columnIndex !== undefined) {
      headerByIndex.set(columnIndex, claim.object);
      if (claim.provenance.position?.kind === 'csv-line') headerLine = claim.provenance.position.line;
      continue;
    }
    if (claim.predicate === SUBJECT_PREDICATE) {
      subjectColumn = claim.object;
      if (claim.provenance.position?.kind === 'csv-line') headerLine = claim.provenance.position.line;
      continue;
    }
    if (claim.predicate === IGNORED_PREDICATE) {
      const position = claim.provenance.position;
      if (position === undefined || position.kind !== 'csv-line') {
        throw new Error('@ignored file-level claim carries no csv-line position - cannot place the furniture');
      }
      ignoredLines.push({ line: position.line, content: claim.object });
    }
  }

  if (headerByIndex.size === 0) throw new Error('no @column manifest claims - cannot reconstruct the header row');
  if (subjectColumn === undefined) throw new Error('no @subject manifest claim - cannot place the subject column');

  const maxColumnIndex = Math.max(...headerByIndex.keys());
  const columns: string[] = [];
  for (let index = 0; index <= maxColumnIndex; index += 1) {
    const header = headerByIndex.get(index);
    if (header === undefined) throw new Error(`missing @column/${index} - the header set has a hole`);
    columns.push(header);
  }

  // Group the raw per-row claims by ordinal: the subject rides every claim as
  // rawSubject; the other columns come from their matching predicate's object;
  // the @listed anchor carries the row's source line (issue #431) for positional
  // placement.
  const attributesByOrdinal = new Map<number, Map<string, string>>();
  const subjectByOrdinal = new Map<number, string>();
  const lineByOrdinal = new Map<number, number>();
  let maxOrdinal = -1;
  for (const claim of claims) {
    if (claim.layer !== 'raw' || isFileLevelClaim(claim)) continue;
    const ordinal = claim.provenance.ordinal;
    if (ordinal > maxOrdinal) maxOrdinal = ordinal;
    subjectByOrdinal.set(ordinal, claim.rawSubject);
    const attributes = getOrCreate(attributesByOrdinal, ordinal, () => new Map<string, string>());
    if (claim.predicate === LISTED_PREDICATE) {
      const position = claim.provenance.position;
      if (position !== undefined && position.kind === 'csv-line') lineByOrdinal.set(ordinal, position.line);
      continue;
    }
    attributes.set(claim.predicate, claim.object);
  }

  const headerRow = columns.map(renderCell).join(',');
  const dataRows: string[] = [];
  for (let ordinal = 0; ordinal <= maxOrdinal; ordinal += 1) {
    const attributes = attributesByOrdinal.get(ordinal);
    if (attributes === undefined) {
      throw new Error(`gap-free ordinal invariant broken: no claim for ordinal ${ordinal} in 0..${maxOrdinal}`);
    }
    const subject = subjectByOrdinal.get(ordinal) ?? '';
    const cells = columns.map(column => (column === subjectColumn ? subject : attributes.get(column) ?? ''));
    dataRows.push(cells.map(renderCell).join(','));
  }

  // Positional reinstatement (design §7.5): when the header line and every data
  // row's line are attested, place the header, the data rows and the curated
  // furniture at their true source lines and emit in line order. This reproduces
  // furniture WHEREVER it sits - a pre-header preamble (the FOI prefix/suffix and
  // pre-war annex sheets) as faithfully as an end-of-file export footer - rather
  // than assuming end-of-file. A stable sort keeps the header-before-data,
  // data-in-ordinal-order sequence for the (distinct, ascending) CSV-lane lines,
  // so those lanes are byte-identical to the append order they used before.
  const positional = headerLine !== undefined && dataRows.every((_row, ordinal) => lineByOrdinal.has(ordinal));
  if (positional && headerLine !== undefined) {
    const placed: { line: number; seq: number; content: string }[] = [];
    let seq = 0;
    placed.push({ line: headerLine, seq: seq += 1, content: headerRow });
    dataRows.forEach((content, ordinal) => {
      const line = lineByOrdinal.get(ordinal);
      if (line === undefined) throw new Error(`positional reconstruction lost the line for ordinal ${ordinal}`);
      placed.push({ line, seq: seq += 1, content });
    });
    for (const ignored of ignoredLines) placed.push({ line: ignored.line, seq: seq += 1, content: ignored.content });
    placed.sort((a, b) => a.line - b.line || a.seq - b.seq);
    return placed.map(entry => entry.content).join('\n') + '\n';
  }

  // Fallback (a source without attested line numbers, e.g. a synthetic fixture):
  // header, data in ordinal order, then furniture appended in line order.
  const lines = [headerRow, ...dataRows];
  for (const ignored of [...ignoredLines].sort((a, b) => a.line - b.line)) lines.push(ignored.content);
  return lines.join('\n') + '\n';
}

// ---- Markdown-table reconstruction (design §7 markdown-table) ---------------

// Render a header + data grid as a CANONICAL markdown table: a single-space-
// padded header row, a separator of one '---' per column, and one single-space-
// padded row per record. This is the ONE canonical form both the reconstruction
// (from claims) and the original (via canonicaliseMarkdownTable) render into, so
// cell padding/alignment and separator dash-count - the declared markdown
// cosmetic axes (§4.5) - never register as a difference.
function renderCanonicalMarkdownTable(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const renderRow = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;
  const separator = `| ${header.map(() => '---').join(' | ')} |`;
  const lines = [renderRow(header), separator, ...rows.map(renderRow)];
  return lines.join('\n') + '\n';
}

// Canonicalise the single markdown table in an ORIGINAL extract: locate the
// table block exactly as parseMarkdownTable does (the surrounding prose is out
// of scope, design E4), strip the structural cell padding it already removes,
// and re-render through the one canonical renderer. Applied to the original;
// the reconstruction renders straight into the same form.
export function canonicaliseMarkdownTable(text: string, sourceFile: string): string {
  const records = parseMarkdownTable(text, sourceFile);
  const header = Object.keys(records[0]);
  const rows = records.map(record => header.map(column => record[column] ?? ''));
  return renderCanonicalMarkdownTable(header, rows);
}

// Rebuild the canonical markdown TABLE from a source's claim stream ALONE: the
// header/subject from the file-level manifest, the data grid from the per-row
// claims grouped by ordinal (identical grid assembly to the CSV serialiser), then
// the canonical markdown render. Derived claims are ignored; a hole in the header
// index range or the ordinal range is a corruption, not a blank - fail loud.
export function reconstructMarkdownTableFromClaims(claims: readonly Claim[]): string {
  const headerByIndex = new Map<number, string>();
  let subjectColumn: string | undefined;
  for (const claim of claims) {
    if (!isFileLevelClaim(claim)) continue;
    const columnIndex = columnIndexOf(claim.predicate);
    if (columnIndex !== undefined) {
      headerByIndex.set(columnIndex, claim.object);
      continue;
    }
    if (claim.predicate === SUBJECT_PREDICATE) subjectColumn = claim.object;
  }
  if (headerByIndex.size === 0) throw new Error('no @column manifest claims - cannot reconstruct the table header');
  if (subjectColumn === undefined) throw new Error('no @subject manifest claim - cannot place the subject column');

  const maxColumnIndex = Math.max(...headerByIndex.keys());
  const columns: string[] = [];
  for (let index = 0; index <= maxColumnIndex; index += 1) {
    const header = headerByIndex.get(index);
    if (header === undefined) throw new Error(`missing @column/${index} - the table header set has a hole`);
    columns.push(header);
  }

  const attributesByOrdinal = new Map<number, Map<string, string>>();
  const subjectByOrdinal = new Map<number, string>();
  let maxOrdinal = -1;
  for (const claim of claims) {
    if (claim.layer !== 'raw' || isFileLevelClaim(claim)) continue;
    const ordinal = claim.provenance.ordinal;
    if (ordinal > maxOrdinal) maxOrdinal = ordinal;
    subjectByOrdinal.set(ordinal, claim.rawSubject);
    const attributes = getOrCreate(attributesByOrdinal, ordinal, () => new Map<string, string>());
    if (claim.predicate === LISTED_PREDICATE) continue;
    attributes.set(claim.predicate, claim.object);
  }

  const rows: string[][] = [];
  for (let ordinal = 0; ordinal <= maxOrdinal; ordinal += 1) {
    const attributes = attributesByOrdinal.get(ordinal);
    if (attributes === undefined) {
      throw new Error(`gap-free ordinal invariant broken: no claim for ordinal ${ordinal} in 0..${maxOrdinal}`);
    }
    const subject = subjectByOrdinal.get(ordinal) ?? '';
    rows.push(columns.map(column => (column === subjectColumn ? subject : attributes.get(column) ?? '')));
  }

  return renderCanonicalMarkdownTable(columns, rows);
}

// ---- The oracle over one source ---------------------------------------------

export interface ReconstructionResult {
  sourceFile: string;
  repoPath: string;
  ok: boolean;
  // First-diff detail when ok is false - enough to locate the drift without
  // dumping a 150k-line file.
  detail?: string;
  // The declared scope caveat for a markdown source: the compare is the table
  // region only, the prose is out of scope (design E4). Absent for CSV sources,
  // which reconstruct in full. Surfaced so the exclusion is explicit on the
  // result, never a silent omission.
  scopeNote?: string;
}

// Whether a source reconstructs through the markdown serialiser (its original is
// a committed markdown-table extract) rather than the CSV serialiser. Keyed off
// the real file extension, so no format field need be threaded onto the shared
// SourceObservationSet type.
function isMarkdownSource(repoPath: string): boolean {
  return repoPath.toLowerCase().endsWith('.md');
}

// Reconstruct one source from its claims and compare, modulo cosmetics, to the
// original raw bytes decoded with the loader's encoding (decoded-text level). A
// markdown-table source is rebuilt and compared over its TABLE REGION only (the
// prose is out of scope, design E4); every other source through the CSV
// serialiser.
export function reconstructionResultFor(source: SourceObservationSet): ReconstructionResult {
  const repoPath = source.repoPath;
  if (repoPath === undefined) {
    return { sourceFile: source.sourceFile, repoPath: '', ok: false, detail: 'source attests no repoPath - cannot locate the original raw file' };
  }
  // Reconstruct from the claims AS THE LEDGER PERSISTS THEM: serialise the raw
  // per-row + file-level manifest stream to JSONL and parse it straight back, so
  // the round-trip proves the persisted ledger form suffices, not an in-memory
  // stream the serialiser might not preserve (issue #455). The derived tier is
  // omitted here because the reconstruction ignores it anyway (design §7.2); the
  // committed from-real-ledger test exercises the full emitSourceLedgerClaims
  // stream end to end.
  const claims: Claim[] = parseClaimsJsonl(serialiseClaimsJsonl([...emitClaims(source), ...emitFileManifestClaims(source)]));
  const originalBytes = fs.readFileSync(path.join(REPO_ROOT, repoPath));
  const original = originalBytes.toString(source.encoding ?? 'utf8');

  if (isMarkdownSource(repoPath)) {
    const canonicalOriginal = canonicaliseMarkdownTable(original, source.sourceFile);
    const reconstruction = reconstructMarkdownTableFromClaims(claims);
    if (canonicalOriginal === reconstruction) {
      return { sourceFile: source.sourceFile, repoPath, ok: true, scopeNote: MARKDOWN_PROSE_SCOPE_NOTE };
    }
    return { sourceFile: source.sourceFile, repoPath, ok: false, detail: firstDiff(canonicalOriginal, reconstruction), scopeNote: MARKDOWN_PROSE_SCOPE_NOTE };
  }

  const reconstruction = reconstructCsvFromClaims(claims);
  const canonicalOriginal = canonicaliseCsvText(original);
  const canonicalReconstruction = canonicaliseCsvText(reconstruction);
  if (canonicalOriginal === canonicalReconstruction) {
    return { sourceFile: source.sourceFile, repoPath, ok: true };
  }
  return { sourceFile: source.sourceFile, repoPath, ok: false, detail: firstDiff(canonicalOriginal, canonicalReconstruction) };
}

function firstDiff(original: string, reconstruction: string): string {
  const originalLines = original.split('\n');
  const reconstructionLines = reconstruction.split('\n');
  const limit = Math.max(originalLines.length, reconstructionLines.length);
  for (let i = 0; i < limit; i += 1) {
    if (originalLines[i] !== reconstructionLines[i]) {
      return `line ${i + 1} of ${limit}: original ${JSON.stringify(originalLines[i])} != reconstruction ${JSON.stringify(reconstructionLines[i])} (original ${originalLines.length} lines, reconstruction ${reconstructionLines.length} lines)`;
    }
  }
  return 'texts differ but no line-level diff located';
}

// ---- Corpus resolution + not-yet-covered honesty ----------------------------

// Every CSV-lane source the oracle covers, across the three CSV families, in a
// stable order for a reproducible corpus pass.
export function collectCsvReconstructionSources(): ResolvedLedgerSource[] {
  return [
    ...collectOpenDataRegisterSources(),
    ...collectFoiRegisterSources(),
    ...collectAttributeAddendumSources(),
  ];
}

// Every source the oracle reconstructs: IDENTICALLY the registered corpus, in
// the registry's own stable order (issue #813 Stage D) - the whole point of the
// structural framing is that the reconstruction corpus and the emitted corpus
// are the SAME resolution, so a source cannot be emitted without being proven
// to round-trip. The markdown sources self-identify by their .md repoPath, so
// reconstructionResultFor routes them to the markdown serialiser regardless of
// family.
export function collectReconstructionSources(foiDir: string = defaultFoiDir()): ResolvedLedgerSource[] {
  return collectLedgerSources({ foiDir, archiveDir: defaultArchiveDir() });
}

export interface UncoveredSource {
  entry: string;
  sourceFile: string;
  reason: string;
}

// The STRUCTURAL coverage cross-check (issue #813 Stage D, generalising the old
// per-shape E3 audit): every authored FOI conversion - whatever its shape - must
// be emitted by SOME registered family, keyed by the corpus-unique sourceFile
// each resolution declares. This closes the silent-gap class permanently: the
// old check could only see the shapes it knew to look for (a plain-CSV source
// owned by no family, like the pre-Stage-A typed pool exports or the
// pre-Stage-C2 issuance CSVs, was invisible to it), whereas the complement of a
// full registry resolution sees every authored conversion. This is EMPTY on the
// current archive: an empty result is the coverage guarantee. (The open-data
// lane needs no such audit: its collector resolves every archive entry carrying
// the open-data source key, so its authored corpus and its resolution are the
// same enumeration.)
export function listNotYetCovered(foiDir: string = defaultFoiDir()): UncoveredSource[] {
  const registered = new Set(collectReconstructionSources(foiDir).map(source => source.sourceFile));
  const uncovered: UncoveredSource[] = [];
  for (const entry of listFoiEntryKeys(foiDir)) {
    const meta = readFoiEntryMeta(foiDir, entry);
    const variant = meta.converter?.variant;
    if (variant === undefined || variant === null) continue;
    const conversions = FOI_ENTRY_CONVERSIONS[variant];
    if (conversions === undefined) continue;
    for (const conversion of conversions) {
      const sourceFile = `foi/${entry}/${conversion.sourceFile}`;
      if (registered.has(sourceFile)) continue;
      uncovered.push({ entry, sourceFile, reason: 'authored conversion is emitted by no registered family - the source neither joins the ledger nor proves reconstruction (issue #813 Stage D)' });
    }
  }
  return uncovered;
}

// ---- Aggregate gate ---------------------------------------------------------

// Run the oracle over every covered CSV source and throw loudly on any miss -
// the committed CI self-check. Returns the per-source results so a caller can
// report coverage; the throw carries every failing source's first-diff detail.
export function assertReconstruction(sources: readonly SourceObservationSet[]): ReconstructionResult[] {
  const results = sources.map(reconstructionResultFor);
  const failures = results.filter(result => !result.ok);
  if (failures.length > 0) {
    const detail = failures.map(f => `  ${f.sourceFile}: ${f.detail ?? 'mismatch'}`).join('\n');
    throw new Error(`${failures.length} reconstruction-oracle failure(s):\n${detail}`);
  }
  return results;
}

if (import.meta.main) {
  const sources = collectReconstructionSources().map(resolved => resolved.load());
  const results = assertReconstruction(sources);
  const uncovered = listNotYetCovered();
  console.log(`reconstruction-oracle: ${results.length} source(s) round-trip modulo cosmetics (CSV byte-identical; markdown table-region)`);
  for (const result of results) console.log(`  OK  ${result.sourceFile}${result.scopeNote !== undefined ? `  [${result.scopeNote}]` : ''}`);
  console.log(`not-yet-covered (authored conversions emitted by no registered family): ${uncovered.length} source(s)`);
  for (const item of uncovered) console.log(`  --  ${item.sourceFile}`);
}
