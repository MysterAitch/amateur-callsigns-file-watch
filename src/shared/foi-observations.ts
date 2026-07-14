/**
 * The per-callsign observations projection (issue #149 item 4): folds every
 * callsign-bearing FOI normalised file into one union shape for downstream
 * consumption - the SQLite observations table and the published union CSV.
 *
 * This is the presentation-stratum union the schema decision deliberately
 * kept OUT of the committed files: here `null` means the source file does
 * not carry the column (not asserted) while '' means the source asserted a
 * blank - a distinction SQLite represents honestly (NULL vs '') and the
 * derived CSV flattens (documented limitation; the SQLite is the faithful
 * form). The union column set is closed by construction: family cores plus
 * the registered extension vocabulary, both governance-tested.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { listFoiEntryKeys, readFoiEntryMeta } from './foi-archive.ts';
import { time } from './perf.ts';

// The union projection's value columns: the callsign-bearing families'
// cores (minus callsign itself) plus every registered extension column
// that rides on a callsign-keyed row. Suffix-list, counts-aggregate and
// database-fields rows have no callsign and do not project.
export const OBSERVATION_VALUE_COLUMNS: readonly string[] = [
  'status',
  'licence_class',
  'event',
  'event_date',
  'suffix',
  'reserved_to_date',
  'licence_issued_date',
  'created_date',
  'original_start_date',
  'reason',
  'licence_number',
  'con_id',
];

export interface FoiObservationRow {
  callsign: string;
  entry: string;
  sourceFile: string;
  datasetClasses: string;
  vintage: string | null;
  values: Record<string, string | null>;
}

interface FoiObservationsCacheEntry {
  signature: string;
  rows: FoiObservationRow[];
}
const foiObservationsCache = new Map<string, FoiObservationsCacheEntry>();

// A signature of every normalised FOI file the build folds in (path + mtime),
// so the memo serves cached rows only while the inputs are unchanged and
// rebuilds the moment any file is edited.
function foiInputsSignature(foiDir: string): string {
  const parts: string[] = [];
  for (const entry of listFoiEntryKeys(foiDir)) {
    const meta = readFoiEntryMeta(foiDir, entry);
    for (const [fileName, declaration] of Object.entries(meta.files)) {
      if (declaration.role !== 'normalised') continue;
      parts.push(`${entry}/${fileName}:${fs.statSync(path.join(foiDir, entry, fileName)).mtimeMs}`);
    }
  }
  return parts.join('|');
}

// Clear the memo. For test isolation only; a build runs one process to
// completion and never needs it.
export function resetFoiObservationsCache(): void {
  foiObservationsCache.clear();
}

export function buildFoiObservations(foiDir: string): FoiObservationRow[] {
  // Several build steps fold the same FOI files into this union within one
  // process (the combined/tiers build, the forbidden-suffix cohort, the value
  // catalogue). Memoise by directory + input signature so repeats reuse the
  // first build's rows; every consumer reads them without mutating in place, so
  // a shared array is byte-identical to rebuilding. Edited inputs rebuild.
  const cacheKey = path.resolve(foiDir);
  const signature = foiInputsSignature(foiDir);
  const cached = foiObservationsCache.get(cacheKey);
  if (cached !== undefined && cached.signature === signature) return cached.rows;
  const result = time('foi-observations:build', () => {
    const rows: FoiObservationRow[] = [];
    for (const entry of listFoiEntryKeys(foiDir)) {
      const meta = readFoiEntryMeta(foiDir, entry);
      for (const [fileName, declaration] of Object.entries(meta.files)) {
        if (declaration.role !== 'normalised') continue;
        const records = parse(fs.readFileSync(path.join(foiDir, entry, fileName), 'utf8'), {
          columns: true,
          skip_empty_lines: true,
        }) as Record<string, string>[];
        if (records.length === 0 || records[0]['callsign'] === undefined) continue;

        const present = new Set(Object.keys(records[0]));
        const datasetClasses = (declaration.datasetClasses ?? meta.datasetClasses).join(',');
        for (const record of records) {
          const values: Record<string, string | null> = {};
          for (const column of OBSERVATION_VALUE_COLUMNS) {
            // null = the file does not assert this column; '' = the source
            // asserted a blank. The distinction IS the point.
            values[column] = present.has(column) ? record[column] : null;
          }
          rows.push({
            callsign: record['callsign'],
            entry,
            sourceFile: fileName,
            datasetClasses,
            vintage: meta.dataVintage,
            values,
          });
        }
      }
    }
    return rows;
  });
  foiObservationsCache.set(cacheKey, { signature, rows: result });
  return result;
}

const OBSERVATION_CSV_HEADER = ['callsign', 'entry', 'source_file', 'dataset_classes', 'vintage', ...OBSERVATION_VALUE_COLUMNS].join(',');

function renderObservationCell(value: string | null): string {
  const text = value ?? '';
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function renderObservationLine(row: FoiObservationRow): string {
  return [
    renderObservationCell(row.callsign),
    renderObservationCell(row.entry),
    renderObservationCell(row.sourceFile),
    renderObservationCell(row.datasetClasses),
    renderObservationCell(row.vintage),
    ...OBSERVATION_VALUE_COLUMNS.map(column => renderObservationCell(row.values[column] ?? null)),
  ].join(',');
}

// The published flat union CSV (mandatory per the composed-stack decision):
// the same projection with nulls flattened to '' - consumers needing the
// asserted-blank vs not-asserted distinction use the SQLite form.
export function renderObservationsCsv(rows: FoiObservationRow[]): string {
  const lines = [OBSERVATION_CSV_HEADER];
  for (const row of rows) lines.push(renderObservationLine(row));
  return lines.join('\n') + '\n';
}

// The whole-archive union as a UTF-8 Buffer, assembled in row batches. The
// flat union of every callsign-bearing FOI file exceeds V8's maximum
// single-string length, so it cannot be produced by one `join`; batching into
// Buffers (a Buffer's ceiling is far higher) keeps it byte-for-byte identical
// to renderObservationsCsv while staying within the string limit per batch.
export function renderObservationsCsvBuffer(rows: FoiObservationRow[], batchSize = 100_000): Buffer {
  const chunks: Buffer[] = [];
  let batch: string[] = [OBSERVATION_CSV_HEADER];
  const flush = (): void => {
    chunks.push(Buffer.from(batch.join('\n') + '\n', 'utf8'));
    batch = [];
  };
  for (const row of rows) {
    batch.push(renderObservationLine(row));
    if (batch.length >= batchSize) flush();
  }
  if (batch.length > 0) flush();
  return Buffer.concat(chunks);
}
