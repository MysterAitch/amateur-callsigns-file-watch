/**
 * The issuance-events family: FOI entries whose datasetClasses carry
 * 'issuance-events' (archive/foi/**) - disclosures of dated licensing EVENTS,
 * one row per event: a call sign paired with the date it was re-issued,
 * issued a reciprocal licence, or reallocated. Keyed off the AUTHORED converter
 * binding (FOI_ENTRY_CONVERSIONS in foi-normalise.ts), so the raw file, the
 * carried columns and the authored event vocabulary are never re-guessed.
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
 * NOT conflated with register STATE, despite sharing the callsign subject. An
 * issuance event is a different assertion from a register snapshot: this family
 * carries an authored `event` classification and an `event_date`, NOT a register
 * `status`, and it derives NO licence_category tier (categoryColumn is left
 * unset), so it never acquires register-state semantics. The `family:
 * 'issuance-events'` tag plus per-source provenance (sourceFile) keep an event
 * observation distinct from a register-snapshot observation even where both name
 * the same call sign.
 *
 * VERBATIM tokens, load-bearing dates. The call sign and the event_date travel
 * exactly as published - the Ofcom exports carry stored 23:00:00 timezone
 * artefacts (e.g. '2010-05-19 23:00:00') and the WDTK transfers table carries
 * day-first dates ('28/01/2015'); both are read from the RAW bytes and never
 * ISO-normalised or day-rounded here (that reshaping is the committed converter's
 * later step). The event date and the entry vintage carry the whole temporal
 * assertion and are preserved on every claim. The `event` value is the authored
 * constant the converter binding pins from the disclosure's own covering-letter
 * wording ('reissued' / 'reciprocal-licence-issued' / 'reallocated'); it rides as
 * an attribute claim so the three sources stay distinguishable at claim level
 * rather than collapsing to indistinguishable call-sign-and-date rows.
 *
 * Two raw shapes, both driven by the authored binding: the two 2017 Ofcom
 * workbook extracts are CSV (raw-extract-sheet-1-sheet1.csv); the 2015 WDTK
 * heritage-transfers table is a PDF transcribed into a committed markdown table
 * (raw-extract-applicants-old-call-signs.md, format 'markdown-table', parsed with
 * the same parseMarkdownTable the FOI converter uses). The WDTK entry also
 * carries the reference-context and attribute-addendum classes, but its variant
 * binds only the transfers table, and that markdown-table shape is skipped by the
 * register machinery (registerSourcesFor drops markdown-table), so the
 * attribute-addendum family does not emit it - this family is its sole emitter
 * and no source is emitted twice.
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

// The output columns that DEFINE an issuance-events source shape: a verbatim
// call-sign subject, an authored event classification, and the event date. A
// conversion carrying all three is an issuance-events source; anything else
// bound to the same variant (a register or reference table) is not, so a
// multi-class entry contributes only its event-shaped source(s).
const CALLSIGN_OUTPUT = 'callsign';
const EVENT_OUTPUT = 'event';
const EVENT_DATE_OUTPUT = 'event_date';

// Format marking a source transcribed from a PDF into a committed markdown
// table; anything else is parsed as CSV (the FoiSourceConversion default).
const MARKDOWN_TABLE_FORMAT = 'markdown-table';

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

// Parse the raw bytes into records keyed by the source's own headers, honouring
// the conversion's format (CSV or a committed markdown-table transcription). The
// parse mirrors the FOI converter's own reading of each shape, so the rows this
// runner keys off are the rows the committed normalisation was derived from.
function parseRawRecords(filePath: string, conversion: FoiSourceConversion): Record<string, string>[] {
  const text = fs.readFileSync(filePath).toString(conversion.encoding);
  if (conversion.format === MARKDOWN_TABLE_FORMAT) {
    return parseMarkdownTable(text, conversion.sourceFile);
  }
  return parse(text, { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];
}

// Parse one issuance-events source into the SourceObservationSet shape. Reads
// the RAW bytes (never the normalised CSV) and carries every bound output
// column: a source-backed column takes the raw cell VERBATIM (call sign and
// event_date included, timezone/day-first artefacts intact); a source-null
// column takes the authored constant the binding pins (the `event` vocabulary).
// Columns the binding ignores (the s.40-withheld name columns) are not bound and
// so never carried. The subject is the call sign; no product/categoryColumn is
// set, so the emit path derives the callsign normalisation edges but NOT a
// register licence_category tier.
export function loadIssuanceEventsSource(foiDir: string, entry: string, meta: FoiEntryMeta, conversion: FoiSourceConversion): SourceObservationSet {
  const filePath = path.join(foiDir, entry, conversion.sourceFile);
  const records = parseRawRecords(filePath, conversion);
  if (records.length === 0) {
    throw new Error(`${filePath}: parsed to zero rows - an issuance-events source must not be empty`);
  }

  // Every source-backed header the binding names must be present in the raw
  // records - a missing header is a changed source shape, failed loudly rather
  // than silently emitting blanks.
  const rawHeaders = Object.keys(records[0]);
  for (const column of conversion.columns) {
    if (column.source === null) continue;
    if (!rawHeaders.includes(column.source)) {
      throw new Error(`${filePath}: authored source header "${column.source}" absent from the raw headers (${rawHeaders.join(', ')})`);
    }
  }

  const columns = conversion.columns.map(column => column.output);
  const rows = records.map(record => {
    const row: Record<string, string> = {};
    for (const column of conversion.columns) {
      row[column.output] = column.source === null
        ? (column.constant ?? '')
        : (record[column.source] ?? '');
    }
    return row;
  });

  return {
    sourceFile: `foi/${entry}/${conversion.sourceFile}`,
    vintage: meta.dataVintage ?? '',
    columns,
    subjectColumn: CALLSIGN_OUTPUT,
    rows,
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
