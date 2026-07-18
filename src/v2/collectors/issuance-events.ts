/**
 * The issuance-events family: FOI entries whose datasetClasses carry
 * 'issuance-events' (archive/foi/**) - disclosures of dated licensing EVENTS,
 * one row per event: a call sign paired with the date it was re-issued,
 * issued a reciprocal licence, or reallocated. Keyed off the AUTHORED converter
 * binding (FOI_ENTRY_CONVERSIONS in foi-normalise.ts), so the raw file, the
 * expected columns and the authored event vocabulary are never re-guessed.
 *
 * SUBJECT KIND is 'callsign'. Read from the raw bytes, every subject cell is a
 * genuine amateur call sign (e.g. G7DMN, M0GRT, G8JC) - the "T-Number" in the
 * Ofcom column header labels the export, not the disclosed values. So the
 * standard callsign derived layer (cleanedCallsign + normalises_to edges) is the
 * HONEST fit: it lets an issuance event JOIN into the call sign namespace, so a
 * consumer can ask which register call signs had a re-issue / reciprocal /
 * reallocation event and when. Routing through emitLedger (the callsign guard in
 * build-ledger.ts) is therefore correct.
 *
 * LOSSLESS-CANONICAL, VERBATIM HEADERS (issue #813 Stage C2). The family emits
 * the source's WHOLE published structure: every physical column under the
 * publisher's OWN header - including the transfers table's three s.40-withheld
 * name columns, whose 'S40' marker cells are published bytes the transparency
 * posture must carry, and the raw callsign header ('Call Sign T-Number' /
 * 'Call Signs') as the subject column, placed by the file-level manifest's
 * @subject claim rather than by position. The old emit reprojected rows into
 * the authored OUTPUT names (dropping the S40 columns and presenting authored
 * spellings at the layer documented as As-published - the live mis-presentation
 * the #831 audit confirmed); the raw layer now carries published bytes only.
 * The CSV sources attest per-row line numbers, header line and repoPath/
 * encoding, so the reconstruction oracle (src/ci/reconstruction-oracle.ts)
 * rebuilds them from this family's persisted claims; the markdown transfers
 * table attests repoPath/encoding and reconstructs through the markdown
 * serialiser (table region only), retiring the foi-markdown-table mirror's
 * last scope.
 *
 * THE AUTHORED `event` WORD IS DERIVED, NOT RAW (Stage C2's semantic
 * correction). The event classification ('reissued' / 'reciprocal-licence-
 * issued' / 'reallocated') is the constant the converter binding pins from each
 * disclosure's own covering-letter wording - an authored word, not a published
 * cell - so it rides as ONE DERIVED CLAIM PER ROW under AUTHORED_EVENT_RULE
 * (issuance-event-emit.ts, reading out Looked-up), never as a raw claim. The
 * event DATE stays raw under its verbatim header ('Original Start Date' /
 * 'Start date') - one raw claim per published cell, never two.
 *
 * NOT conflated with register STATE, despite sharing the callsign subject. An
 * issuance event is a different assertion from a register snapshot: no
 * categoryColumn / originalStartDateColumn is set (the disclosed date is an
 * EVENT date, not register state), so the family derives NO licence_category
 * tier and no register-date parse flag. The `family: 'issuance-events'` tag
 * plus per-source provenance (sourceFile) keep an event observation distinct
 * from a register-snapshot observation even where both name the same call sign.
 *
 * VERBATIM tokens, load-bearing dates. The call sign and the event date travel
 * exactly as published - the Ofcom exports carry stored 23:00:00 timezone
 * artefacts (e.g. '2010-05-19 23:00:00') and the WDTK transfers table carries
 * day-first dates ('28/01/2015'); both are read from the RAW bytes and never
 * ISO-normalised or day-rounded here (that reshaping is the committed
 * converter's later step). The event date and the entry vintage carry the whole
 * temporal assertion and are preserved on every claim.
 *
 * Two raw shapes, both gated by the authored binding: the two 2017 Ofcom
 * workbook extracts are CSV (raw-extract-sheet-1-sheet1.csv); the 2015 WDTK
 * heritage-transfers table is a PDF transcribed into a committed markdown table
 * (raw-extract-applicants-old-call-signs.md, format 'markdown-table', parsed
 * with the same parseMarkdownTable the FOI converter uses). The WDTK entry also
 * carries the reference-context and attribute-addendum classes, but its variant
 * binds only the transfers table, and that markdown-table shape is skipped by
 * the register machinery (registerSourcesFor drops markdown-table), so the
 * attribute-addendum family does not emit it - this family is its sole emitter
 * and no source is emitted twice (the corpus-wide sole-emitter invariant,
 * build-ledger.test.ts).
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { type SourceObservationSet } from '../claim.ts';
import { listFoiEntryKeys, readFoiEntryMeta, defaultFoiDir, type FoiEntryMeta } from '../../shared/foi-archive.ts';
import { FOI_ENTRY_CONVERSIONS, parseMarkdownTable, type FoiSourceConversion } from '../../shared/foi-normalise.ts';
import type { LedgerCollector, ResolvedLedgerSource } from './types.ts';
import { jsonlStem } from './util.ts';

// The dataset class marking an issuance-events disclosure. Selected by class
// (not a hard-coded entry list) so a newly-classed disclosure is covered
// automatically, exactly as the register/addendum families select.
export const ISSUANCE_EVENTS_CLASS = 'issuance-events';

// The authored OUTPUT roles that DEFINE an issuance-events source shape: a
// verbatim call-sign subject, an authored event classification, and the event
// date. A conversion carrying all three is an issuance-events source; anything
// else bound to the same variant (a register or reference table) is not, so a
// multi-class entry contributes only its event-shaped source(s). The role
// names are used only to LOCATE columns in the authored binding - they never
// reach the ledger's raw layer, whose predicates are the source's own verbatim
// headers (issue #813 Stage C2).
const CALLSIGN_OUTPUT = 'callsign';
const EVENT_OUTPUT = 'event';
const EVENT_DATE_OUTPUT = 'event_date';

// Format marking a source transcribed from a PDF into a committed markdown
// table; anything else is parsed as CSV (the FoiSourceConversion default).
const MARKDOWN_TABLE_FORMAT = 'markdown-table';

// One physical CSV record beside csv-parse's own 1-based physical-line tally,
// so the header line and the data-row lines are stored facts (issue #431),
// never inferred from row order - the same discipline as the verbatim-CSV
// family (foi-verbatim-csv.ts).
interface PhysicalRow {
  record: string[];
  info: { lines: number };
}

export interface IssuanceEventsEntry {
  entry: string;
  meta: FoiEntryMeta;
}

// The issuance-events entries: 'issuance-events' present in datasetClasses.
// Sorted for a stable, reproducible corpus order (listFoiEntryKeys is sorted).
export function issuanceEventsEntries(foiDir: string = defaultFoiDir()): IssuanceEventsEntry[] {
  const entries: IssuanceEventsEntry[] = [];
  for (const entry of listFoiEntryKeys(foiDir)) {
    const meta = readFoiEntryMeta(foiDir, entry);
    if (!meta.datasetClasses.includes(ISSUANCE_EVENTS_CLASS)) continue;
    entries.push({ entry, meta });
  }
  return entries;
}

// True when a conversion has the issuance-events output shape: a call-sign
// subject mapped verbatim from a raw header, an authored event column, and an
// event-date column. Reading the shape off the authored binding (rather than
// trusting the entry's class alone) means a multi-class entry contributes only
// its event source(s), and a re-shaped binding fails to match rather than being
// mis-emitted.
function isIssuanceEventsSource(conversion: FoiSourceConversion): boolean {
  const callsignSpec = conversion.columns.find(column => column.output === CALLSIGN_OUTPUT);
  const hasCallsign = callsignSpec !== undefined && callsignSpec.source !== null && callsignSpec.kind === 'verbatim';
  const hasEvent = conversion.columns.some(column => column.output === EVENT_OUTPUT);
  const hasEventDate = conversion.columns.some(column => column.output === EVENT_DATE_OUTPUT);
  return hasCallsign && hasEvent && hasEventDate;
}

// The issuance-events sources bound to one entry, read from the authored
// converter binding (FOI_ENTRY_CONVERSIONS) so the raw file is never re-guessed.
export function issuanceEventsSourcesFor(meta: FoiEntryMeta): FoiSourceConversion[] {
  const variant = meta.converter?.variant;
  if (variant === undefined || variant === null) return [];
  const conversions = FOI_ENTRY_CONVERSIONS[variant];
  if (conversions === undefined) return [];
  return conversions.filter(isIssuanceEventsSource);
}

// The verbatim source header the authored binding maps to the call-sign role -
// the subject column of the lossless emit. A binding without one is not a
// recognised issuance shape (isIssuanceEventsSource would have rejected it);
// failing loudly here keeps the invariant local and explicit.
function callsignHeaderOf(conversion: FoiSourceConversion, filePath: string): string {
  const callsignSpec = conversion.columns.find(column => column.output === CALLSIGN_OUTPUT);
  const header = callsignSpec?.source ?? null;
  if (header === null) {
    throw new Error(`${filePath}: authored binding carries no verbatim "${CALLSIGN_OUTPUT}" column - not a recognised issuance-events shape`);
  }
  return header;
}

// The authored event constant the binding pins from the disclosure's
// covering-letter wording. Required non-empty: an issuance source without an
// event vocabulary is a changed binding shape, failed loudly.
function authoredEventOf(conversion: FoiSourceConversion, filePath: string): string {
  const eventSpec = conversion.columns.find(column => column.output === EVENT_OUTPUT && column.source === null);
  const event = eventSpec?.constant ?? '';
  if (event === '') {
    throw new Error(`${filePath}: authored binding pins no "${EVENT_OUTPUT}" constant - the covering-letter event vocabulary is required`);
  }
  return event;
}

// Every header the authored binding names - the mapped source columns AND the
// deliberately-ignored ones (the transfers table's s.40-withheld name columns) -
// must be present in the raw headers: a missing header is a changed source
// shape, failed loudly rather than silently emitting a different structure.
function assertBoundHeadersPresent(conversion: FoiSourceConversion, rawHeaders: readonly string[], filePath: string): void {
  const bound = [
    ...conversion.columns.flatMap(column => (column.source === null ? [] : [column.source])),
    ...conversion.ignoredColumns.map(spec => spec.column),
  ];
  for (const header of bound) {
    if (!rawHeaders.includes(header)) {
      throw new Error(`${filePath}: authored source header "${header}" absent from the raw headers (${rawHeaders.join(', ')})`);
    }
  }
}

// Parse one issuance-events source into a STRUCTURE-PRESERVING
// SourceObservationSet (issue #813 Stage C2): the source's own header set
// verbatim (every physical column, in source order - the s.40 'S40' marker
// columns included), rows keyed by those headers with every cell carried
// verbatim (call sign and event date included, timezone/day-first artefacts
// intact), the verbatim call-sign header as the subject, and the authored
// event constant attested as `authoredEvent` for the DERIVED tier - never a
// raw claim. Reads the RAW bytes (never the normalised CSV); the authored
// binding gates the shape but contributes no spellings to the raw layer.
export function loadIssuanceEventsSource(foiDir: string, entry: string, meta: FoiEntryMeta, conversion: FoiSourceConversion): SourceObservationSet {
  const filePath = path.join(foiDir, entry, conversion.sourceFile);
  const common = {
    sourceFile: `foi/${entry}/${conversion.sourceFile}`,
    vintage: meta.dataVintage ?? '',
    authoredEvent: authoredEventOf(conversion, filePath),
    // The reconstruction routing (issue #813 Stage C2): the true on-disk path
    // and decode encoding, so reconstructionResultFor rebuilds the source from
    // this family's persisted claims.
    repoPath: `archive/foi/${entry}/${conversion.sourceFile}`,
    encoding: conversion.encoding,
  };
  const subjectColumn = callsignHeaderOf(conversion, filePath);
  const text = fs.readFileSync(filePath).toString(conversion.encoding);

  if (conversion.format === MARKDOWN_TABLE_FORMAT) {
    // The markdown lane (the wdtk-251507 transfers table): the SAME
    // markdown-table parser the FOI converter uses, whole - every column, in
    // source order. No line numbers are attested: the markdown serialiser
    // renders a canonical table ordered by the ordinal, so positional
    // placement is neither available nor needed (the statistics-aggregate
    // precedent, issue #813 Stage C1).
    const records = parseMarkdownTable(text, conversion.sourceFile);
    if (records.length === 0) {
      throw new Error(`${filePath}: parsed to zero rows - an issuance-events source must not be empty`);
    }
    const columns = Object.keys(records[0]);
    assertBoundHeadersPresent(conversion, columns, filePath);
    return { ...common, columns, subjectColumn, rows: records };
  }

  // The CSV lane (the two 2017 Ofcom workbook extracts): columns:false +
  // info:true yields each physical record beside its 1-based end-of-record
  // source line (skip_empty_lines still counts skipped lines in that tally),
  // so the header line and every data row's line are stored facts and the
  // reconstruction places them positionally (issue #431).
  const parsed = parse(text, { columns: false, skip_empty_lines: true, bom: true, info: true }) as unknown as PhysicalRow[];
  const headerRow = parsed[0];
  if (headerRow === undefined) {
    throw new Error(`${filePath}: no header row`);
  }
  const columns = headerRow.record;
  if (new Set(columns).size !== columns.length) {
    throw new Error(`${filePath}: duplicate header names (${columns.join(', ')}) - a verbatim emit cannot key rows unambiguously`);
  }
  assertBoundHeadersPresent(conversion, columns, filePath);
  const dataRows = parsed.slice(1);
  if (dataRows.length === 0) {
    throw new Error(`${filePath}: parsed to zero rows - an issuance-events source must not be empty`);
  }
  const rows = dataRows.map(physical =>
    Object.fromEntries(columns.map((header, index) => [header, physical.record[index] ?? ''])));
  return {
    ...common,
    columns,
    subjectColumn,
    rows,
    lineNumbers: dataRows.map(physical => physical.info.lines),
    headerLine: headerRow.info.lines,
  };
}

// The issuance-events family: every issuance-events FOI entry's event-shaped
// sources, each resolved to a loader over the entry's RAW bytes.
export function collectIssuanceEventsSources(foiDir: string = defaultFoiDir()): ResolvedLedgerSource[] {
  const resolved: ResolvedLedgerSource[] = [];
  for (const { entry, meta } of issuanceEventsEntries(foiDir)) {
    for (const conversion of issuanceEventsSourcesFor(meta)) {
      resolved.push({
        family: 'issuance-events',
        subjectKind: 'callsign',
        entry,
        jsonlStem: jsonlStem('issuance', entry, conversion.sourceFile),
        load: () => loadIssuanceEventsSource(foiDir, entry, meta, conversion),
      });
    }
  }
  return resolved;
}

export const issuanceEventsCollector: LedgerCollector = {
  family: 'issuance-events',
  subjectKind: 'callsign',
  collect: roots => collectIssuanceEventsSources(roots.foiDir),
};
