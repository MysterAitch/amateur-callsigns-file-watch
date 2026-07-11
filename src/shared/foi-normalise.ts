/**
 * FOI-lane normalisers (issue #139, tiers 1-2): deterministic converters for
 * the CSV-native FOI entries and for tables transcribed into committed
 * raw-extract-*.md files, per ADR 0004's derivation chain
 * (raw data file [-> raw-extract-*.md] -> normalised--<slug>.csv, converter
 * binding authored in the entry's meta.json).
 *
 * Principles (issue #139):
 *  - Normalise the source's ASSERTION only, never an inferred complement.
 *    Every output row is an observation: this source, at this vintage,
 *    asserts this callsign has this status. Blank statuses are data and are
 *    preserved as empty strings.
 *  - Canonicalise nothing except trimming leading/trailing whitespace
 *    (including non-breaking spaces), and even that is counted in the
 *    converter's notes rather than applied silently. Case is never changed:
 *    the sources are not uniformly uppercase (g0jrk, 2e1GTD exist) and a
 *    case change would invent an assertion the source did not make.
 *  - Columns are identified by header NAME, never by position - a source
 *    column reorder cannot silently change what a column means or what the
 *    sort key is (the sort-key vulnerability fix).
 *  - Outputs are byte-deterministic: LF endings, UTF-8 without BOM, minimal
 *    RFC-4180 quoting (shared renderCsv), codepoint sorting only where the
 *    source row order is not meaningful.
 *
 * Run as a CLI to regenerate an entry's normalised files:
 *   node src/shared/foi-normalise.ts archive/foi/<entry-key> [...]
 * The entry's meta.json must carry the authored converter binding
 * ({script, variant}); the CLI writes the normalised--*.csv files and prints
 * the notes (trim/NBSP counts, blank counts, day-first date evidence) plus
 * the bytes/sha256 to record in meta.json's files map.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { parseUkDateTimeDetailed, type ParsedUkDateTime, renderCsv, codepointCompare } from './normalise.ts';
import { calculateContentHash, errorMessage } from './utils.ts';

export const FOI_NORMALISED_SCHEMA_VERSION = 1;

// Plausibility floor shared with the open-data lane: UK wireless licensing
// began in the early 1900s (the 2019 register genuinely opens at
// 03/05/1903, a presumed migration placeholder but on the record); anything
// before 1900 indicates corruption, not history.
const MIN_PLAUSIBLE_YEAR = 1900;

export interface FoiColumnSpec {
  // Exact source header this output column reads from, or null when the
  // source does not assert the column at all - it is then emitted empty
  // (or as the authored constant) so the dataset class keeps its stable
  // core schema (issue #139: core columns callsign,status,licence_class
  // for callsign-observation rows; callsign,event_date,event for
  // issuance-events rows).
  source: string | null;
  output: string;
  // 'count' is a strictly-formatted integer (optionally with well-formed
  // thousands separators) emitted as plain digits - the only reshaping is
  // separator removal, validated, never repaired.
  // 'iso-date' is a workbook-extract date already rendered ISO by
  // src/shared/xlsx-extract.ts (typed at source, so no day-first ambiguity ever
  // existed - no order-evidence stats are collected); validated and
  // plausibility-bounded, carried verbatim including stored time-of-day
  // artefacts.
  // 'prefixed' constructs the value from the authored prefix plus the cell
  // (the suffix-shaped available lists, whose sheets state their own prefix
  // rule - pinned by the verbatim header/preamble match).
  kind: 'verbatim' | 'date' | 'count' | 'iso-date' | 'prefixed';
  // Date columns describing a validity END (reservation expiries)
  // legitimately postdate the snapshot vintage; issuance/creation dates
  // never do. Only meaningful for kinds 'date' and 'iso-date'.
  futureAllowed?: boolean;
  // Authored constant emitted when source is null (e.g. the issuance-events
  // 'event' vocabulary, taken from the document's own wording). An
  // authored, reviewed value - never derived from row content.
  constant?: string;
  // Required for kind 'prefixed': the sheet's stated prefix.
  prefix?: string;
}

export interface FoiSourceConversion {
  // Exact filename of the source file within the entry directory - the raw
  // data file for 'csv' format, or the committed raw-extract-*.md
  // transcription for 'markdown-table' format.
  sourceFile: string;
  // How sourceFile's bytes are parsed into records. Defaults to 'csv'.
  format?: 'csv' | 'markdown-table';
  // For markdown-table conversions: the data file the extract transcribes
  // (the PDF). Names the normalised output, so the derivative is keyed to
  // the disclosed document rather than the transcription intermediary.
  dataFile?: string;
  // Authored decode decision: the wdtk sheets are UTF-8 with BOM; the
  // Ofcom-published register carries raw 0xA0 bytes (Windows-1252/latin-1
  // NBSP) that are not valid UTF-8.
  encoding: 'utf8' | 'latin1';
  // Rows expected BEFORE the header row (titles, prefix statements, blank
  // spacer rows), matched cell-for-cell - a changed preamble is a changed
  // assertion and must fail, never be skipped blindly. Presence of this
  // field (even empty) routes parsing through the explicit-header path,
  // which also supports sources whose header row contains empty names.
  preamble?: readonly (readonly string[])[];
  // Output column order; sources are matched by header NAME (order-insensitive).
  columns: readonly FoiColumnSpec[];
  // Source columns deliberately not carried into the normalised output.
  // Their presence is still REQUIRED (an absent or extra header means a
  // genuinely new source shape deserving review, never a guess).
  ignoredColumns: readonly string[];
  // 'sorted-by-first-column': source row order carries no meaning, so rows
  // sort by the first output column (codepoint order, whole-row tie-break).
  // 'source-order': the source order is itself meaningful and is preserved.
  rowOrder: 'sorted-by-first-column' | 'source-order';
  orderRationale: string;
  // Upper plausibility bound (inclusive) for date columns without
  // futureAllowed - the entry's data vintage. Required whenever the
  // conversion has date columns (enforced at convert time); omitted for
  // date-free conversions so variants can be shared across entries with
  // different response dates.
  referenceDateIso?: string;
}

// Conversion registry, keyed by the variant name authored in each entry's
// meta.json converter binding. One variant covers one entry's set of
// convertible source files (CSV-native data files, or committed
// raw-extract-*.md table transcriptions).
export const FOI_ENTRY_CONVERSIONS: Record<string, readonly FoiSourceConversion[]> = {
  // archive/foi/wdtk-1180568--licence-breakdown-duration-age (FOI 1900117,
  // vintage 2024-10; referenceDateIso is the response date, 2024-10-28).
  'wdtk-1180568-csv-pair': [
    {
      sourceFile: 'FOI 1900117 Radio amateur licence breakdown by duration held and age sheet 1.csv',
      encoding: 'utf8',
      columns: [
        { source: 'Value', output: 'callsign', kind: 'verbatim' },
        { source: 'Status', output: 'status', kind: 'verbatim' },
        // The sheet asserts no licence class; emitted empty to keep the
        // callsign-observation core schema stable.
        { source: null, output: 'licence_class', kind: 'verbatim' },
        // Reservation EXPIRY - future values are legitimate (2029 observed).
        { source: 'Reserved to Date', output: 'reserved_to_date', kind: 'date', futureAllowed: true },
      ],
      // 'Type' is 'Call Sign - Amateur' on every row - a product
      // discriminator recorded in meta.json's contentsIndicative, not a
      // per-row assertion.
      ignoredColumns: ['Type'],
      rowOrder: 'sorted-by-first-column',
      orderRationale: 'source rows arrive in no meaningful order; sorted by callsign for diffability',
      referenceDateIso: '2024-10-28',
    },
    {
      sourceFile: 'FOI 1900117 Radio amateur licence breakdown by duration held and age sheet 2.csv',
      encoding: 'utf8',
      columns: [
        { source: 'Call Sign', output: 'callsign', kind: 'verbatim' },
        { source: 'Status', output: 'status', kind: 'verbatim' },
        // Verbatim source vocabulary ('Amateur Foundation Radio Licence'),
        // never canonicalised to 'Foundation'.
        { source: 'Licence Type', output: 'licence_class', kind: 'verbatim' },
        { source: 'Created Date', output: 'created_date', kind: 'date' },
        { source: 'Original start date', output: 'original_start_date', kind: 'date' },
      ],
      ignoredColumns: [],
      rowOrder: 'sorted-by-first-column',
      orderRationale: 'source rows arrive in no meaningful order; sorted by callsign for diffability (duplicate callsigns are attribute rows for multiple licences and tie-break on the whole row)',
      referenceDateIso: '2024-10-28',
    },
  ],
  // archive/foi/ofcom-756622--published-register-csv (vintage 2019-09-12,
  // from the published filename).
  'ofcom-756622-register-and-forbidden': [
    {
      sourceFile: 'allocated-reserved-forbidden-call-sign-foi-20190912.csv',
      encoding: 'latin1',
      columns: [
        { source: 'Call Sign', output: 'callsign', kind: 'verbatim' },
        { source: 'Status', output: 'status', kind: 'verbatim' },
        { source: 'Licence Class', output: 'licence_class', kind: 'verbatim' },
        // The source header is literally 'Licence Issued Dat' - truncated
        // in the published file itself; matched verbatim, on the record.
        { source: 'Licence Issued Dat', output: 'licence_issued_date', kind: 'date' },
      ],
      ignoredColumns: [],
      rowOrder: 'source-order',
      orderRationale: 'source rows are ordered by Licence Issued Date ascending (blank dates last) - a meaningful publication order in the earliest known bulk disclosure of per-callsign issue dates; preserved verbatim',
      referenceDateIso: '2019-09-12',
    },
    {
      sourceFile: 'allocated-reserved-forbidden-call-sign.csv',
      encoding: 'latin1',
      columns: [
        // Three-letter SUFFIXES, not callsigns - the forbidden-list shape
        // (issue #139).
        { source: 'NAME', output: 'suffix', kind: 'verbatim' },
      ],
      ignoredColumns: [],
      rowOrder: 'sorted-by-first-column',
      orderRationale: 'alphabetical source order carries no meaning; sorted by suffix (a no-op for the archived file, kept for rule consistency)',
      referenceDateIso: '2019-09-12',
    },
  ],
  // archive/foi/wdtk-184767--annual-licence-counts (reference 1-246847147,
  // letter dated 2013-12-11): annual counts of licences ISSUED per financial
  // year, transcribed from the response-letter PDF. Wide shape kept as the
  // letter asserts it - one row per period, both services (consumers filter;
  // the business-radio figures are part of the disclosed assertion).
  'wdtk-184767-counts-table': [
    {
      sourceFile: 'raw-extract-number-of-licences-coleman.md',
      format: 'markdown-table',
      dataFile: 'Number of licences Coleman.pdf',
      encoding: 'utf8',
      columns: [
        // The header's own qualifier '(1 April - 31 March)' defines the
        // period boundaries; the label is carried verbatim rather than
        // expanded into invented start/end dates.
        { source: 'period (1 April – 31 March)', output: 'period', kind: 'verbatim' },
        { source: 'Amateur Radio', output: 'amateur_radio_licences_issued', kind: 'count' },
        { source: 'Business Radio', output: 'business_radio_licences_issued', kind: 'count' },
      ],
      ignoredColumns: [],
      rowOrder: 'source-order',
      orderRationale: "the letter's financial-year order is chronological and meaningful; preserved",
      referenceDateIso: '2013-12-11',
    },
  ],
  // archive/foi/wdtk-251507--reissue-policy (reference 1-278731481, letter
  // dated 2015-02-27): the last 20 heritage-callsign reallocations,
  // transcribed from 'applicants old call signs.pdf'. Event vocabulary
  // 'reallocated' is the covering letter's own word. Semantics caveat: the
  // source's Start date is the START DATE OF THE RECEIVING LICENCE, treated
  // here as the reallocation event date.
  'wdtk-251507-transfers-table': [
    {
      sourceFile: 'raw-extract-applicants-old-call-signs.md',
      format: 'markdown-table',
      dataFile: 'applicants old call signs.pdf',
      encoding: 'utf8',
      columns: [
        { source: 'Call Signs', output: 'callsign', kind: 'verbatim' },
        { source: null, output: 'event', kind: 'verbatim', constant: 'reallocated' },
        { source: 'Start date', output: 'event_date', kind: 'date' },
        // Verbatim source vocabulary ('Amateur Club Radio Licence' /
        // 'Amateur Full Radio Licence'), never canonicalised.
        { source: 'Licence Product', output: 'licence_class', kind: 'verbatim' },
        { source: 'Status', output: 'status', kind: 'verbatim' },
        { source: 'Reason', output: 'reason', kind: 'verbatim' },
        // Siebel-format identifiers, carried for cross-referencing against
        // other snapshots (attribute-addendum value).
        { source: 'Licence Number', output: 'licence_number', kind: 'verbatim' },
        { source: 'Con Id', output: 'con_id', kind: 'verbatim' },
      ],
      // Title/First_name/Last_name are 'S40' on every row - the document's
      // marker for names withheld under FOIA s.40. Withholding markers are
      // not data; presence still required.
      ignoredColumns: ['Title', 'First_name', 'Last_name'],
      rowOrder: 'source-order',
      orderRationale: "the document presents 'the last 20 applications' newest-first; a meaningful order, preserved",
      referenceDateIso: '2015-02-27',
    },
  ],

  // --- Workbook-extract variants (tier 3). Sources are the committed
  // raw-extract-sheet-*.csv files produced by src/shared/xlsx-extract.ts. ---

  // The 2013/14 suffix-shaped available lists (wdtk-174341 2013-09,
  // wdtk-197896 2014-03 - identical export shape, shared variant). Each
  // sheet's first row states its own prefix rule ('Foundation = M6aaa') and
  // is matched verbatim as the header; the callsign is that stated prefix
  // plus the listed suffix, the suffix is also carried verbatim, and
  // status/licence_class are authored per issue #139 (available lists
  // normalise to status=Available; sheet-level class populates
  // licence_class).
  'available-suffix-lists-2013-style': suffixListConversions([
    ['raw-extract-sheet-1-foundation.csv', 'Foundation = M6aaa', 'M6', 'Foundation'],
    ['raw-extract-sheet-2-intermediate.csv', 'Intermediate = 20aaa - Appropriate Secondary Regional Indicator applied only when licence issued', '20', 'Intermediate'],
    ['raw-extract-sheet-3-full.csv', 'Full = M0aaa', 'M0', 'Full'],
  ]),

  // The 2014-08 lists (wdtk-224333): a blank spacer row and a 'Prefix = M6'
  // statement precede a 'Suffix' header. The preamble is matched
  // cell-for-cell, pinning the prefix assertion.
  'wdtk-224333-prefix-suffix-lists': [
    prefixHeaderConversion('raw-extract-sheet-1-foundation.csv', 'M6', 'Foundation'),
    prefixHeaderConversion('raw-extract-sheet-2-intermediate.csv', '20', 'Intermediate'),
    prefixHeaderConversion('raw-extract-sheet-3-full.csv', 'M0', 'Full'),
  ],

  // The 2015 typed Siebel exports (wdtk-247308 2015-02, wdtk-261814
  // 2015-04 - shared shape). Country/Current Series are the callsign's own
  // decomposition (derivable), Type is 'Call Sign' throughout (two blank
  // cells in the Full sheets), Allocated Flag is 'N' throughout - required
  // present, not carried. A handful of Value cells are stored AS dates
  // (Excel's '20JUN' mangling at Ofcom's export) and are carried verbatim.
  'available-typed-export-8col': [
    typedExportConversion('raw-extract-sheet-1-foundation.csv', ['Country', 'Current Series', 'Type', 'Allocated Flag']),
    typedExportConversion('raw-extract-sheet-2-intermediate.csv', ['Country', 'Current Series', 'Type', 'Allocated Flag']),
    typedExportConversion('raw-extract-sheet-3-full.csv', ['Country', 'Current Series', 'Type', 'Allocated Flag']),
  ],
  // wdtk-271469 (2015-06): same 8-column shape, differently named sheets.
  'wdtk-271469-typed-lists': [
    typedExportConversion('raw-extract-sheet-1-amateur-foundation.csv', ['Country', 'Current Series', 'Type', 'Allocated Flag']),
    typedExportConversion('raw-extract-sheet-2-amateur-intermediate.csv', ['Country', 'Current Series', 'Type', 'Allocated Flag']),
    typedExportConversion('raw-extract-sheet-3-amateur-full.csv', ['Country', 'Current Series', 'Type', 'Allocated Flag']),
  ],
  // The 2015-10 export (wdtk-294011 and wdtk-299321 - byte-identical
  // disclosures, shared variant): 7 columns, no Allocated Flag.
  'available-typed-export-7col': [
    typedExportConversion('raw-extract-sheet-1-foundation.csv', ['Country', 'Current Series', 'Type']),
    typedExportConversion('raw-extract-sheet-2-intermediate.csv', ['Country', 'Current Series', 'Type']),
    typedExportConversion('raw-extract-sheet-3-full.csv', ['Country', 'Current Series', 'Type']),
  ],
  // wdtk-309076 (2016-01): one combined sheet, all classes, plus two
  // entirely-empty application-number columns (required present, not
  // carried - their emptiness is recorded in meta.json).
  'wdtk-309076-combined-list': [
    typedExportConversion('raw-extract-sheet-1-sheet1.csv', ['Country', 'Current Series', 'Type', 'Allocated Flag', 'Call Sign Application #', 'MMSI Application #']),
  ],

  // wdtk-356636 (2016-09): the oldest full register snapshot. 'Final
  // Status' carries a rich vocabulary (Allocated/Reserved/Forbidden/
  // Available/Quarantine plus blanks) and 'SF List' the licence product -
  // both verbatim.
  'wdtk-356636-register-and-forbidden': [
    {
      sourceFile: 'raw-extract-sheet-1-all-call-signs.csv',
      encoding: 'utf8',
      columns: [
        { source: 'Call Sign', output: 'callsign', kind: 'verbatim' },
        { source: 'Final Status', output: 'status', kind: 'verbatim' },
        { source: 'SF List', output: 'licence_class', kind: 'verbatim' },
      ],
      ignoredColumns: [],
      rowOrder: 'sorted-by-first-column',
      orderRationale: 'source rows arrive grouped but not fully ordered (13 duplicate callsigns, not callsign-sorted); no meaningful order evident, sorted by callsign for diffability',
    },
    {
      sourceFile: 'raw-extract-sheet-2-forbidden-suffixes.csv',
      encoding: 'utf8',
      columns: [
        { source: 'Value', output: 'suffix', kind: 'verbatim' },
      ],
      // 'Forbidden' on every row - the sheet-level discriminator, recorded
      // in meta.json, not a per-row assertion.
      ignoredColumns: ['Type'],
      rowOrder: 'sorted-by-first-column',
      orderRationale: 'alphabetical source order carries no meaning; sorted by suffix (a no-op for the archived file, kept for rule consistency)',
    },
    // Sheet 3 is a short prose note on licence formats - reference context,
    // not a dataset; deliberately not normalised.
  ],

  // wdtk-596532 (as at 2019-08-12): the same export shape as the published
  // 2019-09-12 register (ofcom-756622), down to the truncated 'Licence
  // Issued Dat' header - but disclosed as a workbook, so its dates arrive
  // typed and the extract renders them ISO.
  'wdtk-596532-register-and-forbidden': [
    {
      sourceFile: 'raw-extract-sheet-1-all-callsigns-on-record.csv',
      encoding: 'utf8',
      columns: [
        { source: 'Call Sign', output: 'callsign', kind: 'verbatim' },
        { source: 'Status', output: 'status', kind: 'verbatim' },
        { source: 'Licence Class', output: 'licence_class', kind: 'verbatim' },
        { source: 'Licence Issued Dat', output: 'licence_issued_date', kind: 'iso-date' },
      ],
      ignoredColumns: [],
      rowOrder: 'source-order',
      orderRationale: 'source rows are ordered by Licence Issued Date ascending (blank dates last) - the same meaningful publication order as the ofcom-756622 register; preserved for cross-snapshot comparability',
      referenceDateIso: '2019-08-12',
    },
    {
      sourceFile: 'raw-extract-sheet-2-forbidden-call-signs.csv',
      encoding: 'utf8',
      columns: [
        { source: 'NAME', output: 'suffix', kind: 'verbatim' },
      ],
      ignoredColumns: [],
      rowOrder: 'sorted-by-first-column',
      orderRationale: 'alphabetical source order carries no meaning; sorted by suffix (a no-op for the archived file, kept for rule consistency)',
    },
  ],

  // wdtk-238892 (2015-01): Annex A of the internal-review outcome. Sheet 1
  // lists pre-WW2 G-series callsigns assigned or re-assigned since 1945
  // (45 callsigns appear more than once - multiple assignments; 156 rows
  // carry stored time-of-day artefacts). Sheet 2 discloses the licensing
  // database's column headings - its header row has an unnamed first
  // column, which the explicit-header path matches as the empty name.
  'wdtk-238892-prewar-annex': [
    {
      sourceFile: 'raw-extract-sheet-1-callsigns.csv',
      encoding: 'utf8',
      preamble: [
        ['Callsigns in the "G" series allocated prior to WW2 with 2-letter suffixes, which were assigned or re-assigned since 1945. ', ''],
        ['', ''],
      ],
      columns: [
        { source: 'Call Sign', output: 'callsign', kind: 'verbatim' },
        { source: 'Original Start Date', output: 'original_start_date', kind: 'iso-date' },
      ],
      ignoredColumns: [],
      rowOrder: 'source-order',
      orderRationale: 'source rows are already callsign-sorted; preserved',
      referenceDateIso: '2015-01-21',
    },
    {
      sourceFile: 'raw-extract-sheet-2-database-fields.csv',
      encoding: 'utf8',
      preamble: [],
      columns: [
        { source: '', output: 'view', kind: 'verbatim' },
        { source: 'Field Name', output: 'field_name', kind: 'verbatim' },
      ],
      ignoredColumns: [],
      rowOrder: 'source-order',
      orderRationale: 'rows are grouped by database view (Contact View, then Licence View) - a meaningful disclosed structure; preserved',
    },
  ],

  // ofcom-498906 (vintage 2017-11, response 2017-12-22): reciprocal
  // amateur licences issued since 2010, one row per issuance event -
  // sibling of ofcom-498903 (same intake, adviser, response day and export
  // shape). 178 rows carry stored 23:00:00 times (timezone artefacts in
  // the workbook) - carried verbatim, never rounded to a guessed day.
  'ofcom-498906-reciprocal-events': [
    {
      sourceFile: 'raw-extract-sheet-1-sheet1.csv',
      encoding: 'utf8',
      columns: [
        { source: 'Call Sign T-Number', output: 'callsign', kind: 'verbatim' },
        // The letter's own framing: 'call signs associated to Amateur
        // Reciprocal Licences since 2010', listed with date of issue.
        { source: null, output: 'event', kind: 'verbatim', constant: 'reciprocal-licence-issued' },
        { source: 'Original Start Date', output: 'event_date', kind: 'iso-date' },
      ],
      ignoredColumns: [],
      rowOrder: 'source-order',
      orderRationale: 'source rows are ordered by start date ascending - a meaningful chronology of reciprocal-licence issue events; preserved',
      referenceDateIso: '2017-12-22',
    },
  ],

  // ofcom-498903 (vintage 2017-11, response 2017-12-22): call signs
  // re-issued since 2010, one row per issuance event. Semantics caveat on
  // the record: the source's Original Start Date is the START DATE OF THE
  // RE-ISSUING LICENCE, treated here as the re-issue event date. 53 rows
  // carry stored 23:00:00 times (timezone artefacts in the workbook) -
  // carried verbatim, never rounded to a guessed day.
  'ofcom-498903-reissue-events': [
    {
      sourceFile: 'raw-extract-sheet-1-sheet1.csv',
      encoding: 'utf8',
      columns: [
        { source: 'Call Sign T-Number', output: 'callsign', kind: 'verbatim' },
        { source: null, output: 'event', kind: 'verbatim', constant: 'reissued' },
        { source: 'Original Start Date', output: 'event_date', kind: 'iso-date' },
      ],
      ignoredColumns: [],
      rowOrder: 'source-order',
      orderRationale: 'source rows are ordered by start date ascending - a meaningful chronology of re-issue events; preserved',
      referenceDateIso: '2017-12-22',
    },
  ],

  // ofcom-2016-09-20 (UK Government Web Archive capture of an Ofcom __data
  // asset, id 90397): the EARLIEST register snapshot held, and the oldest and
  // sparsest export shape in the archive - a single worksheet of just two
  // columns, 'Call Sign' and 'Status'. No licence class, no dates, no
  // prefix/suffix decomposition; licence_class is emitted empty to keep the
  // callsign-observation core stable (as in ofcom-2017-07-13 and
  // ofcom-01420046). The Status vocabulary is unusually rich for a register
  // snapshot - Allocated/Reserved/Available/Quarantine and, distinctively,
  // Forbidden: this file folds the forbidden values straight into the callsign
  // column (5,431 rows, mostly 20-series intermediate callsigns built on
  // withheld suffixes plus one bare three-letter suffix), rather than isolating
  // them in a separate forbidden-suffix sheet the way the sibling WDTK
  // disclosure does. Carried verbatim as status='Forbidden' observations - the
  // source's own single-column structure, not reshaped. The callsign+status
  // content is byte-for-byte the same 139,758-row register as
  // wdtk-356636's sheet 1 (same 2016-09-20 export lineage), minus that
  // workbook's SF-List licence-class column and its separate forbidden sheet.
  // No date columns, so no reference bound. Vintage is PROVEN by the workbook's
  // own docProps (created and modified 2016-09-20), not merely declared.
  'ofcom-2016-09-20-register': [
    {
      sourceFile: 'raw-extract-sheet-1-sheet1.csv',
      encoding: 'utf8',
      columns: [
        { source: 'Call Sign', output: 'callsign', kind: 'verbatim' },
        { source: 'Status', output: 'status', kind: 'verbatim' },
        // No licence class is disclosed; emitted empty to keep the
        // callsign-observation core schema stable.
        { source: null, output: 'licence_class', kind: 'verbatim' },
      ],
      ignoredColumns: [],
      rowOrder: 'sorted-by-first-column',
      orderRationale: 'source rows arrive grouped (intermediate 20-series first, forbidden values last) but carry no globally meaningful order (13 duplicate callsigns, not callsign-sorted); sorted by callsign for diffability and cross-snapshot comparability',
    },
  ],

  // ofcom-2017-07-13 (Ofcom web-link CSV, "FOI Request 13 Jul 17"): a full
  // register snapshot in the oldest CSV header shape held (Value, Prefix,
  // Suffix, Type, Status), predating all three known open-data variants. The
  // source carries Ofcom's OWN prefix/suffix decomposition of each callsign -
  // recorded in the entry meta and preserved verbatim in the archived source
  // CSV, but required-present-not-carried here: the normalised projection keeps
  // the register-snapshot core so it stays comparable with every other register
  // vintage, and the decomposition is not uniformly three-letter-suffix-shaped
  // (GM6JYC -> G6/JYC yet GM0SXQ -> GM/0SXQ), so it is not the registered
  // `suffix` extension. 'Type' is 'Call Sign - Amateur' on every row - the
  // product/service discriminator, not a per-row assertion. No licence class is
  // disclosed, so licence_class is emitted empty to keep the callsign-observation
  // core stable (as in wdtk-1180568 sheet 1). No date columns, so no reference
  // bound. Vintage caveat lives in the meta (declared 2017-07-13, not proven).
  'ofcom-2017-07-13-register': [
    {
      sourceFile: 'Amateur Call Signs for FOI Request 13 Jul 17.csv',
      encoding: 'utf8',
      columns: [
        { source: 'Value', output: 'callsign', kind: 'verbatim' },
        { source: 'Status', output: 'status', kind: 'verbatim' },
        // No licence class is disclosed; emitted empty to keep the
        // callsign-observation core schema stable.
        { source: null, output: 'licence_class', kind: 'verbatim' },
      ],
      // Prefix/Suffix are Ofcom's own decomposition of the callsign (preserved
      // verbatim in the archived source CSV, described in meta); Type is the
      // constant product/service discriminator. Required present, not carried.
      ignoredColumns: ['Prefix', 'Suffix', 'Type'],
      rowOrder: 'sorted-by-first-column',
      orderRationale: 'source rows arrive grouped by suffix but carry no meaningful publication order (no dates, not callsign-sorted); sorted by callsign for diffability and cross-snapshot comparability',
    },
  ],

  // ofcom-01420046 (Ofcom disclosure log, March 2022): a full register
  // snapshot in the 'Value, Status, Type' header shape - the same three-column
  // export as the open-data lane's earliest publications, minus any date or
  // class. Sheet 1's name embeds the report-generation instant
  // (Report1646659776237 = 2022-03-07T13:29:36Z), the entry's vintage. 'Type'
  // is 'Call Sign - Amateur' on every row - the product/service discriminator,
  // recorded in meta, not a per-row assertion. No licence class is disclosed,
  // so licence_class is emitted empty to keep the callsign-observation core
  // stable (as in ofcom-2017-07-13 and wdtk-1180568 sheet 1). No date columns,
  // so no reference bound. The workbook's second sheet is an undisclosed-purpose
  // subset of sheet 1 (an order-preserving subsequence, header-less, no status
  // of its own) - preserved verbatim in the committed raw-extract but not
  // normalised into a dataset, since doing so would assert a membership the
  // source does not explain (documented in the entry meta).
  'ofcom-01420046-register': [
    valueStatusTypeRegisterConversion('raw-extract-sheet-1-report1646659776237.csv'),
  ],

  // ofcom-2022-03-14 (Ofcom disclosure log, case 01432624, "Available and
  // registered UK amateur radio callsigns"): a full register snapshot in the
  // identical 'Value, Status, Type' workbook shape as ofcom-01420046, generated
  // a week later - sheet 1's name Report1647268967067 embeds the
  // report-generation instant (2022-03-14T14:42:47Z), the entry's vintage. Type
  // is 'Call Sign - Amateur' on every row (the service discriminator, recorded
  // in meta.json, not a per-row assertion); no licence class or date is
  // disclosed. Shares the Value,Status,Type factory with ofcom-01420046 - the
  // shape is asserted identical.
  'ofcom-2022-03-14-register': [
    valueStatusTypeRegisterConversion('raw-extract-sheet-1-report1647268967067.csv'),
  ],

  // ofcom-2021-01 and ofcom-2021-04 (UK Government Web Archive captures of two
  // Ofcom FOI annexes, the 2021 full-register snapshots): the 'Value, Status,
  // Type' register export extended with three typed columns - Reserved to Date,
  // Original Start Date and Licence Type. Disclosed as workbooks, so the dates
  // arrive typed and the extract renders them ISO (iso-date). 'Type' is
  // 'Call Sign - Amateur' on every row (the product/service discriminator,
  // recorded in meta, required-present not carried); Licence Type carries the
  // source's own product vocabulary verbatim ('Amateur Full Radio Licence' etc,
  // including 'Amateur Temporary Reciprocal Radio Licence'). The two annexes
  // differ ONLY in the case of two headers ('Original Start Date' vs 'Original
  // start date', 'Licence Type' vs 'Licence type'); since columns are matched by
  // exact NAME, each annex binds its own variant built from the shared factory.
  'ofcom-2021-01-register': [
    datedRegisterConversion('raw-extract-sheet-1-callsigns.csv', 'Original Start Date', 'Licence Type', '2021-01-29'),
  ],
  'ofcom-2021-04-register': [
    datedRegisterConversion('raw-extract-sheet-1-sheet1.csv', 'Original start date', 'Licence type', '2021-04-21'),
  ],

  // ofcom-2024-12 (Ofcom disclosure log, December 2024): the five-years-on
  // forbidden-suffix comparison point. A suspected Salesforce object export -
  // two columns, Name (the three-letter suffix) and LastModifiedDate - so,
  // unlike the earlier forbidden lists, it carries per-suffix provenance. The
  // LastModifiedDate is kept: it is the only dated provenance any forbidden
  // disclosure supplies, and dropping it would discard the very signal that
  // distinguishes this list from its predecessors. referenceDateIso is the
  // disclosure-month upper bound used solely as the date plausibility ceiling
  // (a last-modified date beyond December 2024 would be corruption); the
  // disclosed dates themselves top out at 2020-12-10.
  'ofcom-2024-12-forbidden-suffixes': [
    {
      sourceFile: 'forbidden-amateur-radio-callsigns.csv',
      encoding: 'utf8',
      columns: [
        // Three-letter SUFFIXES under a 'Name' column - the forbidden-list
        // shape (issue #139), not callsigns.
        { source: 'Name', output: 'suffix', kind: 'verbatim' },
        { source: 'LastModifiedDate', output: 'last_modified_date', kind: 'date' },
      ],
      ignoredColumns: [],
      rowOrder: 'sorted-by-first-column',
      orderRationale: 'the source is alphabetical by suffix and carries no other meaningful order; sorted by suffix for diffability and cross-disclosure comparability (a near no-op)',
      referenceDateIso: '2024-12-31',
    },
  ],

  // The 2023-24 Salesforce-era register exports: three Ofcom disclosure-log CSV
  // snapshots sharing one shape (Value, Status, Product, Type, and a per-record
  // 'Call Sign MMSI: Last Modified Date'). Product is the licence product/class
  // carried verbatim; Type is 'Call Sign - Amateur' throughout (the service
  // discriminator, recorded in meta.json, not a per-row assertion); the
  // last-modified date is the only per-callsign provenance these exports carry
  // and is kept (dropping it would discard the very signal that dates the
  // snapshot). Each snapshot binds its own variant so referenceDateIso is its
  // own vintage ceiling - the shape is shared via the factory, the vintages are
  // not (see valueStatusProductRegisterConversion).
  //
  // ofcom-2023-11-24 ('call-sign-list-241123'): vintage 2023-11-24 - the
  // filename's 241123 and the latest last-modified date in the data agree.
  'ofcom-2023-11-24-register': [
    valueStatusProductRegisterConversion('call-sign-list-241123.csv', '2023-11-24'),
  ],
  // ofcom-2023-12-07 ('call-sign-list-for-open-data-07-12-23'): vintage
  // 2023-12-07 - again the filename date and the latest last-modified agree.
  'ofcom-2023-12-07-register': [
    valueStatusProductRegisterConversion('call-sign-list-for-open-data-07-12-23.csv', '2023-12-07'),
  ],
  // ofcom-2024-01 (FOI 1734722, disclosed January 2024): a fuller register than
  // the December pair (it carries the ~45k reserved-with-blank-product pool and
  // a Special Event Station product the open-data exports omit). The exact
  // snapshot day is not stated; referenceDateIso is the disclosure-month ceiling
  // (a last-modified date beyond it would be corruption), and the data's own
  // dates top out at 2023-12-19 - the vintage caveat lives in the entry meta.
  'ofcom-2024-01-register': [
    valueStatusProductRegisterConversion('foi-1734722-amateur-call-signs.csv', '2024-01-31'),
  ],

  // Two 2023 register snapshots in the same Value/Status/Product family,
  // disclosed as WORKBOOKS rather than CSVs: their dates arrive typed and the
  // extract renders them ISO, so the shared factory is asked for ISO-date
  // handling (lastModifiedKind: 'iso-date') - the same workbook-vs-CSV
  // distinction as wdtk-596532 against the ofcom-756622 register.
  //
  // ofcom-2023-01-25 ('call-sign-list-with-status-25-01-2023'): the earliest
  // Value,Status,Product snapshot held, and the only one WITHOUT a Type column
  // (four columns: Value, Status, Product, Call Sign MMSI: Last Modified Date).
  // Sheet 1's name Report1674642037414 embeds the report-generation instant
  // (2023-01-25T10:20:37Z), agreeing with the filename date and the latest
  // last-modified date (2023-01-25) - the vintage, and the plausibility ceiling.
  'ofcom-2023-01-25-register': [
    valueStatusProductRegisterConversion('raw-extract-sheet-1-report1674642037414.csv', '2023-01-25', { hasType: false, lastModifiedKind: 'iso-date' }),
  ],
  // ofcom-2023-08-18 (Ofcom FOI 01649066, 'Copy of Call Sign List 18-08-2023'):
  // the full five-column shape (Value, Product, Status, Type, Call Sign MMSI:
  // Last Modified Date) with the constant 'Call Sign - Amateur' Type as the
  // discriminator. The sheet ('Call Sign Data') embeds no timestamp; the
  // filename dates the export 18/08/2023 and the latest last-modified date
  // (2023-08-17) sits just within it - the vintage and the plausibility ceiling.
  'ofcom-2023-08-18-register': [
    valueStatusProductRegisterConversion('raw-extract-sheet-1-call-sign-data.csv', '2023-08-18', { lastModifiedKind: 'iso-date' }),
  ],

  // ofcom-2024-04-30 ('copy-all-callsigns-30-apr-24'): a full register snapshot
  // in a Salesforce object-export shape - the columns carry the `__c`
  // custom-field suffix (Value__c, Product__c, Status__c, Type__c), the only
  // disclosure held in that shape. Value__c is the callsign, Product__c the
  // licence product/class carried verbatim (empty for the ~45k reserved pool),
  // Status__c the status. Type__c is 'Call Sign - Amateur' on every row (the
  // service discriminator, recorded in meta.json, not a per-row assertion) and
  // is dropped. The export carries no date column, so there is no reference
  // bound; the vintage (2024-04-30) rests on the filename and lives in the
  // entry meta. The published bytes are latin-1: a single trailing 0xA0 (raw
  // NBSP) rides one callsign, so decoding must go through latin1.
  'ofcom-2024-04-30-register': [
    {
      sourceFile: 'copy-all-callsigns-30-apr-24.csv',
      encoding: 'latin1',
      columns: [
        { source: 'Value__c', output: 'callsign', kind: 'verbatim' },
        { source: 'Status__c', output: 'status', kind: 'verbatim' },
        // Product__c is the licence product/class, carried verbatim; empty
        // where the source asserts none (the reserved pool).
        { source: 'Product__c', output: 'licence_class', kind: 'verbatim' },
      ],
      // 'Type__c' is 'Call Sign - Amateur' on every row - the product/service
      // discriminator, required present, not carried.
      ignoredColumns: ['Type__c'],
      rowOrder: 'sorted-by-first-column',
      orderRationale: 'source rows arrive grouped but carry no globally meaningful order (not callsign-sorted, no dates); sorted by callsign for diffability and cross-snapshot comparability',
    },
  ],

  // ofcom-2024-09 ('every-radio-callsign-spreadsheet'): a full register
  // snapshot in the six-column shape Created Date, Product, Reserved to Date,
  // Status, Type, Value - the widest register export held. Unlike every other
  // register snapshot, 'Type' is NOT constant here: it carries 'Call Sign -
  // Amateur' AND 'Call Sign - NoV' (the Notice-of-Variation special-event and
  // permit callsigns), and the value is not derivable from Product (the
  // 'Special Event Station' product appears under both types). Dropping it
  // would erase the NoV distinction, so it is carried verbatim as
  // call_sign_type - the one register shape where the type is a per-row
  // assertion, not a discriminator. Created Date is the record-creation
  // timestamp (cannot postdate the snapshot, so bounded by referenceDateIso);
  // Reserved to Date is a reservation EXPIRY (a validity END, legitimately
  // future - 2099 placeholders exist - so futureAllowed). The exact snapshot
  // day is not stated; referenceDateIso is the disclosure-month ceiling and the
  // data's own Created Dates top out at 2024-09-10 - the month-level vintage
  // caveat lives in the entry meta.
  'ofcom-2024-09-register': [
    {
      sourceFile: 'every-radio-callsign-spreadsheet.csv',
      encoding: 'utf8',
      columns: [
        { source: 'Value', output: 'callsign', kind: 'verbatim' },
        { source: 'Status', output: 'status', kind: 'verbatim' },
        { source: 'Product', output: 'licence_class', kind: 'verbatim' },
        // Type varies (Call Sign - Amateur / Call Sign - NoV) and is not
        // derivable from Product - a genuine per-row assertion, carried.
        { source: 'Type', output: 'call_sign_type', kind: 'verbatim' },
        // Record-creation timestamp; cannot postdate the snapshot, so bounded.
        { source: 'Created Date', output: 'created_date', kind: 'date' },
        // Reservation EXPIRY - future values are legitimate (2099 observed).
        { source: 'Reserved to Date', output: 'reserved_to_date', kind: 'date', futureAllowed: true },
      ],
      ignoredColumns: [],
      rowOrder: 'sorted-by-first-column',
      orderRationale: 'source rows arrive roughly callsign-grouped but carry no globally meaningful order (not fully callsign-sorted, not date-ordered); sorted by callsign for diffability and cross-snapshot comparability',
      referenceDateIso: '2024-09-30',
    },
  ],

  // The callsign+product+status register-snapshot family (Ofcom disclosure
  // log, 2024-2025). Three snapshots, one shared factory; they differ only in
  // header spelling, and the last one additionally carries CreatedDate. Type
  // is the constant 'Call Sign - Amateur' discriminator throughout. This family
  // spells the callsign column 'Call sign'/'Callsign' (the 2023-24 family above
  // spells it 'Value'), so it binds its own factory rather than reusing that
  // one.

  // ofcom-2024-07 (July 2024): header
  // 'Call sign,Product,Status,Type,Call Sign MMSI: Last Modified Date' (no
  // BOM). The day of the July vintage is not stated (served as
  // 'call-signs.csv'), so the entry is keyed to the month and referenceDateIso
  // is the month-end plausibility ceiling; the disclosed last-modified dates
  // top out at 2024-06-14, well within it.
  'ofcom-2024-07-register': [
    callsignProductRegisterConversion({
      sourceFile: 'call-signs.csv',
      callsignHeader: 'Call sign',
      lastModifiedHeader: 'Call Sign MMSI: Last Modified Date',
      referenceDateIso: '2024-07-31',
    }),
  ],
  // ofcom-2024-10-21 (filed under September 2024, but the filename dates the
  // export 21/10/2024): header 'Callsign,Product,Status,Type,Last Modified
  // Date' (UTF-8 BOM). The disclosed last-modified dates top out at exactly
  // 2024-10-21 - the vintage.
  'ofcom-2024-10-21-register': [
    callsignProductRegisterConversion({
      sourceFile: 'copy-of-callsigns-21102024.csv',
      callsignHeader: 'Callsign',
      lastModifiedHeader: 'Last Modified Date',
      referenceDateIso: '2024-10-21',
    }),
  ],
  // ofcom-2025-03-13 (filed under January 2025, but the filename dates the
  // export 13/03/2025): header
  // 'Callsign,Product,Status,Type,LastModifiedDate,CreatedDate' (no BOM) - the
  // same family plus a CreatedDate column. Both dates top out at 2025-03-13 -
  // the vintage.
  'ofcom-2025-03-13-register': [
    callsignProductRegisterConversion({
      sourceFile: 'call-signs-13mar2025.csv',
      callsignHeader: 'Callsign',
      lastModifiedHeader: 'LastModifiedDate',
      createdDateHeader: 'CreatedDate',
      referenceDateIso: '2025-03-13',
    }),
  ],

  // ofcom-2025-09-11 (Ofcom FOI disclosure log, published October 2025 as
  // 'callsigns-spreadsheet-october-2025.xlsx'): a full register snapshot in a
  // sixth, Salesforce-flavoured workbook shape. Its column headers carry the
  // source system's own object/field names - 'Callsign', 'Product__c',
  // 'Status', 'Type', 'Licence LastModifiedDate' and
  // 'Licence Original_start_date__c' - unlike any earlier export, so it binds
  // its own variant (columns are matched by exact name). Product__c is the
  // licence product/class carried verbatim; Type is 'Call Sign - Amateur' on
  // every row (the service discriminator, required-present not carried). Both
  // dates arrive typed in the workbook and are rendered ISO by the mechanical
  // extract (iso-date, as in the 2021 annexes) rather than day-first CSV
  // strings. The last-modified timestamp never postdates the snapshot and the
  // original-start (issue) date never postdates it either, so both are bounded
  // by referenceDateIso. The vintage is 2025-09-11 - the worksheet name
  // ('Amateur Callsgn 11092025') and the data's maximum date agree - NOT the
  // 'october-2025' of the published filename, which is the export/publication
  // month (docProps created 2025-10-07); the filing-vs-vintage caveat lives in
  // the entry meta.
  'ofcom-2025-09-11-register': [
    {
      sourceFile: 'raw-extract-sheet-1-amateur-callsgn-11092025.csv',
      encoding: 'utf8',
      columns: [
        { source: 'Callsign', output: 'callsign', kind: 'verbatim' },
        { source: 'Status', output: 'status', kind: 'verbatim' },
        // The source's own Product vocabulary ('Amateur Full Radio Licence'
        // etc.), carried verbatim, never canonicalised; blank where the source
        // asserts no product (the reserved/available pool).
        { source: 'Product__c', output: 'licence_class', kind: 'verbatim' },
        // A record last-modified timestamp; cannot postdate the snapshot.
        { source: 'Licence LastModifiedDate', output: 'last_modified_date', kind: 'iso-date' },
        // The licence's original start (issue) date; cannot postdate the
        // snapshot (the 1903-05-03 migration-placeholder floor recurs here).
        { source: 'Licence Original_start_date__c', output: 'original_start_date', kind: 'iso-date' },
      ],
      // 'Type' is 'Call Sign - Amateur' on every row - the product/service
      // discriminator recorded in meta.json, not a per-row assertion.
      ignoredColumns: ['Type'],
      rowOrder: 'sorted-by-first-column',
      orderRationale: 'source rows arrive in no meaningful order (not callsign-sorted, dates not monotonic); sorted by callsign for diffability and cross-snapshot comparability',
      referenceDateIso: '2025-09-11',
    },
  ],
};

// The 2013/14 suffix-list sheets differ only in filename, stated prefix and
// class; the label row doubles as the verbatim-matched header.
function suffixListConversions(sheets: readonly [string, string, string, string][]): FoiSourceConversion[] {
  return sheets.map(([sourceFile, label, prefix, licenceClass]) => ({
    sourceFile,
    encoding: 'utf8' as const,
    columns: [
      { source: label, output: 'callsign', kind: 'prefixed' as const, prefix },
      { source: null, output: 'status', kind: 'verbatim' as const, constant: 'Available' },
      { source: null, output: 'licence_class', kind: 'verbatim' as const, constant: licenceClass },
      { source: label, output: 'suffix', kind: 'verbatim' as const },
    ],
    ignoredColumns: [],
    rowOrder: 'sorted-by-first-column' as const,
    orderRationale: 'alphabetical suffix order carries no meaning; sorted by callsign for diffability (a near no-op given the constant prefix)',
  }));
}

function prefixHeaderConversion(sourceFile: string, prefix: string, licenceClass: string): FoiSourceConversion {
  return {
    sourceFile,
    encoding: 'utf8',
    preamble: [[''], [`Prefix = ${prefix}`]],
    columns: [
      { source: 'Suffix', output: 'callsign', kind: 'prefixed', prefix },
      { source: null, output: 'status', kind: 'verbatim', constant: 'Available' },
      { source: null, output: 'licence_class', kind: 'verbatim', constant: licenceClass },
      { source: 'Suffix', output: 'suffix', kind: 'verbatim' },
    ],
    ignoredColumns: [],
    rowOrder: 'sorted-by-first-column',
    orderRationale: 'alphabetical suffix order carries no meaning; sorted by callsign for diffability (a near no-op given the constant prefix)',
  };
}

// The Value/Status/Product register exports share one column vocabulary
// (Value -> callsign, Status, Product -> licence_class, a Call Sign MMSI: Last
// Modified Date, and - in most snapshots - a constant 'Call Sign - Amateur'
// Type discriminator). The 2023-24 disclosure-log CSVs carry day-first dates
// and the Type column; the 2023 WORKBOOK snapshots carry ISO dates (typed at
// source, rendered by the extractor) and one of them omits the Type column
// entirely. Options cover both axes so the family shares one factory rather
// than spawning near-duplicates; the three CSV callers keep the defaults
// (Type present, day-first dates).
interface ValueStatusProductRegisterOptions {
  // Whether the source carries the constant 'Call Sign - Amateur' Type
  // discriminator (required-present, not carried). Default true; the
  // 2023-01-25 workbook is the sole four-column source without it.
  hasType?: boolean;
  // 'date' for day-first DD/MM/YYYY CSV sources (default); 'iso-date' for
  // workbook extracts whose dates were typed at source and rendered ISO.
  lastModifiedKind?: 'date' | 'iso-date';
}

function valueStatusProductRegisterConversion(sourceFile: string, referenceDateIso: string, options: ValueStatusProductRegisterOptions = {}): FoiSourceConversion {
  const hasType = options.hasType ?? true;
  const lastModifiedKind = options.lastModifiedKind ?? 'date';
  return {
    sourceFile,
    encoding: 'utf8',
    columns: [
      { source: 'Value', output: 'callsign', kind: 'verbatim' },
      { source: 'Status', output: 'status', kind: 'verbatim' },
      // Product is the licence product/class, carried verbatim (as in the
      // typed Siebel exports); empty where the source asserts none (the
      // reserved pool in the complete-register snapshots).
      { source: 'Product', output: 'licence_class', kind: 'verbatim' },
      // A last-modified date cannot postdate the snapshot, so it is bounded by
      // referenceDateIso (not futureAllowed), whether it arrives day-first
      // (CSV) or already ISO (workbook extract).
      { source: 'Call Sign MMSI: Last Modified Date', output: 'last_modified_date', kind: lastModifiedKind },
    ],
    // 'Type' is 'Call Sign - Amateur' on every row - the product/service
    // discriminator, recorded in meta.json, not a per-row assertion. Required
    // present where the source carries it; the 2023-01-25 workbook omits it.
    ignoredColumns: hasType ? ['Type'] : [],
    rowOrder: 'sorted-by-first-column',
    orderRationale: 'source rows arrive grouped (reserved blocks first) but carry no globally meaningful order (not callsign-sorted, not date-ordered); sorted by callsign for diffability and cross-snapshot comparability',
    referenceDateIso,
  };
}

// The Value,Status,Type register-snapshot shape: a full register export with no
// licence class and no dates, the constant 'Call Sign - Amateur' Type the only
// discriminator (required-present, not carried, per issue #139). Shared by the
// Ofcom disclosure-log workbook snapshots that carry exactly these three
// columns (01420046 and case 01432624, both March 2022).
function valueStatusTypeRegisterConversion(sourceFile: string): FoiSourceConversion {
  return {
    sourceFile,
    encoding: 'utf8',
    columns: [
      { source: 'Value', output: 'callsign', kind: 'verbatim' },
      { source: 'Status', output: 'status', kind: 'verbatim' },
      // No licence class is disclosed; emitted empty to keep the
      // callsign-observation core schema stable.
      { source: null, output: 'licence_class', kind: 'verbatim' },
    ],
    // 'Type' is the constant product/service discriminator - required present,
    // not carried.
    ignoredColumns: ['Type'],
    rowOrder: 'sorted-by-first-column',
    orderRationale: 'source rows arrive in no meaningful order (not callsign-sorted, no dates); sorted by callsign for diffability and cross-snapshot comparability',
  };
}

// The Ofcom disclosure-log register snapshots in the callsign+product+status
// export family (2024-2025). Every snapshot carries the same fields - a
// callsign column, the licence Product, the Status, the constant
// 'Call Sign - Amateur' Type discriminator, and a last-modified date - but the
// callsign column is spelled 'Call sign' or 'Callsign', the last-modified
// header spelling varies, and the March-2025 export additionally carries a
// CreatedDate. One factory covers the whole family; each snapshot pins its own
// EXACT header spellings, so a silent column rename can never slip through
// (columns are matched by name, never by position). Product is the licence
// class carried verbatim; the constant Type is required-present but not carried.
interface CallsignProductRegisterOptions {
  sourceFile: string;
  // Exact callsign-column header for this snapshot ('Call sign' | 'Callsign').
  callsignHeader: string;
  // Exact last-modified-date header for this snapshot.
  lastModifiedHeader: string;
  // Exact created-date header, where the snapshot carries one (2025-03 only).
  createdDateHeader?: string;
  // The snapshot vintage, used as the date plausibility ceiling.
  referenceDateIso: string;
}

function callsignProductRegisterConversion(options: CallsignProductRegisterOptions): FoiSourceConversion {
  const columns: FoiColumnSpec[] = [
    { source: options.callsignHeader, output: 'callsign', kind: 'verbatim' },
    { source: 'Status', output: 'status', kind: 'verbatim' },
    // The source's own Product vocabulary ('Amateur Full Radio Licence' etc.),
    // carried verbatim, never canonicalised; blank where the source asserts no
    // product (a large minority of rows).
    { source: 'Product', output: 'licence_class', kind: 'verbatim' },
    // A record last-modified timestamp (not a licence issue date); day-first,
    // never postdates the snapshot vintage.
    { source: options.lastModifiedHeader, output: 'last_modified_date', kind: 'date' },
  ];
  if (options.createdDateHeader !== undefined) {
    columns.push({ source: options.createdDateHeader, output: 'created_date', kind: 'date' });
  }
  return {
    sourceFile: options.sourceFile,
    encoding: 'utf8',
    columns,
    // 'Type' is 'Call Sign - Amateur' on every row - the product/service
    // discriminator recorded in meta.json, not a per-row assertion.
    ignoredColumns: ['Type'],
    rowOrder: 'sorted-by-first-column',
    orderRationale: 'source rows arrive in no meaningful order (not callsign-sorted, no clear date order); sorted by callsign for diffability and cross-snapshot comparability',
    referenceDateIso: options.referenceDateIso,
  };
}

// The 2015/16 typed Siebel exports share their column vocabulary; only the
// sheet filenames and the not-carried column set vary.
function typedExportConversion(sourceFile: string, ignoredColumns: readonly string[]): FoiSourceConversion {
  return {
    sourceFile,
    encoding: 'utf8',
    columns: [
      { source: 'Value', output: 'callsign', kind: 'verbatim' },
      { source: 'Status', output: 'status', kind: 'verbatim' },
      { source: 'Product', output: 'licence_class', kind: 'verbatim' },
      { source: 'Reference', output: 'suffix', kind: 'verbatim' },
    ],
    ignoredColumns,
    rowOrder: 'sorted-by-first-column',
    orderRationale: 'source rows arrive in no meaningful order; sorted by callsign for diffability',
  };
}

// The 2021 UKGWA-captured full-register annexes share this shape; only the
// sheet filename and the case of the Original-Start-Date / Licence-Type headers
// vary between the two disclosures. referenceDateIso is the snapshot's evidenced
// lower bound - its most recent Original Start Date, the plausibility ceiling
// for that issue-date column; Reserved to Date is a validity END and may
// legitimately postdate it.
function datedRegisterConversion(sourceFile: string, originalStartDateHeader: string, licenceTypeHeader: string, referenceDateIso: string): FoiSourceConversion {
  return {
    sourceFile,
    encoding: 'utf8',
    columns: [
      { source: 'Value', output: 'callsign', kind: 'verbatim' },
      { source: 'Status', output: 'status', kind: 'verbatim' },
      { source: licenceTypeHeader, output: 'licence_class', kind: 'verbatim' },
      // Reservation EXPIRY - a validity end, so future values are legitimate.
      { source: 'Reserved to Date', output: 'reserved_to_date', kind: 'iso-date', futureAllowed: true },
      { source: originalStartDateHeader, output: 'original_start_date', kind: 'iso-date' },
    ],
    // 'Type' is 'Call Sign - Amateur' on every row - the product/service
    // discriminator, required present but not carried.
    ignoredColumns: ['Type'],
    rowOrder: 'sorted-by-first-column',
    orderRationale: 'source rows arrive in no meaningful order (not callsign-sorted, dates not monotonic); sorted by callsign for diffability and cross-snapshot comparability',
    referenceDateIso,
  };
}

// --- The published row-schema vocabulary (issue #149 Phase A) -----------
//
// Every normalised output column is either CORE to its row-schema family or
// REGISTERED below - a governance test enforces this, so converters cannot
// invent near-duplicate column names (issued_date vs licence_issued_date).
// docs/foi-schemas.md renders these values; the prose here IS the published
// definition.

export interface FoiRowSchemaFamily {
  name: string;
  coreColumns: readonly string[];
  description: string;
}

export const FOI_ROW_SCHEMA_FAMILIES: readonly FoiRowSchemaFamily[] = [
  {
    name: 'callsign-observation',
    coreColumns: ['callsign', 'status', 'licence_class'],
    description: 'one row per callsign asserting its state at the entry vintage (register snapshots, available lists); status and licence_class carry the source vocabulary verbatim, empty where the source asserts nothing',
  },
  {
    name: 'issuance-events',
    coreColumns: ['callsign', 'event', 'event_date'],
    description: 'one row per dated per-callsign event; the event vocabulary is authored per converter from the source document\'s own wording (reissued, reallocated, reciprocal-licence-issued)',
  },
  {
    name: 'suffix-list',
    coreColumns: ['suffix'],
    description: 'one row per three-letter suffix (the forbidden lists) - suffixes, not callsigns, by design',
  },
  {
    name: 'counts-aggregate',
    coreColumns: ['period'],
    description: 'one row per reporting period carrying counts, not per-callsign data; the period label is carried verbatim from the source',
  },
  {
    name: 'callsign-attributes',
    coreColumns: ['callsign'],
    description: 'one row per callsign (or per callsign-assignment) carrying attributes for downstream joins, without a status assertion (e.g. the Pre-War annex)',
  },
  {
    name: 'database-fields',
    coreColumns: ['view', 'field_name'],
    description: 'the disclosed licensing-database column headings, grouped by database view (wdtk-238892 Annex A sheet 2)',
  },
];

export interface FoiExtensionColumn {
  definition: string;
  families: readonly string[];
}

// Registered extension columns: carried only where the source asserts them,
// named once here so every converter reuses the same name. Adding a column
// means adding a reviewed definition, not inventing a header.
export const FOI_EXTENSION_COLUMNS: Readonly<Record<string, FoiExtensionColumn>> = {
  suffix: {
    definition: 'the three-letter suffix component, carried verbatim alongside the callsign where the source is suffix-shaped',
    families: ['callsign-observation'],
  },
  reserved_to_date: {
    definition: 'reservation expiry (a validity END - legitimately after the entry vintage), ISO-rendered',
    families: ['callsign-observation'],
  },
  licence_issued_date: {
    definition: 'the licence issue date as disclosed in register snapshots, ISO-rendered',
    families: ['callsign-observation'],
  },
  created_date: {
    definition: 'the licensing-system record creation timestamp, ISO-rendered (time kept where the source carries one)',
    families: ['callsign-observation'],
  },
  original_start_date: {
    definition: 'the licence\'s original start date as disclosed, ISO-rendered; per-source semantics caveats live in the entry meta',
    families: ['callsign-observation', 'callsign-attributes'],
  },
  last_modified_date: {
    definition: 'the record\'s last-modified timestamp as disclosed in a Salesforce-era export, ISO-rendered with any time-of-day kept: per-suffix provenance in the forbidden-suffix list, per-callsign provenance in the 2023-24 register snapshots - in both cases the dated provenance the earlier exports lack',
    families: ['suffix-list', 'callsign-observation'],
  },
  call_sign_type: {
    definition: 'the call-sign service/type discriminator carried verbatim ("Call Sign - Amateur" / "Call Sign - NoV"), kept only where a snapshot asserts more than one value so the Notice-of-Variation special-event/permit callsigns stay distinguishable from ordinary amateur ones (elsewhere the constant Type is a discriminator recorded in meta, not carried)',
    families: ['callsign-observation'],
  },
  status: {
    definition: 'the licence status at disclosure, carried verbatim, when it accompanies event rows',
    families: ['issuance-events'],
  },
  licence_class: {
    definition: 'the licence product/class vocabulary carried verbatim, when it accompanies event rows',
    families: ['issuance-events'],
  },
  reason: {
    definition: 'the source\'s stated reason for the event, verbatim',
    families: ['issuance-events'],
  },
  licence_number: {
    definition: 'the Siebel-format licence identifier, verbatim',
    families: ['issuance-events'],
  },
  con_id: {
    definition: 'the Siebel-format contact/consent identifier, verbatim',
    families: ['issuance-events'],
  },
  amateur_radio_licences_issued: {
    definition: 'count of amateur radio licences issued in the period (thousands separators stripped, otherwise verbatim)',
    families: ['counts-aggregate'],
  },
  business_radio_licences_issued: {
    definition: 'count of business radio licences issued in the period (part of the disclosed assertion; consumers filter)',
    families: ['counts-aggregate'],
  },
};

export function conversionFor(variantName: string, sourceFile: string): FoiSourceConversion {
  const conversions = FOI_ENTRY_CONVERSIONS[variantName];
  if (conversions === undefined) {
    throw new Error(`unknown FOI converter variant "${variantName}" - known variants: ${Object.keys(FOI_ENTRY_CONVERSIONS).join(', ')}`);
  }
  const conversion = conversions.find(c => c.sourceFile === sourceFile);
  if (conversion === undefined) {
    throw new Error(`variant "${variantName}" has no conversion for source file "${sourceFile}"`);
  }
  return conversion;
}

// Output naming convention: normalised--<slugified-data-file-basename>.csv.
export function slugifyBasename(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function normalisedFileNameFor(sourceFile: string): string {
  // Workbook-extract conversions read raw-extract-sheet-*.csv files; the
  // 'raw-extract-' prefix is the intermediary's marker, not part of what
  // the output is named for (entry-scoped sheet names stay unique).
  return `normalised--${slugifyBasename(sourceFile).replace(/^raw-extract-/, '')}.csv`;
}

export interface FoiConvertNotes {
  // Cells whose leading/trailing whitespace (including NBSP) was trimmed -
  // counted and sampled, never silent; the rows themselves are kept.
  trimmedCellCount: number;
  trimmedSamples: string[];
  // Cells containing a non-breaking space anywhere before trimming.
  nbspCellCount: number;
  // Post-trim empty values per source-backed output column (blank statuses
  // are data; the counts put them on the record for review). Columns with
  // no blanks are omitted; synthesised always-empty columns are structural
  // and not counted.
  blankCounts: Record<string, number>;
  // Day-first date-order evidence per output date column, as in the
  // open-data lane: one day>12 value verifies its whole column.
  dateStats: Record<string, { disambiguated: number; ambiguous: number }>;
  unverifiedDateColumns: string[];
}

export interface FoiConvertResult {
  csv: string;
  outputFileName: string;
  recordCount: number;
  schemaVersion: number;
  notes: FoiConvertNotes;
}

const TRIMMED_SAMPLE_LIMIT = 20;

// Tie-break separator for whole-row comparison: NUL cannot occur in the
// source cells, so joined rows can never collide across cell boundaries.
const SEP = String.fromCharCode(0);

// The non-breaking space, named so checks read explicitly (an NBSP literal
// is invisible in most editors and vulnerable to silent normalisation).
const NBSP = String.fromCharCode(0xa0);

// Ends-only trim: in JavaScript regexes \s already covers Unicode whitespace
// INCLUDING the non-breaking space. Interior whitespace is part of the
// assertion ('G6 FMU' exists in the register) and is kept.
const EDGE_WHITESPACE_RE = /^\s+|\s+$/g;

// Parses the single markdown table in a raw-extract document. Strict by
// design: exactly one table block, a well-formed separator row, and a cell
// count matching the header on every row - anything else is a new extract
// shape deserving review, never a guess. Cell padding (ASCII space/tab) is
// table FORMATTING and is stripped structurally; any other edge whitespace
// is left for the counted trim so it stays on the record.
function parseMarkdownTable(text: string, sourceFile: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).map(line => line.replace(/[ \t]+$/, ''));
  const blocks: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (line.startsWith('|')) {
      if (current === null) blocks.push(current = []);
      current.push(line);
    } else {
      current = null;
    }
  }
  if (blocks.length === 0) {
    throw new Error(`${sourceFile}: no markdown table found in the extract`);
  }
  if (blocks.length > 1) {
    throw new Error(`${sourceFile}: ${blocks.length} markdown tables found - expected exactly one (a new extract shape deserves a reviewed converter change)`);
  }
  const [block] = blocks;
  if (block.length < 2 || !/^\|[ :\-|]+\|$/.test(block[1])) {
    throw new Error(`${sourceFile}: markdown table has no separator row after the header`);
  }
  const splitRow = (line: string): string[] => {
    if (!line.endsWith('|')) {
      throw new Error(`${sourceFile}: markdown table row does not end with '|': ${line}`);
    }
    return line.slice(1, -1).split('|').map(cell => cell.replace(/^[ \t]+|[ \t]+$/g, ''));
  };
  const header = splitRow(block[0]);
  if (new Set(header).size !== header.length) {
    throw new Error(`${sourceFile}: markdown table has duplicate header names (${header.join(', ')})`);
  }
  return block.slice(2).map((line, index) => {
    const cells = splitRow(line);
    if (cells.length !== header.length) {
      throw new Error(`${sourceFile}: data row ${index + 1} (${cells[0] ?? '?'}) has ${cells.length} cells - the header has ${header.length}`);
    }
    return Object.fromEntries(header.map((name, i) => [name, cells[i]]));
  });
}

// Explicit-header parsing for conversions with a `preamble`: the authored
// preamble rows are matched cell-for-cell, the next row is the header, and
// the rest are data. Used where csv-parse's first-row-is-header rule cannot
// apply (title/prefix rows before the header, or empty header names).
function parseWithPreamble(text: string, conversion: FoiSourceConversion): Record<string, string>[] {
  const rows: string[][] = parse(text, { columns: false, skip_empty_lines: true, bom: true, relax_column_count: true });
  const preamble = conversion.preamble ?? [];
  for (let i = 0; i < preamble.length; i++) {
    const expected = preamble[i];
    const actual = rows[i];
    if (actual === undefined || actual.length !== expected.length || expected.some((cell, j) => actual[j] !== cell)) {
      throw new Error(`${conversion.sourceFile}: preamble row ${i + 1} mismatch - expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual ?? null)} (a changed preamble is a changed assertion, never skipped blindly)`);
    }
  }
  const header = rows[preamble.length];
  if (header === undefined) {
    throw new Error(`${conversion.sourceFile}: no header row after the preamble`);
  }
  if (new Set(header).size !== header.length) {
    throw new Error(`${conversion.sourceFile}: duplicate header names (${header.join(', ')})`);
  }
  return rows.slice(preamble.length + 1).map(cells =>
    Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ''])));
}

export function convertFoiSource(bytes: Buffer, conversion: FoiSourceConversion): FoiConvertResult {
  const text = bytes.toString(conversion.encoding);
  const records: Record<string, string>[] = conversion.format === 'markdown-table'
    ? parseMarkdownTable(text, conversion.sourceFile)
    : conversion.preamble !== undefined
      ? parseWithPreamble(text, conversion)
      : parse(text, { columns: true, skip_empty_lines: true, bom: true });
  if (records.length === 0) {
    throw new Error(`${conversion.sourceFile}: parsed to zero data rows - refusing to normalise an empty file`);
  }

  // Header discipline: every expected header present, nothing extra, matched
  // by NAME (order-insensitive). Any deviation is a new source shape and a
  // reviewed converter change, never a guess.
  const actualHeaders = Object.keys(records[0]);
  const expectedHeaders = [
    ...conversion.columns.flatMap(c => (c.source === null ? [] : [c.source])),
    ...conversion.ignoredColumns,
  ];
  for (const expected of expectedHeaders) {
    if (!actualHeaders.includes(expected)) {
      throw new Error(`${conversion.sourceFile}: expected header "${expected}" not found (headers present: ${actualHeaders.join(', ')})`);
    }
  }
  for (const actual of actualHeaders) {
    if (!expectedHeaders.includes(actual)) {
      throw new Error(`${conversion.sourceFile}: unexpected header "${actual}" - extend the conversion registry (with tests) if the source shape has genuinely changed`);
    }
  }

  const notes: FoiConvertNotes = {
    trimmedCellCount: 0,
    trimmedSamples: [],
    nbspCellCount: 0,
    blankCounts: {},
    dateStats: {},
    unverifiedDateColumns: [],
  };

  const rows: string[][] = records.map((record, index) => convertRecord(record, index, conversion, notes));

  if (conversion.rowOrder === 'sorted-by-first-column') {
    // Codepoint order on the first output column, whole-row tie-break so
    // duplicate keys still order deterministically (never localeCompare).
    rows.sort((a, b) => codepointCompare(a[0], b[0]) || codepointCompare(a.join(SEP), b.join(SEP)));
  }

  notes.unverifiedDateColumns = Object.entries(notes.dateStats)
    .filter(([, s]) => s.disambiguated === 0)
    .map(([column]) => column);

  return {
    csv: renderCsv(conversion.columns.map(c => c.output), rows),
    outputFileName: normalisedFileNameFor(conversion.dataFile ?? conversion.sourceFile),
    recordCount: rows.length,
    schemaVersion: FOI_NORMALISED_SCHEMA_VERSION,
    notes,
  };
}

function convertRecord(record: Record<string, string>, index: number, conversion: FoiSourceConversion, notes: FoiConvertNotes): string[] {
  const rowLabel = (): string => {
    const key = conversion.columns.find(c => c.source !== null)?.source;
    return `data row ${index + 1} (${(key === undefined || key === null ? '?' : record[key] ?? '?')})`;
  };

  return conversion.columns.map(column => {
    if (column.source === null) return column.constant ?? '';
    const raw = record[column.source] ?? '';

    if (raw.includes(NBSP)) notes.nbspCellCount += 1;
    const trimmed = raw.replace(EDGE_WHITESPACE_RE, '');
    if (trimmed !== raw) {
      notes.trimmedCellCount += 1;
      if (notes.trimmedSamples.length < TRIMMED_SAMPLE_LIMIT) {
        notes.trimmedSamples.push(`${rowLabel()} ${column.output}: ${JSON.stringify(raw)}`);
      }
    }

    const checkDatePlausibility = (datePart: string): void => {
      const referenceDateIso = conversion.referenceDateIso;
      if (referenceDateIso === undefined) {
        throw new Error(`${conversion.sourceFile}: date column "${column.output}" requires referenceDateIso on the conversion`);
      }
      if (column.futureAllowed !== true && datePart > referenceDateIso) {
        throw new Error(`${conversion.sourceFile}: ${rowLabel()}: date "${trimmed}" is in the future relative to ${referenceDateIso} - failing plausibility check`);
      }
      if (Number(datePart.slice(0, 4)) < MIN_PLAUSIBLE_YEAR) {
        throw new Error(`${conversion.sourceFile}: ${rowLabel()}: date "${trimmed}" predates ${MIN_PLAUSIBLE_YEAR} - failing plausibility check`);
      }
    };

    if (column.kind === 'date' && trimmed !== '') {
      let parsed: ParsedUkDateTime;
      try {
        parsed = parseUkDateTimeDetailed(trimmed);
      } catch (err) {
        throw new Error(`${conversion.sourceFile}: ${rowLabel()}: ${errorMessage(err)}`);
      }
      checkDatePlausibility(parsed.iso.slice(0, 10));
      const stats = (notes.dateStats[column.output] ??= { disambiguated: 0, ambiguous: 0 });
      if (parsed.ambiguous) stats.ambiguous += 1;
      else stats.disambiguated += 1;
      return parsed.iso;
    }

    if (column.kind === 'iso-date' && trimmed !== '') {
      // Extract dates were typed in the workbook and rendered ISO by
      // src/shared/xlsx-extract.ts - validated and bounded, carried verbatim
      // (including stored time-of-day artefacts), with no day-first
      // order-evidence to collect.
      const match = /^\d{4}-(\d{2})-(\d{2})( \d{2}:\d{2}:\d{2})?$/.exec(trimmed);
      if (match === null || Number(match[1]) < 1 || Number(match[1]) > 12 || Number(match[2]) < 1 || Number(match[2]) > 31) {
        throw new Error(`${conversion.sourceFile}: ${rowLabel()}: "${trimmed}" is not a well-formed ISO extract date`);
      }
      checkDatePlausibility(trimmed.slice(0, 10));
      return trimmed;
    }

    if (column.kind === 'prefixed' && trimmed !== '') {
      if (column.prefix === undefined) {
        throw new Error(`${conversion.sourceFile}: prefixed column "${column.output}" has no authored prefix`);
      }
      return `${column.prefix}${trimmed}`;
    }

    if (column.kind === 'count' && trimmed !== '') {
      // Plain digits, or well-formed thousands separators. Anything else is
      // corruption, not a number to be repaired by stripping commas.
      if (!/^\d+$/.test(trimmed) && !/^\d{1,3}(?:,\d{3})+$/.test(trimmed)) {
        throw new Error(`${conversion.sourceFile}: ${rowLabel()}: "${trimmed}" is not a well-formed integer count`);
      }
      return trimmed.replaceAll(',', '');
    }

    if (trimmed === '') {
      notes.blankCounts[column.output] = (notes.blankCounts[column.output] ?? 0) + 1;
    }
    return trimmed;
  });
}

export function convertFoiEntry(entryDir: string, variantName: string): FoiConvertResult[] {
  const conversions = FOI_ENTRY_CONVERSIONS[variantName];
  if (conversions === undefined) {
    throw new Error(`unknown FOI converter variant "${variantName}" - known variants: ${Object.keys(FOI_ENTRY_CONVERSIONS).join(', ')}`);
  }
  return conversions.map(conversion => {
    const sourcePath = path.join(entryDir, conversion.sourceFile);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`source data file missing: ${sourcePath}`);
    }
    return convertFoiSource(fs.readFileSync(sourcePath), conversion);
  });
}

interface FoiEntryMetaConverter {
  converter?: { script?: string; variant?: string } | null;
}

function main(): void {
  const entryDirs = process.argv.slice(2).filter(a => a.trim().length > 0);
  if (entryDirs.length === 0) {
    console.error('usage: node src/shared/foi-normalise.ts <entry-dir> [...]');
    process.exitCode = 1;
    return;
  }
  for (const entryDir of entryDirs) {
    const metaPath = path.join(entryDir, 'meta.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as FoiEntryMetaConverter;
    const variant = meta.converter?.variant;
    if (typeof variant !== 'string') {
      throw new Error(`${metaPath}: no authored converter.variant - author the binding before running the converter`);
    }
    console.log(`\n=== ${entryDir} (variant ${variant})`);
    for (const result of convertFoiEntry(entryDir, variant)) {
      const outPath = path.join(entryDir, result.outputFileName);
      fs.writeFileSync(outPath, result.csv, 'utf8');
      const bytes = Buffer.byteLength(result.csv, 'utf8');
      console.log(`${result.outputFileName}`);
      console.log(`  records: ${result.recordCount}, bytes: ${bytes}, sha256: ${calculateContentHash(result.csv)}`);
      console.log(`  notes: ${JSON.stringify(result.notes, null, 2).replace(/\n/g, '\n  ')}`);
    }
  }
}

if (import.meta.main) {
  main();
}
