/**
 * The FOI verbatim-CSV reconstruction family (issue #434 Phase 3 / E3): a
 * STRUCTURE-PRESERVING mirror of the FOI raw-extract CSV shapes the analytical
 * families ingest LOSSILY - the preamble-bearing sheets (the 2014 prefix/suffix
 * lists, the 2015 pre-war annex) and the 2013/14 prefixed suffix lists.
 *
 * Why a separate family. The available-pool loader reprojects these sources into
 * a canonical role vocabulary (suffix/licence_class/prefix), synthesises authored
 * constants, and drops the source's own column names - deliberately, for
 * downstream joins. That projection cannot rebuild the original file, which is
 * exactly what the reconstruction oracle (src/ci/reconstruction-oracle.ts) must
 * do to prove the raw layer is canonical. This family instead carries the
 * source's VERBATIM header set, every physical column, and the pre-header
 * preamble rows as positioned @ignored furniture - the fidelity input the oracle
 * needs. Per the design (E3), the RAW cell is stored as the subject: a 2013-style
 * suffix list holds bare suffixes under a label header, so the subject is that
 * suffix token as published, never the synthesised M6/20/M0 call sign (synthesis
 * is a derived concern this raw mirror does not make).
 *
 * SCOPE. It covers exactly the CSV shapes the register/forbidden/available-pool
 * loaders skip and the oracle reports as not-yet-covered: a conversion is in
 * scope when it is parsed as CSV (not a markdown table) AND either declares a
 * `preamble` OR maps its callsign column with kind 'prefixed'. This family is
 * NOT registered in the main ledger (collectors/index.ts): it is a parallel
 * faithful projection consumed only by the reconstruction oracle, so it never
 * double-counts the observations the analytical families already emit.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { renderCell } from '../../shared/normalise.ts';
import { type SourceObservationSet } from '../claim.ts';
import { listFoiEntryKeys, readFoiEntryMeta, defaultFoiDir, type FoiEntryMeta } from '../../shared/foi-archive.ts';
import { FOI_ENTRY_CONVERSIONS, type FoiSourceConversion } from '../../shared/foi-normalise.ts';
import type { ResolvedLedgerSource } from './types.ts';
import { jsonlStem } from './util.ts';

// The normalised output whose bound kind distinguishes a synthesised (prefixed)
// callsign source from a plainly-mapped one.
const CALLSIGN_OUTPUT = 'callsign';

// The format marking a markdown-table conversion (handled by the sibling
// foi-markdown-table family, never here).
const MARKDOWN_TABLE_FORMAT = 'markdown-table';

// One physical CSV record beside csv-parse's own 1-based physical-line tally, so
// the header line, the data-row lines and the preamble-furniture lines are all
// stored facts (issue #431), never inferred from row order.
interface PhysicalRow {
  record: string[];
  info: { lines: number };
}

// Whether a conversion is one of the verbatim-CSV shapes this family mirrors: a
// CSV source (not a markdown table) that either carries a preamble or maps a
// prefixed (synthesised-callsign) column. This is the exact complement, among
// the FOI CSV conversions, of the shapes the register/forbidden/available-pool
// loaders already emit - so no source is mirrored twice within a run.
export function isVerbatimCsvReconstructionSource(conversion: FoiSourceConversion): boolean {
  if (conversion.format === MARKDOWN_TABLE_FORMAT) return false;
  if (conversion.preamble !== undefined) return true;
  const callsignSpec = conversion.columns.find(column => column.output === CALLSIGN_OUTPUT);
  return callsignSpec !== undefined && callsignSpec.kind === 'prefixed';
}

// The verbatim-CSV reconstruction sources bound to one entry, read from the
// authored converter binding (FOI_ENTRY_CONVERSIONS) so the raw file is never
// re-guessed.
export function verbatimCsvSourcesFor(meta: FoiEntryMeta): FoiSourceConversion[] {
  const variant = meta.converter?.variant;
  if (variant === undefined || variant === null) return [];
  const conversions = FOI_ENTRY_CONVERSIONS[variant];
  if (conversions === undefined) return [];
  return conversions.filter(isVerbatimCsvReconstructionSource);
}

// Parse one verbatim-CSV source into a STRUCTURE-PRESERVING SourceObservationSet:
// the source's own header verbatim (every physical column, in source order), the
// first column as the subject (what the file holds - a suffix, a call sign, a
// database view label), the data rows keyed by those headers, and any authored
// pre-header preamble rows carried as positioned @ignored furniture so a
// reconstruction reinstates them at their source line. The preamble is matched
// cell-for-cell against the authored binding (a changed preamble is a changed
// assertion, failed loudly, never skipped blindly), exactly as the FOI
// converter's explicit-header path does.
export function loadFoiVerbatimCsvSource(foiDir: string, entry: string, meta: FoiEntryMeta, conversion: FoiSourceConversion): SourceObservationSet {
  const filePath = path.join(foiDir, entry, conversion.sourceFile);
  const text = fs.readFileSync(filePath).toString(conversion.encoding);
  // columns:false + info:true yields each physical record beside its 1-based
  // end-of-record source line; skip_empty_lines still counts the skipped lines
  // in that tally, so info.lines is the TRUE source line. relax_column_count lets
  // a preamble row (a different width from the header) parse rather than abort.
  const parsed = parse(text, { columns: false, skip_empty_lines: true, bom: true, relax_column_count: true, info: true }) as unknown as PhysicalRow[];

  const preamble = conversion.preamble ?? [];
  for (let i = 0; i < preamble.length; i += 1) {
    const expected = preamble[i];
    const actual = parsed[i]?.record;
    if (actual === undefined || actual.length !== expected.length || expected.some((cell, j) => actual[j] !== cell)) {
      throw new Error(`${filePath}: preamble row ${i + 1} mismatch - expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual ?? null)} (a changed preamble is a changed assertion, never skipped blindly)`);
    }
  }

  const headerRow = parsed[preamble.length];
  if (headerRow === undefined) {
    throw new Error(`${filePath}: no header row after the preamble`);
  }
  const columns = headerRow.record;
  if (new Set(columns).size !== columns.length) {
    throw new Error(`${filePath}: duplicate header names (${columns.join(', ')}) - a verbatim mirror cannot key rows unambiguously`);
  }

  const dataRows = parsed.slice(preamble.length + 1);
  if (dataRows.length === 0) {
    throw new Error(`${filePath}: parsed to zero data rows - a reconstruction source must not be empty`);
  }

  const rows = dataRows.map(physical =>
    Object.fromEntries(columns.map((header, index) => [header, physical.record[index] ?? ''])));

  // The pre-header preamble rows, positioned by source line and rendered through
  // the same minimal RFC-4180 renderer the header and data rows use, so the
  // whole reconstruction reads back through one canonicalisation.
  const ignoredLines = parsed.slice(0, preamble.length).map(physical => ({
    line: physical.info.lines,
    content: physical.record.map(renderCell).join(','),
  }));

  return {
    sourceFile: `foi/${entry}/${conversion.sourceFile}`,
    vintage: meta.dataVintage ?? '',
    columns,
    // The first physical column is the subject: the suffix / call sign / view
    // label the file lists. Storing the raw token (not a synthesised call sign)
    // keeps this a faithful mirror of what the source actually holds (E3).
    subjectColumn: columns[0],
    rows,
    // The 1-based physical source line of each data row, so the reconstruction
    // places the header, data and preamble furniture positionally rather than
    // assuming the furniture sits at end-of-file.
    lineNumbers: dataRows.map(physical => physical.info.lines),
    headerLine: headerRow.info.lines,
    ignoredLines,
    repoPath: `archive/foi/${entry}/${conversion.sourceFile}`,
    encoding: conversion.encoding,
  };
}

// The verbatim-CSV reconstruction family: every FOI entry's in-scope CSV sources,
// each resolved to a loader over the entry's RAW bytes. Discovered from the
// authored converter bindings, in the archive's sorted entry order, for a stable
// corpus order.
export function collectFoiVerbatimCsvSources(foiDir: string = defaultFoiDir()): ResolvedLedgerSource[] {
  const resolved: ResolvedLedgerSource[] = [];
  for (const entry of listFoiEntryKeys(foiDir)) {
    const meta = readFoiEntryMeta(foiDir, entry);
    for (const conversion of verbatimCsvSourcesFor(meta)) {
      resolved.push({
        family: 'foi-verbatim-csv',
        // Inert here: the reconstruction oracle emits raw claims only and never
        // branches on subjectKind (it does not normalise). Tagged 'pool-slot' so
        // the value cannot be mistaken for a licence-carrying register row if
        // this family were ever folded into the main emit path.
        subjectKind: 'pool-slot',
        entry,
        jsonlStem: jsonlStem('recon-csv', entry, conversion.sourceFile),
        load: () => loadFoiVerbatimCsvSource(foiDir, entry, meta, conversion),
      });
    }
  }
  return resolved;
}
