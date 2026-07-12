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
 * SCOPE (Phase 0 + Phase 1, CSV lanes only). The three CSV-producing families -
 * open-data register, FOI-CSV register, attribute-addendum - reconstruct and
 * pass here. The other text shapes the fidelity programme names (FOI
 * markdown-table, preamble, and prefixed/synthesised-callsign sources) emit NO
 * claims today, so they cannot be reconstructed: listNotYetCovered enumerates
 * them EXPLICITLY as honest non-coverage (never a silent pass), pending the
 * ingest work (issue #434 Phase 3 / E3). Comparison is at DECODED-TEXT level
 * (each source read with the encoding its loader used); a byte-level mode is a
 * later phase (#434 Phase 2 / G6).
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
import { collectOpenDataRegisterSources } from '../v2/collectors/open-data-register.ts';
import { collectFoiRegisterSources } from '../v2/collectors/foi-register.ts';
import { collectAttributeAddendumSources } from '../v2/collectors/attribute-addendum.ts';
import type { ResolvedLedgerSource } from '../v2/collectors/types.ts';
import { listFoiEntryKeys, readFoiEntryMeta, defaultFoiDir } from '../shared/foi-archive.ts';
import { FOI_ENTRY_CONVERSIONS } from '../shared/foi-normalise.ts';

// The repo root, two levels up from src/ci/, so a source's repo-relative
// repoPath resolves to the real archived file.
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

// The CSV-producing families this phase covers. A family not listed here has no
// reconstruction path yet (see listNotYetCovered).
export const COVERED_FAMILIES: readonly string[] = ['open-data-register', 'foi-register', 'attribute-addendum'];

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
  const ignoredLines: { line: number; content: string }[] = [];

  for (const claim of claims) {
    if (!isFileLevelClaim(claim)) continue;
    const columnIndex = columnIndexOf(claim.predicate);
    if (columnIndex !== undefined) {
      headerByIndex.set(columnIndex, claim.object);
      continue;
    }
    if (claim.predicate === SUBJECT_PREDICATE) {
      subjectColumn = claim.object;
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
  // rawSubject; the other columns come from their matching predicate's object.
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

  const lines: string[] = [columns.map(renderCell).join(',')];
  for (let ordinal = 0; ordinal <= maxOrdinal; ordinal += 1) {
    const attributes = attributesByOrdinal.get(ordinal);
    if (attributes === undefined) {
      throw new Error(`gap-free ordinal invariant broken: no claim for ordinal ${ordinal} in 0..${maxOrdinal}`);
    }
    const subject = subjectByOrdinal.get(ordinal) ?? '';
    const cells = columns.map(column => (column === subjectColumn ? subject : attributes.get(column) ?? ''));
    lines.push(cells.map(renderCell).join(','));
  }

  // Reinstate the curated/blank furniture at its line - today's CSV furniture is
  // end-of-file, so appending after the data block in line order reproduces it.
  for (const ignored of [...ignoredLines].sort((a, b) => a.line - b.line)) lines.push(ignored.content);

  return lines.join('\n') + '\n';
}

// ---- The oracle over one source ---------------------------------------------

export interface ReconstructionResult {
  sourceFile: string;
  repoPath: string;
  ok: boolean;
  // First-diff detail when ok is false - enough to locate the drift without
  // dumping a 150k-line file.
  detail?: string;
}

// Reconstruct one source from its claims and compare, modulo cosmetics, to the
// original raw bytes decoded with the loader's encoding (decoded-text level).
export function reconstructionResultFor(source: SourceObservationSet): ReconstructionResult {
  const repoPath = source.repoPath;
  if (repoPath === undefined) {
    return { sourceFile: source.sourceFile, repoPath: '', ok: false, detail: 'source attests no repoPath - cannot locate the original raw file' };
  }
  const claims: Claim[] = [...emitClaims(source), ...emitFileManifestClaims(source)];
  const reconstruction = reconstructCsvFromClaims(claims);

  const originalBytes = fs.readFileSync(path.join(REPO_ROOT, repoPath));
  const original = originalBytes.toString(source.encoding ?? 'utf8');

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

export interface UncoveredSource {
  entry: string;
  sourceFile: string;
  shape: 'markdown-table' | 'preamble' | 'prefixed-callsign';
  reason: string;
}

// Enumerate the text sources that emit NO claims today, so their non-coverage is
// a surfaced, checkable fact rather than a silent gap. These are the FOI shapes
// registerSourcesFor deliberately skips: markdown-table transcriptions,
// preamble-bearing sheets, and prefixed (synthesised-callsign) suffix lists.
// Reconstructing them is blocked on first ingesting them into the ledger (issue
// #434 Phase 3 / E3); until then the oracle reports them here.
export function listNotYetCovered(foiDir: string = defaultFoiDir()): UncoveredSource[] {
  const uncovered: UncoveredSource[] = [];
  for (const entry of listFoiEntryKeys(foiDir)) {
    const meta = readFoiEntryMeta(foiDir, entry);
    const variant = meta.converter?.variant;
    if (variant === undefined || variant === null) continue;
    const conversions = FOI_ENTRY_CONVERSIONS[variant];
    if (conversions === undefined) continue;
    for (const conversion of conversions) {
      if (conversion.format === 'markdown-table') {
        uncovered.push({ entry, sourceFile: conversion.sourceFile, shape: 'markdown-table', reason: 'markdown-table sources emit no claims today (issue #434 Phase 3 / E3)' });
        continue;
      }
      if (conversion.preamble !== undefined) {
        uncovered.push({ entry, sourceFile: conversion.sourceFile, shape: 'preamble', reason: 'preamble-bearing sources emit no claims today (issue #434 Phase 3 / E3)' });
        continue;
      }
      const callsignSpec = conversion.columns.find(column => column.output === 'callsign');
      if (callsignSpec !== undefined && callsignSpec.kind === 'prefixed') {
        uncovered.push({ entry, sourceFile: conversion.sourceFile, shape: 'prefixed-callsign', reason: 'prefixed (synthesised-callsign) sources emit no claims today (issue #434 Phase 3 / E3)' });
      }
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
  const sources = collectCsvReconstructionSources().map(resolved => resolved.load());
  const results = assertReconstruction(sources);
  const uncovered = listNotYetCovered();
  console.log(`reconstruction-oracle: ${results.length} CSV source(s) round-trip byte-identical modulo cosmetics`);
  for (const result of results) console.log(`  OK  ${result.sourceFile}`);
  console.log(`not-yet-covered (honest non-coverage, no claims emitted today): ${uncovered.length} source(s)`);
  for (const item of uncovered) console.log(`  --  [${item.shape}] ${item.entry}/${item.sourceFile}`);
}
