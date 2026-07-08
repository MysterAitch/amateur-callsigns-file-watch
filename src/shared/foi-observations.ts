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

export function buildFoiObservations(foiDir: string): FoiObservationRow[] {
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
}

// The published flat union CSV (mandatory per the composed-stack decision):
// the same projection with nulls flattened to '' - consumers needing the
// asserted-blank vs not-asserted distinction use the SQLite form.
export function renderObservationsCsv(rows: FoiObservationRow[]): string {
  const header = ['callsign', 'entry', 'source_file', 'dataset_classes', 'vintage', ...OBSERVATION_VALUE_COLUMNS];
  const renderCell = (value: string | null): string => {
    const text = value ?? '';
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push([
      renderCell(row.callsign),
      renderCell(row.entry),
      renderCell(row.sourceFile),
      renderCell(row.datasetClasses),
      renderCell(row.vintage),
      ...OBSERVATION_VALUE_COLUMNS.map(column => renderCell(row.values[column] ?? null)),
    ].join(','));
  }
  return lines.join('\n') + '\n';
}
