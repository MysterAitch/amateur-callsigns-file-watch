#!/usr/bin/env node

/**
 * Stage 1 of the raw-keyed claim-ledger pipeline (issue #361): emit the
 * canonical claim ledger (JSONL) straight from the RAW published bytes of the
 * register-snapshot entries, and report the corpus scale.
 *
 * The inversion #361 proposes makes a CLAIM the atom and every published table
 * a fold over the ledger. This runner is the emit half, keyed - deliberately -
 * off the RAW bytes, never the normalised CSVs: for each register snapshot it
 * reads that snapshot's raw source (the mechanical raw-extract of a disclosed
 * workbook, or the CSV-native disclosure itself), under Ofcom's OWN column
 * names, and calls emitLedger from claim.ts. The raw callsign token travels
 * verbatim, so the ledger preserves distinctions the normalised store discards
 * (the G0TQK trailing-NBSP twin). The master SQLite is generated FROM the
 * normalised CSVs and keyed to the normalised callsign, so it is deliberately
 * NOT a dependency here - the whole point is to work from raw.
 *
 * Layers, this stage: the seed's raw / derived only. Raw = the verbatim source
 * cells under Ofcom's headers; derived = the normalises_to edges lifted from
 * components.ts. The full T0-T4 tier ladder (attribute-level derived claims for
 * the status/class/date rules) is a LATER stage - noted here, not built.
 *
 * WHICH raw file backs each snapshot, and which raw column is the callsign, are
 * read from the entry's authored converter binding (FOI_ENTRY_CONVERSIONS) - the
 * one place that already records raw-source -> normalised provenance - so this
 * runner never re-guesses either. Only callsign-bearing register sources are
 * emitted; a forbidden-suffix sheet riding inside a register entry (suffix rows,
 * not callsigns) is skipped, as are the attribute-addendum / statistics-aggregate
 * classes excluded by the entry filter.
 *
 * The ledger is written as JSONL to a BUILD OUTPUT directory (scratch, exactly
 * as build-sqlite.ts writes its tiers). The full claim corpus runs to millions
 * of lines and is NOT committed: this stage proves the pipeline and shape, not
 * the committed-artefact strategy (that proposal lives in the PR).
 *
 * Usage: node src/v2/build-ledger.ts [output-dir]
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { emitLedger, type Claim, type SourceObservationSet } from './claim.ts';
import { serialiseClaimsJsonl } from './serialise.ts';
import { listFoiEntryKeys, readFoiEntryMeta, defaultFoiDir, type FoiEntryMeta } from '../shared/foi-archive.ts';
import { FOI_ENTRY_CONVERSIONS, type FoiSourceConversion } from '../shared/foi-normalise.ts';
import { loadReferenceData, type ReferenceData } from '../sources/ofcom-amateur/components.ts';

// The dataset class that marks a per-callsign register state at a vintage. Only
// these fold into the register ledger.
const REGISTER_SNAPSHOT_CLASS = 'register-snapshot';

// Classes whose PRESENCE disqualifies an entry even when register-snapshot is
// also declared: an attribute addendum is per-callsign join material rather than
// a snapshot of register state, and a statistics aggregate carries no per-row
// callsign at all. This is the filter the #361 exploration settled on.
const EXCLUDED_CLASSES: readonly string[] = ['attribute-addendum', 'statistics-aggregate'];

// The normalised output column whose raw source header names the callsign token
// this runner keys the ledger off.
const CALLSIGN_OUTPUT = 'callsign';

// The normalised output column whose raw source header names the licence
// product/class token the derived licence-category tier is computed from.
const LICENCE_CLASS_OUTPUT = 'licence_class';

export interface RegisterEntry {
  entry: string;
  meta: FoiEntryMeta;
}

// The register-snapshot entries: register-snapshot present, no excluded class.
// Sorted for a stable, reproducible corpus order.
export function qualifyingRegisterEntries(foiDir: string = defaultFoiDir()): RegisterEntry[] {
  const entries: RegisterEntry[] = [];
  for (const entry of listFoiEntryKeys(foiDir)) {
    const meta = readFoiEntryMeta(foiDir, entry);
    const classes = meta.datasetClasses;
    if (!classes.includes(REGISTER_SNAPSHOT_CLASS)) continue;
    if (EXCLUDED_CLASSES.some(excluded => classes.includes(excluded))) continue;
    entries.push({ entry, meta });
  }
  return entries;
}

// One raw source that carries register-snapshot rows, with the raw header that
// names its callsign token. Sourced from the authored converter binding so the
// raw-file and callsign-column choices are never re-guessed here.
export interface RegisterSource {
  conversion: FoiSourceConversion;
  callsignColumn: string;
  // The raw header carrying the licence product/class token, when the
  // conversion maps one verbatim to the licence_class output; null when the
  // source discloses no product (licence_class emitted empty, or synthesised
  // from an authored constant). Only a verbatim, source-backed product feeds
  // the derived licence-category tier - a constant is an authored value, not a
  // disclosed product string to canonicalise.
  productColumn: string | null;
}

// The callsign-bearing register sources for one entry. A conversion is a
// register source only when it plainly maps a raw header to the callsign column
// (kind 'verbatim') and is parsed as CSV: the raw-keyed ledger stores the token
// AS PUBLISHED, so a synthesised (kind 'prefixed') callsign - the available-pool
// suffix lists, already excluded by class - is never a register source, and the
// markdown-table / preamble shapes belong to other families. A forbidden-suffix
// sheet inside a register entry maps 'suffix', not 'callsign', so it drops out
// here rather than being mis-keyed as a callsign.
export function registerSourcesFor(meta: FoiEntryMeta): RegisterSource[] {
  const variant = meta.converter?.variant;
  if (variant === undefined || variant === null) return [];
  const conversions = FOI_ENTRY_CONVERSIONS[variant];
  if (conversions === undefined) return [];

  const sources: RegisterSource[] = [];
  for (const conversion of conversions) {
    if (conversion.format === 'markdown-table' || conversion.preamble !== undefined) continue;
    const callsignSpec = conversion.columns.find(column => column.output === CALLSIGN_OUTPUT);
    if (callsignSpec === undefined || callsignSpec.source === null || callsignSpec.kind !== 'verbatim') continue;
    const productSpec = conversion.columns.find(column => column.output === LICENCE_CLASS_OUTPUT);
    const productColumn = productSpec !== undefined && productSpec.source !== null && productSpec.kind === 'verbatim'
      ? productSpec.source
      : null;
    sources.push({ conversion, callsignColumn: callsignSpec.source, productColumn });
  }
  return sources;
}

// Parse one raw source file into the SourceObservationSet shape, verbatim under
// Ofcom's own headers. The parse options mirror the FOI converter's
// (skip_empty_lines + BOM), so the observations this runner keys off are the
// same rows the committed normalisation was derived from - the raw->normalised
// path stays honestly comparable. The stored sourceFile is corpus-unique
// (foi/<entry>/<file>) so an observation's provenance is self-locating.
export function loadRegisterSource(foiDir: string, entry: string, meta: FoiEntryMeta, source: RegisterSource): SourceObservationSet {
  const { conversion, callsignColumn } = source;
  const filePath = path.join(foiDir, entry, conversion.sourceFile);
  const text = fs.readFileSync(filePath).toString(conversion.encoding);
  const rows = parse(text, { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];
  if (rows.length === 0) {
    throw new Error(`${filePath}: parsed to zero rows - a register source must not be empty`);
  }
  const columns = Object.keys(rows[0]);
  if (!columns.includes(callsignColumn)) {
    throw new Error(`${filePath}: authored callsign column "${callsignColumn}" absent from raw headers (${columns.join(', ')})`);
  }
  if (source.productColumn !== null && !columns.includes(source.productColumn)) {
    throw new Error(`${filePath}: authored product column "${source.productColumn}" absent from raw headers (${columns.join(', ')})`);
  }
  return {
    sourceFile: `foi/${entry}/${conversion.sourceFile}`,
    vintage: meta.dataVintage ?? '',
    columns,
    subjectColumn: callsignColumn,
    rows,
    categoryColumn: source.productColumn ?? undefined,
  };
}

export interface SourceLedgerSummary {
  entry: string;
  sourceFile: string;
  vintage: string;
  observations: number;
  rawClaims: number;
  derivedClaims: number;
}

export interface LedgerBuildSummary {
  outputDir: string;
  entriesProcessed: number;
  sourcesProcessed: number;
  totalObservations: number;
  totalRawClaims: number;
  totalDerivedClaims: number;
  totalClaims: number;
  perSource: SourceLedgerSummary[];
}

function tallyLayers(claims: readonly Claim[]): { raw: number; derived: number } {
  let raw = 0;
  let derived = 0;
  for (const claim of claims) {
    if (claim.layer === 'raw') raw += 1;
    else derived += 1;
  }
  return { raw, derived };
}

// A filesystem-safe stem for one source's JSONL, unique per (entry, file).
function jsonlNameFor(entry: string, conversion: FoiSourceConversion): string {
  const stem = `${entry}--${conversion.sourceFile}`.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${stem}.jsonl`;
}

// Build the register ledger from the RAW bytes and write it as one JSONL file
// per source into outputDir/ledger/. Claims are serialised and released per
// source (a single register snapshot is ~150k rows / hundreds of thousands of
// claims), so peak memory is one source's ledger, not the whole corpus - the
// same streaming discipline build-sqlite.ts uses for the tiers.
// An optional entry selector, so a caller can build the ledger for a
// tractable representative subset of entries rather than the whole corpus. The
// default (undefined) processes every qualifying entry - the full-corpus build
// the CLI runs. A downstream artefact build (build-ledger-db) uses this to key
// off a handful of snapshots without re-implementing the emit path.
export type EntrySelector = (entry: string) => boolean;

export function buildLedger(
  outputDir: string,
  foiDir: string = defaultFoiDir(),
  ref: ReferenceData = loadReferenceData(),
  selectEntry?: EntrySelector,
): LedgerBuildSummary {
  const ledgerDir = path.join(outputDir, 'ledger');
  fs.mkdirSync(ledgerDir, { recursive: true });

  const perSource: SourceLedgerSummary[] = [];
  let entriesProcessed = 0;

  for (const { entry, meta } of qualifyingRegisterEntries(foiDir)) {
    if (selectEntry !== undefined && !selectEntry(entry)) continue;
    const sources = registerSourcesFor(meta);
    if (sources.length === 0) continue;
    entriesProcessed += 1;
    for (const source of sources) {
      const observationSet = loadRegisterSource(foiDir, entry, meta, source);
      const claims = emitLedger(observationSet, ref);
      const { raw, derived } = tallyLayers(claims);
      fs.writeFileSync(path.join(ledgerDir, jsonlNameFor(entry, source.conversion)), serialiseClaimsJsonl(claims));
      perSource.push({
        entry,
        sourceFile: observationSet.sourceFile,
        vintage: observationSet.vintage,
        observations: observationSet.rows.length,
        rawClaims: raw,
        derivedClaims: derived,
      });
    }
  }

  const totalObservations = perSource.reduce((sum, s) => sum + s.observations, 0);
  const totalRawClaims = perSource.reduce((sum, s) => sum + s.rawClaims, 0);
  const totalDerivedClaims = perSource.reduce((sum, s) => sum + s.derivedClaims, 0);
  return {
    outputDir: ledgerDir,
    entriesProcessed,
    sourcesProcessed: perSource.length,
    totalObservations,
    totalRawClaims,
    totalDerivedClaims,
    totalClaims: totalRawClaims + totalDerivedClaims,
    perSource,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2).filter(a => a.trim().length > 0);
  const outputDir = args[0] ?? path.join('_build', 'v2-ledger');
  const summary = buildLedger(outputDir);
  console.log(`wrote raw-keyed claim ledger to ${summary.outputDir}`);
  console.log(`  entries: ${summary.entriesProcessed}, sources: ${summary.sourcesProcessed}, observations: ${summary.totalObservations}`);
  console.log(`  claims: ${summary.totalClaims} (raw ${summary.totalRawClaims}, derived ${summary.totalDerivedClaims})`);
  for (const s of summary.perSource) {
    console.log(`  ${s.entry} [${s.vintage}] ${s.observations} obs -> ${s.rawClaims + s.derivedClaims} claims (raw ${s.rawClaims}, derived ${s.derivedClaims})  ${s.sourceFile}`);
  }
}
