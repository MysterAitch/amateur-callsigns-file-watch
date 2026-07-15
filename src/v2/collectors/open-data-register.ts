/**
 * The open-data-register family: Ofcom's open-data register publications
 * (archive/<date>/raw.csv), keyed off the header-variant registry
 * (ofcom-amateur/normalise.ts), honouring each entry's curated ignoredLines so
 * export footer furniture never becomes a bogus observation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { type SourceObservationSet } from '../claim.ts';
import { listArchiveKeys, parseSourceFileName } from '../../shared/archive.ts';
import { CONSTANTS, type ArchiveMeta } from '../../shared/utils.ts';
import { parseRawRegister, rawColumnForCanonical, interpretOpenDataColumns } from '../../sources/ofcom-amateur/normalise.ts';
import type { LedgerCollector, ResolvedLedgerSource } from './types.ts';
import { jsonlStem } from './util.ts';

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
  // The parse source is the declared extract when one exists (workbook sheet
  // extract / shape-only header fill), else raw.csv - the same file the
  // normalise sweep and validator parse, so the ledger's observations key off
  // exactly the rows the committed normalisation was derived from.
  const parseSource = parseSourceFileName(meta);
  const rawContent = fs.readFileSync(path.join(archiveDir, key, parseSource), 'utf8');
  const parsed = parseRawRegister(rawContent, meta.ignoredLines ?? []);
  const callsignColumn = rawColumnForCanonical(parsed.mapping, 'callsign');
  if (callsignColumn === undefined) {
    throw new Error(`archive/${key}: variant "${parsed.variant}" maps no raw header to callsign`);
  }
  const productColumn = rawColumnForCanonical(parsed.mapping, 'product');
  // The raw header the variant maps to the call sign's original start date,
  // read from the same authored raw->canonical binding as the callsign/product
  // columns (never re-guessed). Only the 2026 variant declares one; older
  // variants map no such column and derive no temporal flag. The open-data raw
  // renders this date DD/MM/YYYY; parseCallsign interprets that known day-first
  // rendering for the temporal comparison (the raw claim stays verbatim), so the
  // flag fires on the same entries the ISO-normalised lane does.
  const originalStartDateColumn = rawColumnForCanonical(parsed.mapping, 'licence_version_original_start_date');
  return {
    // Corpus-unique, self-locating provenance parallel to the FOI lane's
    // foi/<entry>/<file>. Names the parse source, so line numbers and
    // reconstruction targets always refer to the file actually parsed.
    sourceFile: `opendata/${key}/${parseSource}`,
    vintage: meta.ofcomReportedUpdateIso ?? key,
    columns: parsed.headers,
    subjectColumn: callsignColumn,
    rows: parsed.records,
    categoryColumn: productColumn,
    originalStartDateColumn,
    // The 1-based physical source line of each record (issue #431), captured by
    // the line-accounting model parseRawRegister already proves - never a
    // re-parse. dataLineNumbers[k] is the source line of records[k].
    lineNumbers: parsed.dataLineNumbers,
    // The REAL repo path of the parsed file. The `sourceFile` key rewrites the
    // open-data lane's on-disk 'archive/<key>/<parseSource>' to a logical
    // 'opendata/<key>/<parseSource>', so the true path is carried here for the
    // deep-link's viewAnchor (canonical location, independent of a custom
    // archiveDir a test may pass).
    repoPath: `archive/${key}/${parseSource}`,
    // The verbatim structural framing the per-row claim stream omits (issue
    // #434): the curated + enumerated footer/blank lines parseRawRegister
    // stripped, and the header's physical line. Both come straight from the
    // authored parse - the same line accounting that proves the record count -
    // so the file-manifest emit attests them without a re-parse, and a
    // reconstruction can reinstate the footer positionally.
    ignoredLines: parsed.ignoredLines,
    headerLine: parsed.headerLines[0]?.line,
    // parseRawRegister reads the raw bytes as utf-8 (with BOM strip), so a
    // fidelity oracle re-reads the original identically (issue #434, G6).
    encoding: 'utf8',
    // The authored per-column interpretation (issue #435), lifted from the
    // variant's raw->canonical mapping + the fixed open-data date ordering, so an
    // @interpretation/<index> claim can be attested beside each @column header.
    columnInterpretations: interpretOpenDataColumns(parsed.headers, parsed.mapping, { subjectColumn: callsignColumn, categoryColumn: productColumn }),
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
      subjectKind: 'callsign',
      entry: key,
      jsonlStem: jsonlStem('opendata', key, 'raw.csv'),
      load: () => loadOpenDataRegisterSource(archiveDir, key, meta),
    });
  }
  return resolved;
}

export const openDataRegisterCollector: LedgerCollector = {
  family: 'open-data-register',
  subjectKind: 'callsign',
  collect: roots => collectOpenDataRegisterSources(roots.archiveDir),
};
