/**
 * The FOI-register family: the FOI-disclosed register snapshots (archive/foi/**),
 * keyed off FOI_ENTRY_CONVERSIONS (foi-normalise.ts). Each qualifying entry's
 * callsign-bearing sources resolve to a loader that reads the entry's raw bytes.
 *
 * This module also owns the shared register machinery (RegisterSource,
 * registerSourcesFor, loadRegisterSource) and the register/addendum class
 * constants, because the attribute-addendum family rides the SAME machinery over
 * the entries this family deliberately excludes.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { type SourceObservationSet } from '../claim.ts';
import { listFoiEntryKeys, readFoiEntryMeta, defaultFoiDir, type FoiEntryMeta } from '../../shared/foi-archive.ts';
import { FOI_ENTRY_CONVERSIONS, interpretFoiColumns, type FoiSourceConversion } from '../../shared/foi-normalise.ts';
import type { LedgerCollector, ResolvedLedgerSource } from './types.ts';
import { jsonlStem } from './util.ts';

// The dataset class that marks a per-callsign register state at a vintage. Only
// these fold into the register ledger.
const REGISTER_SNAPSHOT_CLASS = 'register-snapshot';

// The dataset class marking an entry that carries extra per-callsign attributes
// beyond the plain register row (licence-issued / original-start dates,
// reservation expiries). Its own collector folds these entries in.
export const ATTRIBUTE_ADDENDUM_CLASS = 'attribute-addendum';

// Classes whose PRESENCE disqualifies an entry from the REGISTER families even
// when register-snapshot is also declared: an attribute addendum is per-callsign
// join material rather than a snapshot of register state (picked up instead by
// the attribute-addendum family, collectAttributeAddendumSources), and a
// statistics aggregate carries no per-row callsign at all. This is the filter
// the #361 exploration settled on.
const EXCLUDED_CLASSES: readonly string[] = [ATTRIBUTE_ADDENDUM_CLASS, 'statistics-aggregate'];

// The normalised output column whose raw source header names the callsign token
// this runner keys the ledger off.
const CALLSIGN_OUTPUT = 'callsign';

// The normalised output column whose raw source header names the licence
// product/class token the derived licence-category tier is computed from.
const LICENCE_CLASS_OUTPUT = 'licence_class';

// The normalised output column whose raw source header names the call sign's
// original start (issue) date - the temporal input parseCallsign consumes for
// the forbidden-suffix-issued-after-first-known-list flag. Present on the
// date-bearing register/addendum shapes (the 2021 annexes' 'Original Start
// Date'), absent from the reduced Value/Status/Type snapshots.
const ORIGINAL_START_DATE_OUTPUT = 'original_start_date';

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
  // The raw header carrying the call sign's original start date, when the
  // conversion maps one to the original_start_date output; null when the source
  // discloses no such date. The RAW cell (verbatim, under the source's own
  // header) feeds parseCallsign's temporal flag - the FOI shapes render this
  // date ISO, so the flag fires where the date post-dates the suffix's
  // first-known-forbidden month.
  startDateColumn: string | null;
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
    // The original-start-date column is a DATE transform (kind 'date'/'iso-date'),
    // not 'verbatim': the raw cell is passed to parseCallsign, whose ISO-only
    // comparison tolerates a source that already renders ISO and stays silent
    // otherwise, so any source-backed date column qualifies here.
    const startDateSpec = conversion.columns.find(column => column.output === ORIGINAL_START_DATE_OUTPUT);
    const startDateColumn = startDateSpec !== undefined && startDateSpec.source !== null
      ? startDateSpec.source
      : null;
    sources.push({ conversion, callsignColumn: callsignSpec.source, productColumn, startDateColumn });
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
  // `info: true` yields each record beside csv-parse's own physical-line tally
  // (issue #431): info.lines is the 1-based physical line at the record's end,
  // and skip_empty_lines still counts skipped lines in that tally, so it is the
  // TRUE source line - captured while parsing, no re-parse. Each element is
  // { record, info }; the records reproject exactly as before.
  const parsed = parse(text, { columns: true, skip_empty_lines: true, bom: true, info: true }) as { record: Record<string, string>; info: { lines: number } }[];
  if (parsed.length === 0) {
    throw new Error(`${filePath}: parsed to zero rows - a register source must not be empty`);
  }
  const rows = parsed.map(entryRow => entryRow.record);
  const lineNumbers = parsed.map(entryRow => entryRow.info.lines);
  const columns = Object.keys(rows[0]);
  if (!columns.includes(callsignColumn)) {
    throw new Error(`${filePath}: authored callsign column "${callsignColumn}" absent from raw headers (${columns.join(', ')})`);
  }
  if (source.productColumn !== null && !columns.includes(source.productColumn)) {
    throw new Error(`${filePath}: authored product column "${source.productColumn}" absent from raw headers (${columns.join(', ')})`);
  }
  if (source.startDateColumn !== null && !columns.includes(source.startDateColumn)) {
    throw new Error(`${filePath}: authored original-start-date column "${source.startDateColumn}" absent from raw headers (${columns.join(', ')})`);
  }
  return {
    sourceFile: `foi/${entry}/${conversion.sourceFile}`,
    vintage: meta.dataVintage ?? '',
    columns,
    subjectColumn: callsignColumn,
    rows,
    categoryColumn: source.productColumn ?? undefined,
    originalStartDateColumn: source.startDateColumn ?? undefined,
    // The 1-based physical source line of each record (issue #431), from
    // csv-parse's info tally - parallel to `rows` by index.
    lineNumbers,
    // The REAL repo path of the raw source file, which the logical `sourceFile`
    // key abstracts by dropping the 'archive/' prefix; carried for the
    // deep-link's viewAnchor (issue #431 §4.5).
    repoPath: `archive/foi/${entry}/${conversion.sourceFile}`,
    // The FOI CSV lane's raw sources are clean grids - header on line 1, one
    // data row per line, no curated footer or interior blank lines (unlike the
    // open-data export's salesforce footer). So the file manifest attests an
    // empty furniture set (issue #434); a source that ever grew furniture would
    // fail the reconstruction oracle loudly rather than round-trip silently.
    ignoredLines: [],
    headerLine: 1,
    // The encoding the raw bytes were decoded with (verbatim from the authored
    // converter binding: utf-8 or latin-1), so a fidelity oracle re-reads the
    // original at the same DECODED-TEXT level the ledger stored (issue #434, G6).
    encoding: conversion.encoding,
    // The authored per-column interpretation (issue #435), lifted from this
    // source's FoiColumnSpec.kind set, so an @interpretation/<index> claim can be
    // attested beside each @column header.
    columnInterpretations: interpretFoiColumns(conversion, columns, { subjectColumn: callsignColumn, categoryColumn: source.productColumn ?? undefined }),
  };
}

// The FOI-register family: every qualifying FOI register entry's callsign-
// bearing sources, each resolved to a loader that reads the entry's raw bytes.
export function collectFoiRegisterSources(foiDir: string = defaultFoiDir()): ResolvedLedgerSource[] {
  const resolved: ResolvedLedgerSource[] = [];
  for (const { entry, meta } of qualifyingRegisterEntries(foiDir)) {
    for (const source of registerSourcesFor(meta)) {
      resolved.push({
        family: 'foi-register',
        subjectKind: 'callsign',
        entry,
        sourceFile: `foi/${entry}/${source.conversion.sourceFile}`,
        jsonlStem: jsonlStem(entry, source.conversion.sourceFile),
        load: () => loadRegisterSource(foiDir, entry, meta, source),
      });
    }
  }
  return resolved;
}

export const foiRegisterCollector: LedgerCollector = {
  family: 'foi-register',
  subjectKind: 'callsign',
  collect: roots => collectFoiRegisterSources(roots.foiDir),
};
