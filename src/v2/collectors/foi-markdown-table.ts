/**
 * The FOI markdown-table reconstruction family (issue #434 Phase 3 / E3): a
 * STRUCTURE-PRESERVING mirror of the FOI sources transcribed from a PDF into a
 * committed markdown table (raw-extract-*.md), so the reconstruction oracle
 * (src/ci/reconstruction-oracle.ts) can round-trip their TABLE REGION.
 *
 * Why a separate family. The issuance-events family also ingests its markdown
 * table, but reprojects the columns into its own output vocabulary and drops
 * the columns its dataset does not carry (the s.40-withheld name columns of
 * the transfers table). That projection cannot rebuild the source's own table.
 * This family instead lifts parseMarkdownTable WHOLE - every column the table
 * holds, in source order, verbatim - which is the fidelity input the oracle
 * needs.
 *
 * NARROWED SCOPE (issue #813 Stages C1/C2). A statistics-aggregate or
 * issuance-events entry contributes NOTHING here: the registered
 * statistics-aggregate family (Stage C1) and the registered issuance-events
 * family (Stage C2) now emit their markdown tables losslessly into the main
 * ledger itself (verbatim headers - the transfers table's s.40 'S40' marker
 * columns included - with repoPath/encoding attested), so the oracle
 * reconstructs them from the REGISTERED claims and carrying them here again
 * would double-count their structure. On the current archive this family's
 * resolution is therefore EMPTY; the module survives only until Stage D
 * deletes it, so the loader stays available to the transition-equality tests
 * that pinned each hand-over.
 *
 * SCOPE (design E4). Only the single `|`-delimited table BLOCK is a dataset; the
 * surrounding prose (the FOI covering-letter body, transcription notes) is
 * explicitly OUTSIDE the ledger's fidelity claim and is neither ingested here nor
 * reconstructed. The oracle compares the table region only, modulo cell-padding
 * and separator dash-count. Whole-file markdown fidelity (storing the prose as a
 * verbatim blob) is a separate, heavier decision, deliberately not taken here.
 *
 * This family is NOT registered in the main ledger (collectors/index.ts): it is a
 * parallel faithful projection consumed only by the reconstruction oracle, so it
 * never double-counts the rows the analytical families already emit.
 */

import * as fs from 'fs';
import * as path from 'path';
import { type SourceObservationSet } from '../claim.ts';
import { listFoiEntryKeys, readFoiEntryMeta, defaultFoiDir, type FoiEntryMeta } from '../../shared/foi-archive.ts';
import { FOI_ENTRY_CONVERSIONS, parseMarkdownTable, type FoiSourceConversion } from '../../shared/foi-normalise.ts';
import type { ResolvedLedgerSource } from './types.ts';
import { jsonlStem } from './util.ts';
import { STATISTICS_AGGREGATE_CLASS } from './statistics.ts';
import { ISSUANCE_EVENTS_CLASS } from './issuance-events.ts';

// The format marking a source transcribed from a PDF into a committed markdown
// table; every such conversion is a reconstruction source for this family.
const MARKDOWN_TABLE_FORMAT = 'markdown-table';

// The markdown-table conversions bound to one entry, read from the authored
// converter binding (FOI_ENTRY_CONVERSIONS) so the raw file is never re-guessed.
// A statistics-aggregate or issuance-events entry contributes nothing: its
// markdown tables are lossless-canonical in the main ledger via the registered
// statistics-aggregate (issue #813 Stage C1) / issuance-events (Stage C2)
// family, so exactly one family carries their structure.
export function markdownTableSourcesFor(meta: FoiEntryMeta): FoiSourceConversion[] {
  if (meta.datasetClasses.includes(STATISTICS_AGGREGATE_CLASS)) return [];
  if (meta.datasetClasses.includes(ISSUANCE_EVENTS_CLASS)) return [];
  const variant = meta.converter?.variant;
  if (variant === undefined || variant === null) return [];
  const conversions = FOI_ENTRY_CONVERSIONS[variant];
  if (conversions === undefined) return [];
  return conversions.filter(conversion => conversion.format === MARKDOWN_TABLE_FORMAT);
}

// Parse one markdown-table source into a STRUCTURE-PRESERVING SourceObservationSet
// over the single table block: the table's OWN header verbatim (every column, in
// source order - including any the datasets built on it drop), the first column
// as the subject, and one row per table data row keyed by those headers. The
// prose around the table is not carried (design E4). No line numbers or furniture
// are attested: the markdown serialiser renders a canonical table ordered by the
// ordinal, so positional placement is neither available nor needed.
export function loadFoiMarkdownTableSource(foiDir: string, entry: string, meta: FoiEntryMeta, conversion: FoiSourceConversion): SourceObservationSet {
  const filePath = path.join(foiDir, entry, conversion.sourceFile);
  const text = fs.readFileSync(filePath).toString(conversion.encoding);
  const records = parseMarkdownTable(text, conversion.sourceFile);
  if (records.length === 0) {
    throw new Error(`${filePath}: markdown table parsed to zero data rows - a reconstruction source must not be empty`);
  }
  const columns = Object.keys(records[0]);
  return {
    sourceFile: `foi/${entry}/${conversion.sourceFile}`,
    vintage: meta.dataVintage ?? '',
    columns,
    // The first table column is the subject: the period label / Con Id the table
    // is keyed on. Any column would serve (the reconstruction places it by the
    // manifest, not by position); the first is the self-evident, always-present
    // choice.
    subjectColumn: columns[0],
    rows: records,
    repoPath: `archive/foi/${entry}/${conversion.sourceFile}`,
    encoding: 'utf8',
  };
}

// The markdown-table reconstruction family: every FOI entry's markdown-table
// sources, each resolved to a loader over the entry's committed extract bytes.
export function collectFoiMarkdownTableSources(foiDir: string = defaultFoiDir()): ResolvedLedgerSource[] {
  const resolved: ResolvedLedgerSource[] = [];
  for (const entry of listFoiEntryKeys(foiDir)) {
    const meta = readFoiEntryMeta(foiDir, entry);
    for (const conversion of markdownTableSourcesFor(meta)) {
      resolved.push({
        family: 'foi-markdown-table',
        // Inert here: the reconstruction oracle emits raw claims only and never
        // branches on subjectKind.
        subjectKind: 'aggregate',
        entry,
        jsonlStem: jsonlStem('recon-md', entry, conversion.sourceFile),
        load: () => loadFoiMarkdownTableSource(foiDir, entry, meta, conversion),
      });
    }
  }
  return resolved;
}
