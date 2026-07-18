/**
 * Build-time generation of the two self-updating tables the callsign-systems
 * chronology narrative embeds (issue #821, following #129/#820):
 *
 *  - the FORMAT-EVOLUTION table: how the register/list export shape and column
 *    header changed over time — one row per committed tabular export, read off
 *    the archive metadata (datasetClasses / sheetsIndicative) and the VERBATIM
 *    first line of each committed export file;
 *  - the AVAILABLE-LIST enumeration: every `available-pool`-classed FOI
 *    snapshot in the early series (2013 → 2016), replacing the narrative's
 *    former by-example citation with a complete, linked list.
 *
 * Both derive ONLY from committed archive metadata and committed file bytes, so
 * a future entry appears in the rendered narrative without a prose edit — no
 * hand-typed fact that could drift from the archive. The narrative marks the
 * generated content [observed]/[derived] in its own authored prose beside each
 * token; the tables carry the verbatim evidence those tags stand on.
 *
 * The narrative (a markdown file rendered by src/shared/render-markdown.ts)
 * carries a sentinel token on its own line where each table belongs; the
 * dataset-page build replaces the rendered `<p>token</p>` with the generated
 * HTML AFTER its markdown/entity-link/epistemics-pill passes, so the tables use
 * the shared render helpers directly (dateTime for #551 humanisation,
 * absentMarker for #826 absent values, classChipLink for the dataset-class
 * cross-links) rather than being re-processed as markdown.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  listFoiEntryKeys,
  readFoiEntryMeta,
  type FoiEntryMeta,
  type FoiFileDeclaration,
} from '../shared/foi-archive.ts';
import { escapeHtml } from './render/html.ts';
import { tableCaption } from './render/tables.ts';
import { dateTime, absentMarker } from './render/format.ts';
import { classChipLink } from './build-class-pages.ts';

// The sentinel tokens the narrative carries on their own lines. Chosen so the
// markdown renderer leaves them untouched (no markup characters), emitting a
// bare `<p>token</p>` this module then replaces.
export const FORMAT_EVOLUTION_TOKEN = '{{chronology:format-evolution-table}}';
export const AVAILABLE_LIST_TOKEN = '{{chronology:available-list-enumeration}}';

// The dataset classes that ARE register/list callsign exports — the ones whose
// format the table tracks. Other classes (statistics-aggregate, issuance-events,
// reference-context, attribute-addendum on its own) are a different shape by
// design and belong to other strands of the record, not this format story.
const FORMAT_TABLE_CLASSES = new Set(['available-pool', 'register-snapshot', 'forbidden-list']);

// The one class the exhaustive enumeration closes: the available-callsign lists
// Ofcom produced on FOI request before the 2016 system change.
const AVAILABLE_POOL_CLASS = 'available-pool';

// An open-data snapshot directory is a plain ISO date.
const OPEN_DATA_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ExportLane = 'foi' | 'open-data';

export interface FormatEvolutionRow {
  // ISO date or year-month of the data (the export's vintage), or null when the
  // entry declares none. Never coerced.
  vintage: string | null;
  // The entry key: an FOI request key, or an open-data snapshot date key.
  key: string;
  lane: ExportLane;
  datasetClasses: string[];
  // The worksheet layout, from sheetsIndicative where declared (e.g.
  // "Foundation (A:H), Intermediate (A:H), Full (A:H)"), else "single table"
  // for an already-tabular single-file export.
  sheetShape: string;
  // The export's VERBATIM first line where it is a column-header row (contains a
  // field separator), byte-order-mark stripped for display; null where the
  // first line is not a column header (an early prefix/suffix list with a
  // section marker or a blank leading row — a real format fact in its own right).
  header: string | null;
}

export interface AvailableListRow {
  vintage: string | null;
  key: string;
  sheetShape: string;
}

function asSheets(decl: FoiFileDeclaration): { name?: string; cols?: string }[] | undefined {
  const si = decl.sheetsIndicative;
  if (typeof si !== 'object' || si === null || !Array.isArray((si as { sheets?: unknown }).sheets)) return undefined;
  return (si as { sheets: { name?: string; cols?: string }[] }).sheets;
}

// The worksheet layout of an entry, derived from the first data file that
// declares one; "single table" when none does (an already-tabular CSV export).
function sheetShapeOf(files: FoiEntryMeta['files']): string {
  for (const decl of Object.values(files)) {
    const sheets = asSheets(decl);
    if (sheets !== undefined && sheets.length > 0) {
      return sheets.map(s => (s.cols !== undefined ? `${s.name} (${s.cols})` : `${s.name}`)).join(', ');
    }
  }
  return 'single table';
}

// The committed tabular file whose first line carries the export's column
// header. Preference order: the first-sheet mechanical extract of a
// multi-sheet source, then any extract CSV, then a directly-disclosed data CSV.
// Undefined when the entry holds no committed tabular file at all (a copy held
// only as a PDF letter or a verbatim zip): such an entry has no committed
// header shape to show, so it is left out of the format table rather than
// faked. Exported for the test that pins this exclusion rule.
export function resolveFoiTabularFile(files: FoiEntryMeta['files']): string | undefined {
  const csvNames = (predicate: (name: string, decl: FoiFileDeclaration) => boolean): string[] =>
    Object.keys(files).filter(name => /\.csv$/i.test(name) && predicate(name, files[name])).sort();

  const hasSheets = Object.values(files).some(d => asSheets(d) !== undefined);
  if (hasSheets) {
    const firstSheetExtract = csvNames((name, decl) => decl.role === 'extract' && /^raw-extract-sheet-1-/.test(name))[0];
    if (firstSheetExtract !== undefined) return firstSheetExtract;
  }
  const anyExtract = csvNames((_name, decl) => decl.role === 'extract')[0];
  if (anyExtract !== undefined) return anyExtract;
  return csvNames((_name, decl) => decl.role === 'data')[0];
}

// The committed tabular file of an open-data snapshot: the raw CSV where the
// publication shipped one, else the mechanical first-sheet extract of a
// spreadsheet-shaped snapshot. Undefined when neither is present.
function resolveOpenDataTabularFile(snapshotDir: string): string | undefined {
  if (fs.existsSync(path.join(snapshotDir, 'raw.csv'))) return 'raw.csv';
  if (!fs.existsSync(snapshotDir)) return undefined;
  return fs.readdirSync(snapshotDir).filter(n => /^raw-extract-sheet-1-.*\.csv$/i.test(n)).sort()[0];
}

// The verbatim first line of a committed CSV IF it is a column-header row
// (carries a field separator), byte-order-mark and trailing carriage-return
// stripped for display. Null when the file is empty, unreadable, or its first
// line is not a header (no separator) — the caller renders that as an absent
// column header, which is itself the honest format fact.
function firstHeaderLine(filePath: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const newline = text.indexOf('\n');
  const line = (newline === -1 ? text : text.slice(0, newline)).replace(/\r$/, '').replace(/^﻿/, '');
  return line.includes(',') ? line : null;
}

function listOpenDataKeys(archiveDir: string): string[] {
  if (!fs.existsSync(archiveDir)) return [];
  return fs.readdirSync(archiveDir)
    .filter(n => OPEN_DATA_KEY_RE.test(n) && fs.statSync(path.join(archiveDir, n)).isDirectory())
    .sort();
}

// Order the evolution rows by vintage (the format story is chronological),
// falling back to the key so entries sharing a vintage stay deterministic and
// undated entries sort last rather than jumping the sequence.
function byVintageThenKey(a: { vintage: string | null; key: string }, b: { vintage: string | null; key: string }): number {
  const av = a.vintage ?? '￿';
  const bv = b.vintage ?? '￿';
  return av === bv ? a.key.localeCompare(b.key) : av.localeCompare(bv);
}

export function buildFormatEvolutionRows(foiDir: string, archiveDir: string): FormatEvolutionRow[] {
  const rows: FormatEvolutionRow[] = [];

  for (const key of listFoiEntryKeys(foiDir)) {
    const meta = readFoiEntryMeta(foiDir, key);
    if (!meta.datasetClasses.some(c => FORMAT_TABLE_CLASSES.has(c))) continue;
    const tabular = resolveFoiTabularFile(meta.files);
    if (tabular === undefined) continue; // held only as PDF/zip: no committed header shape
    rows.push({
      vintage: meta.dataVintage,
      key,
      lane: 'foi',
      datasetClasses: meta.datasetClasses,
      sheetShape: sheetShapeOf(meta.files),
      header: firstHeaderLine(path.join(foiDir, key, tabular)),
    });
  }

  for (const key of listOpenDataKeys(archiveDir)) {
    const snapshotDir = path.join(archiveDir, key);
    const tabular = resolveOpenDataTabularFile(snapshotDir);
    if (tabular === undefined) continue;
    rows.push({
      vintage: key,
      key,
      lane: 'open-data',
      // Open-data snapshots carry no datasetClasses field — the lane's shape IS
      // the register snapshot (matching build-class-pages' implicit class).
      datasetClasses: ['register-snapshot'],
      sheetShape: 'single table',
      header: firstHeaderLine(path.join(snapshotDir, tabular)),
    });
  }

  return rows.sort(byVintageThenKey);
}

export function buildAvailableListRows(foiDir: string): AvailableListRow[] {
  return listFoiEntryKeys(foiDir)
    .map(key => ({ key, meta: readFoiEntryMeta(foiDir, key) }))
    .filter(({ meta }) => meta.datasetClasses.includes(AVAILABLE_POOL_CLASS))
    .map(({ key, meta }) => ({ vintage: meta.dataVintage, key, sheetShape: sheetShapeOf(meta.files) }))
    .sort(byVintageThenKey);
}

// ---- Rendering ----
// depthToRoot 2: the narrative pages sit at reports/narratives/, so both the
// dataset links (../../datasets/…) and the class chip links resolve from there.

const REL_TO_DATASETS = '../../datasets/';

function vintageCell(vintage: string | null): string {
  return vintage === null ? absentMarker('vintage not declared') : dateTime(vintage, { exactLabel: 'Data vintage' });
}

function entryLink(row: { key: string; lane: ExportLane }): string {
  const href = row.lane === 'foi'
    ? `${REL_TO_DATASETS}foi/${encodeURIComponent(row.key)}/index.html`
    : `${REL_TO_DATASETS}open-data/${encodeURIComponent(row.key)}/index.html`;
  return `<a href="${href}"><code>${escapeHtml(row.key)}</code></a>`;
}

function classesCell(classes: string[]): string {
  return classes.map(c => classChipLink(c, REL_TO_DATASETS)).join(', ');
}

const LANE_LABEL: Record<ExportLane, string> = { foi: 'FOI disclosure', 'open-data': 'Open data' };

export function renderFormatEvolutionTable(rows: FormatEvolutionRow[]): string {
  const body = rows.map(r => {
    const header = r.header === null
      ? absentMarker('no column-header row')
      : `<code>${escapeHtml(r.header)}</code>`;
    return `<tr><td>${vintageCell(r.vintage)}</td><td>${entryLink(r)}</td><td>${escapeHtml(LANE_LABEL[r.lane])}</td>`
      + `<td>${classesCell(r.datasetClasses)}</td><td>${escapeHtml(r.sheetShape)}</td><td>${header}</td></tr>`;
  }).join('');
  return [
    '<div class="overflow" style="overflow-x:auto">',
    '<table>',
    tableCaption(`How the register/list export format evolved — ${rows.length} committed exports, oldest first (generated from the archive metadata)`),
    '<thead><tr><th scope="col">Vintage</th><th scope="col">Export</th><th scope="col">Lane</th><th scope="col">Dataset class</th><th scope="col">Worksheet shape</th><th scope="col">Column header (verbatim)</th></tr></thead>',
    `<tbody>${body}</tbody>`,
    '</table>',
    '</div>',
  ].join('');
}

export function renderAvailableListEnumeration(rows: AvailableListRow[]): string {
  const body = rows.map(r =>
    `<tr><td>${vintageCell(r.vintage)}</td><td>${entryLink({ key: r.key, lane: 'foi' })}</td><td>${escapeHtml(r.sheetShape)}</td></tr>`,
  ).join('');
  return [
    '<div class="overflow" style="overflow-x:auto">',
    '<table>',
    tableCaption(`Every archived available-callsign snapshot in the series — ${rows.length} in all, oldest first (generated from the archive metadata)`),
    '<thead><tr><th scope="col">Vintage</th><th scope="col">Snapshot</th><th scope="col">Worksheet shape</th></tr></thead>',
    `<tbody>${body}</tbody>`,
    '</table>',
    '</div>',
  ].join('');
}

// Replace each sentinel token — as the markdown renderer emitted it, wrapped in
// a paragraph — with its generated table. A narrative that carries neither token
// is returned unchanged, so this is safe to run over every narrative. The two
// table builders run once each here; the caller passes the already-resolved
// archive directories.
export function applyChronologyTokens(html: string, ctx: { foiDir: string; archiveDir: string }): string {
  const replacements: { token: string; make: () => string }[] = [
    { token: FORMAT_EVOLUTION_TOKEN, make: () => renderFormatEvolutionTable(buildFormatEvolutionRows(ctx.foiDir, ctx.archiveDir)) },
    { token: AVAILABLE_LIST_TOKEN, make: () => renderAvailableListEnumeration(buildAvailableListRows(ctx.foiDir)) },
  ];
  let out = html;
  for (const { token, make } of replacements) {
    const wrapped = `<p>${token}</p>`;
    if (out.includes(wrapped)) out = out.split(wrapped).join(make());
  }
  return out;
}
