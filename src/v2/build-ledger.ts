#!/usr/bin/env node

/**
 * Stage 1 of the raw-keyed claim-ledger pipeline (issue #361): emit the
 * canonical claim ledger (JSONL) straight from the RAW published bytes of the
 * register-snapshot sources, and report the corpus scale.
 *
 * SOURCE FAMILIES. The ledger folds over several published-source families, all
 * emitting through the ONE emit path (emitLedger) once a family resolves to a
 * SourceObservationSet - the raw rows under the publisher's own headers, with
 * the callsign/product columns read from that family's AUTHORED converter
 * binding, never re-guessed. Two register families are covered today:
 *   - foi-register: the FOI-disclosed register snapshots (archive/foi/**),
 *     keyed off FOI_ENTRY_CONVERSIONS (foi-normalise.ts).
 *   - open-data-register: Ofcom's open-data register publications
 *     (archive/<date>/raw.csv), keyed off the header-variant registry
 *     (ofcom-amateur/normalise.ts), honouring each entry's curated ignoredLines
 *     so export footer furniture never becomes a bogus observation.
 * Adding a family is additive: implement a collect<Family>Sources() that yields
 * ResolvedLedgerSource values (see collectOpenDataRegisterSources for the
 * pattern) and add it to collectLedgerSources. The remaining families
 * (available-pools, attribute-addenda, forbidden lists, statistics) follow the
 * same shape where they are callsign-row-per-line; a shape that is not (a
 * statistics aggregate, a PDF-only source) needs a bespoke adapter and does not
 * ride this path.
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
import { listArchiveKeys } from '../shared/archive.ts';
import { CONSTANTS, type ArchiveMeta } from '../shared/utils.ts';
import { parseRawRegister, rawColumnForCanonical } from '../sources/ofcom-amateur/normalise.ts';
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

// The two register source families the ledger folds over. Every family loads
// to a SourceObservationSet and emits through the one emitLedger path; the tag
// only distinguishes provenance in the corpus summary.
export type SourceFamily = 'foi-register' | 'open-data-register';

// One published source resolved to everything buildLedger needs: how to load
// its rows, and a filesystem-safe unique stem for its JSONL. `entry` is the
// family's natural key (an FOI entry key, or an open-data archive-date key) so
// an EntrySelector reads the same across families.
export interface ResolvedLedgerSource {
  family: SourceFamily;
  entry: string;
  jsonlStem: string;
  load(): SourceObservationSet;
}

// A filesystem-safe stem, unique per source, for one source's JSONL.
function jsonlStem(...parts: string[]): string {
  return parts.join('--').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// The FOI-register family: every qualifying FOI register entry's callsign-
// bearing sources, each resolved to a loader that reads the entry's raw bytes.
export function collectFoiRegisterSources(foiDir: string = defaultFoiDir()): ResolvedLedgerSource[] {
  const resolved: ResolvedLedgerSource[] = [];
  for (const { entry, meta } of qualifyingRegisterEntries(foiDir)) {
    for (const source of registerSourcesFor(meta)) {
      resolved.push({
        family: 'foi-register',
        entry,
        jsonlStem: jsonlStem(entry, source.conversion.sourceFile),
        load: () => loadRegisterSource(foiDir, entry, meta, source),
      });
    }
  }
  return resolved;
}

// The open-data source key - the ONE converter registered for the open-data
// lane (ofcom-amateur/normalise.ts). An archive entry declaring another source
// belongs to a different family and is skipped here.
const OPEN_DATA_SOURCE_KEY = CONSTANTS.SOURCES.OFCOM_AMATEUR;

// Default open-data lane location: the archive root, where dated register
// publications live (archive/<date>/), distinct from the FOI lane's
// archive/foi/. Fixed here as the shared archive helpers anchor it, matching
// the normalise sweep.
export function defaultArchiveDir(): string {
  return CONSTANTS.DIRS.archive;
}

// Read one open-data archive entry's meta.json synchronously (the async
// readArchiveMeta would force buildLedger async for no gain), tolerating the
// normalise-sweep's extra `normalised` block the base ArchiveMeta omits.
type OpenDataMeta = ArchiveMeta & { normalised?: { headerVariant?: string } };

function readOpenDataMeta(archiveDir: string, key: string): OpenDataMeta {
  return JSON.parse(fs.readFileSync(path.join(archiveDir, key, 'meta.json'), 'utf8')) as OpenDataMeta;
}

// Parse one open-data register's RAW bytes into the SourceObservationSet shape,
// verbatim under Ofcom's OWN headers. The strip-and-parse is LIFTED whole from
// the authored converter (parseRawRegister): the entry's curated ignoredLines
// remove export footer furniture before parsing, the header variant is detected
// from the registry, and the callsign/product columns are read from that
// variant's authored raw->canonical mapping - so the observations this keys off
// are exactly the rows the committed normalisation was derived from, and the
// raw callsign token still travels verbatim (BOM/whitespace artefacts intact).
export function loadOpenDataRegisterSource(archiveDir: string, key: string, meta: OpenDataMeta): SourceObservationSet {
  const rawContent = fs.readFileSync(path.join(archiveDir, key, 'raw.csv'), 'utf8');
  const parsed = parseRawRegister(rawContent, meta.ignoredLines ?? []);
  const callsignColumn = rawColumnForCanonical(parsed.mapping, 'callsign');
  if (callsignColumn === undefined) {
    throw new Error(`archive/${key}: variant "${parsed.variant}" maps no raw header to callsign`);
  }
  const productColumn = rawColumnForCanonical(parsed.mapping, 'product');
  return {
    // Corpus-unique, self-locating provenance parallel to the FOI lane's
    // foi/<entry>/<file>.
    sourceFile: `opendata/${key}/raw.csv`,
    vintage: meta.ofcomReportedUpdateIso ?? key,
    columns: parsed.headers,
    subjectColumn: callsignColumn,
    rows: parsed.records,
    categoryColumn: productColumn,
  };
}

// The open-data-register family: every archive/<date>/ publication whose
// source is the ofcom-amateur open-data export, resolved to a loader over its
// raw bytes. Chronological (listArchiveKeys is date-ordered) for a stable
// corpus order. A truncated publication (a partial-coverage vintage) is still a
// register snapshot of the rows it carries and is included - coverage is scope,
// not shape.
export function collectOpenDataRegisterSources(archiveDir: string = defaultArchiveDir()): ResolvedLedgerSource[] {
  const resolved: ResolvedLedgerSource[] = [];
  for (const key of listArchiveKeys()) {
    const meta = readOpenDataMeta(archiveDir, key);
    if (meta.sourceKey !== OPEN_DATA_SOURCE_KEY) continue;
    resolved.push({
      family: 'open-data-register',
      entry: key,
      jsonlStem: jsonlStem('opendata', key, 'raw.csv'),
      load: () => loadOpenDataRegisterSource(archiveDir, key, meta),
    });
  }
  return resolved;
}

// Every register source across all covered families, in a stable order (FOI
// first, then open-data), ready for the one emit path.
export function collectLedgerSources(foiDir: string = defaultFoiDir()): ResolvedLedgerSource[] {
  return [...collectFoiRegisterSources(foiDir), ...collectOpenDataRegisterSources()];
}

export interface SourceLedgerSummary {
  family: SourceFamily;
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
  // Distinct entries and sources contributed by each family, so the corpus
  // report shows coverage per source family, not just the total.
  entriesByFamily: Record<SourceFamily, number>;
  sourcesByFamily: Record<SourceFamily, number>;
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

const EMPTY_FAMILY_TALLY: Record<SourceFamily, number> = { 'foi-register': 0, 'open-data-register': 0 };

// Build the register ledger from the RAW bytes and write it as one JSONL file
// per source into outputDir/ledger/. Claims are serialised and released per
// source (a single register snapshot is ~150k rows / hundreds of thousands of
// claims), so peak memory is one source's ledger, not the whole corpus - the
// same streaming discipline build-sqlite.ts uses for the tiers.
// An optional entry selector, so a caller can build the ledger for a
// tractable representative subset of entries rather than the whole corpus. The
// default (undefined) processes every qualifying source across all families -
// the full-corpus build the CLI runs. A downstream artefact build
// (build-ledger-db) uses this to key off a handful of snapshots without
// re-implementing the emit path; the selector matches an entry's natural key,
// so a subset naming FOI entry keys naturally excludes the open-data lane.
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
  const entriesSeen: Record<SourceFamily, Set<string>> = { 'foi-register': new Set(), 'open-data-register': new Set() };

  for (const source of collectLedgerSources(foiDir)) {
    if (selectEntry !== undefined && !selectEntry(source.entry)) continue;
    const observationSet = source.load();
    const claims = emitLedger(observationSet, ref);
    const { raw, derived } = tallyLayers(claims);
    fs.writeFileSync(path.join(ledgerDir, `${source.jsonlStem}.jsonl`), serialiseClaimsJsonl(claims));
    entriesSeen[source.family].add(source.entry);
    perSource.push({
      family: source.family,
      entry: source.entry,
      sourceFile: observationSet.sourceFile,
      vintage: observationSet.vintage,
      observations: observationSet.rows.length,
      rawClaims: raw,
      derivedClaims: derived,
    });
  }

  const entriesByFamily = { ...EMPTY_FAMILY_TALLY };
  const sourcesByFamily = { ...EMPTY_FAMILY_TALLY };
  for (const family of Object.keys(entriesSeen) as SourceFamily[]) entriesByFamily[family] = entriesSeen[family].size;
  for (const s of perSource) sourcesByFamily[s.family] += 1;

  const totalObservations = perSource.reduce((sum, s) => sum + s.observations, 0);
  const totalRawClaims = perSource.reduce((sum, s) => sum + s.rawClaims, 0);
  const totalDerivedClaims = perSource.reduce((sum, s) => sum + s.derivedClaims, 0);
  return {
    outputDir: ledgerDir,
    entriesProcessed: entriesByFamily['foi-register'] + entriesByFamily['open-data-register'],
    sourcesProcessed: perSource.length,
    entriesByFamily,
    sourcesByFamily,
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
  console.log(`  by family: foi-register ${summary.entriesByFamily['foi-register']} entries / ${summary.sourcesByFamily['foi-register']} sources, open-data-register ${summary.entriesByFamily['open-data-register']} entries / ${summary.sourcesByFamily['open-data-register']} sources`);
  console.log(`  claims: ${summary.totalClaims} (raw ${summary.totalRawClaims}, derived ${summary.totalDerivedClaims})`);
  for (const s of summary.perSource) {
    console.log(`  [${s.family}] ${s.entry} [${s.vintage}] ${s.observations} obs -> ${s.rawClaims + s.derivedClaims} claims (raw ${s.rawClaims}, derived ${s.derivedClaims})  ${s.sourceFile}`);
  }
}
