/**
 * The statistics-aggregate family: FOI entries whose datasetClasses carry
 * 'statistics-aggregate' (archive/foi/**) - aggregate counts per reporting
 * period, not per-callsign rows. The sole entry today is
 * wdtk-184767--annual-licence-counts, a response-letter PDF transcribed into a
 * committed markdown table (raw-extract-*.md) and bound by the authored
 * converter variant wdtk-184767-counts-table.
 *
 * The subject of an aggregate row is the reporting PERIOD label (e.g.
 * '2003-2004'), carried verbatim - a period is not a radio identity, so the
 * emit path stays raw-only. subjectKind 'aggregate' routes buildLedger through
 * emitClaims: one @listed existence claim per period plus one raw attribute
 * claim per count column, with NO callsign normalisation and NO licence
 * category - a count is not a licence class.
 *
 * VERBATIM HEADERS (issue #813 Stage C1). The family is lossless-canonical: the
 * ledger predicates and the manifest @column/@subject claims carry the table's
 * OWN headers ('period (1 April – 31 March)', 'Amateur Radio', 'Business
 * Radio') - the published bytes the raw layer documents itself as holding -
 * never the authored converter OUTPUT names, which are a normalised-CSV
 * vocabulary, not published bytes. (The old output-name emit dropped the period
 * header's boundary qualifier and presented authored spellings As-published.)
 * The source attests its repoPath/encoding, so the reconstruction oracle
 * (src/ci/reconstruction-oracle.ts) rebuilds the extract's table region from
 * the REGISTERED family's persisted claims (the oracle-only markdown mirror
 * this family superseded was deleted in issue #813 Stage D).
 *
 * Counts travel exactly as the converter PARSES them (parseMarkdownTable): the
 * published figures verbatim, thousands separators intact. The
 * separator-stripping the normalised CSV applies is a later convert/fold step,
 * deliberately NOT run on the raw layer - mirroring how the register loader
 * keeps raw date tokens un-normalised. The epistemic caveats (counts are of
 * licences ISSUED not held; pre-2003 refused under s.12; pre-lifetime figures
 * bundle CB and Maritime; the business-radio column is part of the disclosed
 * assertion) ride at the entry/meta level and are never editorialised into a
 * claim.
 */

import * as fs from 'fs';
import * as path from 'path';
import { type SourceObservationSet } from '../claim.ts';
import { listFoiEntryKeys, readFoiEntryMeta, defaultFoiDir, type FoiEntryMeta } from '../../shared/foi-archive.ts';
import { FOI_ENTRY_CONVERSIONS, parseMarkdownTable, type FoiSourceConversion } from '../../shared/foi-normalise.ts';
import type { LedgerCollector, ResolvedLedgerSource } from './types.ts';
import { jsonlStem } from './util.ts';

// The dataset class marking an aggregate-count disclosure: counts per reporting
// period, no per-row callsign at all. These entries are already EXCLUDED from
// the register fold (foi-register.ts EXCLUDED_CLASSES), so this family and the
// register families are disjoint by construction and no source is emitted
// twice.
export const STATISTICS_AGGREGATE_CLASS = 'statistics-aggregate';

// The authored OUTPUT role naming the aggregate subject: the reporting-period
// label. Used only to LOCATE the subject column in the authored binding (whose
// verbatim source header then becomes the subjectColumn) - a binding lacking a
// verbatim period column is a new aggregate shape deserving a reviewed
// converter change, never a guess. The role name itself never reaches the
// ledger: predicates are the table's verbatim headers (issue #813 Stage C1).
const PERIOD_OUTPUT = 'period';

// Format marking a source transcribed from a PDF into a committed markdown
// table. A statistics aggregate is always PDF-sourced, so only markdown-table
// conversions are aggregate sources.
const MARKDOWN_TABLE_FORMAT = 'markdown-table';

export interface StatisticsEntry {
  entry: string;
  meta: FoiEntryMeta;
}

// The statistics-aggregate entries: 'statistics-aggregate' present in
// datasetClasses. Sorted for a stable, reproducible corpus order
// (listFoiEntryKeys is sorted).
export function statisticsEntries(foiDir: string = defaultFoiDir()): StatisticsEntry[] {
  const entries: StatisticsEntry[] = [];
  for (const entry of listFoiEntryKeys(foiDir)) {
    const meta = readFoiEntryMeta(foiDir, entry);
    if (!meta.datasetClasses.includes(STATISTICS_AGGREGATE_CLASS)) continue;
    entries.push({ entry, meta });
  }
  return entries;
}

// The markdown-table aggregate sources bound to one entry, read from the
// authored converter binding (FOI_ENTRY_CONVERSIONS) so the raw file is never
// re-guessed. A statistics aggregate is transcribed from a response-letter PDF
// into a committed raw-extract markdown table, so only the markdown-table
// conversions are aggregate sources.
export function statisticsSourcesFor(meta: FoiEntryMeta): FoiSourceConversion[] {
  const variant = meta.converter?.variant;
  if (variant === undefined || variant === null) return [];
  const conversions = FOI_ENTRY_CONVERSIONS[variant];
  if (conversions === undefined) return [];
  return conversions.filter(conversion => conversion.format === MARKDOWN_TABLE_FORMAT);
}

// Parse one aggregate markdown-table source into the SourceObservationSet shape.
// Reads the RAW extract bytes (never the normalised CSV) and parses them with
// the SAME markdown-table parser the FOI converter uses, so the rows this
// runner keys off are the rows the committed normalisation was derived from.
// Cells are carried VERBATIM as that parser returns them (thousands separators
// intact), keyed by the table's OWN headers in source order (issue #813 Stage
// C1) - the ledger predicates read the published 'Amateur Radio' header, never
// the authored output name - and the subject column is the verbatim period
// header, boundary qualifier and all. The authored binding still gates the
// shape: every source header it asserts must be present, and it must name a
// period column, so a changed extract fails loudly rather than emitting under
// a silently different vocabulary.
export function loadStatisticsSource(foiDir: string, entry: string, meta: FoiEntryMeta, conversion: FoiSourceConversion): SourceObservationSet {
  const filePath = path.join(foiDir, entry, conversion.sourceFile);
  const text = fs.readFileSync(filePath).toString(conversion.encoding);
  const parsed = parseMarkdownTable(text, conversion.sourceFile);
  if (parsed.length === 0) {
    throw new Error(`${filePath}: parsed to zero rows - a statistics source must not be empty`);
  }

  // Every authored source header must be present in the parsed extract - a
  // missing column is a changed extract shape, failed loudly rather than
  // silently emitting blanks.
  const columns = Object.keys(parsed[0]);
  for (const spec of conversion.columns) {
    if (spec.source === null) continue;
    if (!columns.includes(spec.source)) {
      throw new Error(`${filePath}: authored source header "${spec.source}" absent from the extract headers (${columns.join(', ')})`);
    }
  }

  // The subject is the VERBATIM header the authored binding maps to the period
  // output role - located via the binding, carried as published.
  const periodHeader = conversion.columns.find(spec => spec.output === PERIOD_OUTPUT)?.source ?? null;
  if (periodHeader === null) {
    throw new Error(`${filePath}: authored binding carries no verbatim "${PERIOD_OUTPUT}" column - not a recognised aggregate shape`);
  }

  return {
    sourceFile: `foi/${entry}/${conversion.sourceFile}`,
    vintage: meta.dataVintage ?? '',
    columns,
    subjectColumn: periodHeader,
    rows: parsed,
    // The reconstruction routing (issue #813 Stage C1): the true on-disk path
    // and decode encoding, so reconstructionResultFor rebuilds the extract's
    // table region through the markdown serialiser from this family's claims.
    repoPath: `archive/foi/${entry}/${conversion.sourceFile}`,
    encoding: conversion.encoding,
  };
}

// The statistics-aggregate family: every statistics-aggregate FOI entry's
// markdown-table aggregate sources, each resolved to a loader over the entry's
// RAW extract bytes.
export function collectStatisticsSources(foiDir: string = defaultFoiDir()): ResolvedLedgerSource[] {
  const resolved: ResolvedLedgerSource[] = [];
  for (const { entry, meta } of statisticsEntries(foiDir)) {
    for (const conversion of statisticsSourcesFor(meta)) {
      resolved.push({
        family: 'statistics-aggregate',
        subjectKind: 'aggregate',
        entry,
        sourceFile: `foi/${entry}/${conversion.sourceFile}`,
        jsonlStem: jsonlStem('statistics', entry, conversion.sourceFile),
        load: () => loadStatisticsSource(foiDir, entry, meta, conversion),
      });
    }
  }
  return resolved;
}

export const statisticsCollector: LedgerCollector = {
  family: 'statistics-aggregate',
  subjectKind: 'aggregate',
  collect: roots => collectStatisticsSources(roots.foiDir),
};
