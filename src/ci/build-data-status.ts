#!/usr/bin/env node

/**
 * Pre-renders the /data-status page (issue #376): a build-time-DERIVED,
 * self-maintaining tracker of every dataset the project holds or knows exists,
 * and how far each has been carried through the processing pipeline. It
 * doubles as the "what to process next" work-queue and a gap-finder.
 *
 * DERIVED, NEVER HAND-MAINTAINED. Every row and every cell is computed here
 * from real state - the committed archive (open-data publications and the FOI
 * lane), each entry's meta.json, and the source register - so the page cannot
 * drift from reality the way a hand-kept tracker would. A dataset we hold but
 * cannot yet process (a PDF not transcribed, no converter written) is a
 * legitimate, honestly-shown row: its existence and provenance are recorded
 * regardless of processability.
 *
 * This is AXIS 1 of three (processing progress). Axis 2 (source authority:
 * Official/FOI/Reference/Community/Self) and axis 3 (claim confidence) are
 * separate questions, cross-linked but never conflated here.
 *
 * The blocks are deterministic per deploy (they summarise committed data), so
 * data-status.html is fully static - no scripts - which keeps archived
 * captures complete. The injector mirrors build-home-aggregates.ts: it
 * replaces marked placeholder divs and fails loudly if they drift.
 *
 * Usage: node src/ci/build-data-status.ts <path-to-data-status.html>
 */

import * as fs from 'fs';
import * as path from 'path';
import { listArchiveKeys } from '../shared/archive.ts';
import { CONSTANTS } from '../shared/utils.ts';
import {
  type FoiEntryMeta,
  listFoiEntryKeys,
  readFoiEntryMeta,
} from '../shared/foi-archive.ts';
import { escapeHtml, humanDate } from './site-render.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const FOI_ARCHIVE_DIR = path.join(REPO_ROOT, 'archive', 'foi');
const SOURCE_REGISTER = path.join(REPO_ROOT, 'docs', 'source-register.md');

// ---- The processing pipeline (axis 1): five plain-English stages ----
// The columns of the grid, in order. Each carries a one-line definition (the
// legend) and the fine sub-steps it stands for, so a cell can elaborate to the
// individual processors behind it.
export interface StageDef {
  key: StageKey;
  label: string;
  blurb: string;
  substeps: string[];
}
export type StageKey = 'read' | 'understood' | 'validated' | 'normalised' | 'enriched';

export const STAGES: readonly StageDef[] = [
  {
    key: 'read',
    label: 'Read',
    blurb: 'Bytes turned into machine-readable rows — a container opened, sheets or CSV extracted. A PDF scan stays “not read” until it is transcribed or OCR’d.',
    substeps: ['container opened', 'sheet/CSV extracted', 'rows machine-readable'],
  },
  {
    key: 'understood',
    label: 'Understood',
    blurb: 'The domain fields in the extract are identified and mapped to the canonical shape — which column is the callsign, which the status, which the licence class.',
    substeps: ['detect callsign column', 'detect status column', 'detect licence-type column', 'map to canonical fields'],
  },
  {
    key: 'validated',
    label: 'Validated',
    blurb: 'The extract passes the committed integrity contract — line and row accounting reconcile, and values parse — enforced by the validators in CI.',
    substeps: ['line/row accounting reconciles', 'syntactic validity checked', 'dates parse'],
  },
  {
    key: 'normalised',
    label: 'Normalised',
    blurb: 'A canonical normalised CSV exists — deterministic transforms only: clean the callsign, carry status and class verbatim, render dates ISO.',
    substeps: ['clean callsign', 'normalise status', 'normalise licence class', 'normalise dates'],
  },
  {
    key: 'enriched',
    label: 'Enriched',
    blurb: 'Authoritative reference joins applied — prefix→country (ITU), RSL→region, suffix→forbidden-membership — with parsed components and quality flags attached.',
    substeps: ['parse prefix/RSL/suffix', 'join prefix→country', 'join RSL→region', 'flag forbidden-suffix membership'],
  },
];

// A cell's state. 'na' is for stages that do not apply (a record that is not a
// dataset); it is never dressed up as progress.
export type CellState = 'done' | 'partial' | 'none' | 'na';

export interface StageCell {
  state: CellState;
  // A per-dataset elaboration of why the cell reads as it does, surfaced as the
  // cell's accessible title so a reader can drill in without leaving the page.
  detail: string;
}

// Axis 2 (source authority) shown as a labelled attribute, deliberately kept
// separate from the processing grid so the two axes are not conflated.
export interface SourceAuthority {
  label: string;
  detail: string;
}

export interface DatasetRow {
  key: string;
  lane: 'open-data' | 'foi';
  title: string;
  datasetClasses: string[];
  primaryClass: string;
  recordOnly: boolean;
  vintage: string | null;
  vintageNote?: string;
  authority: SourceAuthority;
  entryHref: string;
  metaHref: string;
  stages: Record<StageKey, StageCell>;
}

// ---- Signal detection -------------------------------------------------------

function fileExists(dir: string, name: string): boolean {
  return fs.existsSync(path.join(dir, name));
}

function openDataAuthority(provenance: string | undefined): SourceAuthority {
  const detail = provenance === 'reconstructed'
    ? 'Ofcom open-data page (reconstructed from a prior download)'
    : 'Ofcom open-data page (the live watcher lane)';
  return { label: 'Official', detail };
}

function foiAuthority(meta: FoiEntryMeta): SourceAuthority {
  // The disclosure comes from an official body either way; the channel it
  // reached us through (Ofcom's own log vs a WhatDoTheyKnow thread) is the
  // honest distinction to record.
  if (meta.sourceKey.startsWith('wdtk')) {
    return { label: 'FOI', detail: 'Ofcom, disclosed via a WhatDoTheyKnow request' };
  }
  return { label: 'FOI', detail: 'Ofcom, from the FOI disclosure log / web archive' };
}

// The newest open-data publication is a full register snapshot; each carries
// raw.csv, and (once processed) normalised.csv, stats.json and components.csv.
export function buildOpenDataRows(): DatasetRow[] {
  return listArchiveKeys().map((key) => {
    const dir = path.join(CONSTANTS.DIRS.archive, key);
    const metaPath = path.join(dir, 'meta.json');
    const meta = fs.existsSync(metaPath)
      ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) as {
        provenance?: string;
        ofcomReportedUpdateIso?: string;
        normalised?: { headerVariant?: string };
        linkText?: string;
      }
      : {};
    const hasRaw = fileExists(dir, 'raw.csv');
    const hasNormalised = fileExists(dir, 'normalised.csv');
    const hasStats = fileExists(dir, 'stats.json');
    const hasComponents = fileExists(dir, 'components.csv');
    const headerVariant = meta.normalised?.headerVariant;

    const stages: Record<StageKey, StageCell> = {
      read: hasRaw
        ? { state: 'done', detail: 'raw.csv is machine-readable CSV, already extracted from the source' }
        : { state: 'none', detail: 'no raw.csv held' },
      understood: headerVariant !== undefined
        ? { state: 'done', detail: `columns mapped (header variant ${headerVariant})` }
        : hasRaw ? { state: 'partial', detail: 'columns present but not yet mapped to a header variant' }
          : { state: 'none', detail: 'nothing to identify' },
      validated: hasStats
        ? { state: 'done', detail: 'stats.json present; validated by the data validator in CI' }
        : hasRaw ? { state: 'partial', detail: 'raw held but no validation artefact' }
          : { state: 'none', detail: 'nothing to validate' },
      normalised: hasNormalised
        ? { state: 'done', detail: 'normalised.csv present (canonical schema, sorted by callsign)' }
        : { state: 'none', detail: 'no normalised.csv' },
      enriched: hasComponents
        ? { state: 'done', detail: 'components.csv present: parsed prefix/RSL/suffix, reference joins and quality flags' }
        : { state: 'none', detail: 'no components.csv' },
    };

    return {
      key,
      lane: 'open-data',
      title: meta.linkText ?? 'Amateur radio call signs (Ofcom open data)',
      datasetClasses: ['register-snapshot'],
      primaryClass: 'register-snapshot',
      recordOnly: false,
      vintage: meta.ofcomReportedUpdateIso ?? key,
      authority: openDataAuthority(meta.provenance),
      entryHref: `datasets/open-data/${encodeURIComponent(key)}/index.html`,
      metaHref: `https://github.com/MysterAitch/amateur-callsigns-file-watch/blob/main/archive/${encodeURIComponent(key)}/meta.json`,
      stages,
    };
  });
}

interface FoiSignals {
  hasStructuredExtract: boolean; // a mechanical extract, or a CSV data file
  hasTranscript: boolean; // a prose .md extract of a PDF (attested, not structured)
  hasDataBytes: boolean;
  hasNormalised: boolean;
  converterVariant: string | undefined;
  extractSheetCount: number;
  normalisedCount: number;
}

const DATA_ROLES = new Set(['data', 'data-container']);

function foiSignals(meta: FoiEntryMeta): FoiSignals {
  let hasStructuredExtract = false;
  let hasTranscript = false;
  let hasDataBytes = false;
  let hasNormalised = false;
  let extractSheetCount = 0;
  let normalisedCount = 0;
  for (const [name, file] of Object.entries(meta.files)) {
    const isCsv = name.toLowerCase().endsWith('.csv');
    if (DATA_ROLES.has(file.role)) {
      hasDataBytes = true;
      if (isCsv) hasStructuredExtract = true; // a CSV data file is itself readable
    }
    if (file.role === 'extract') {
      // A mechanical extract (extractedBy set) is structured; a plain .md
      // extract with no extractor is a human-attested prose transcription.
      if (file.extractedBy !== undefined) {
        hasStructuredExtract = true;
        extractSheetCount += 1;
      } else if (isCsv) {
        hasStructuredExtract = true;
        extractSheetCount += 1;
      } else {
        hasTranscript = true;
      }
    }
    if (file.role === 'normalised') {
      hasNormalised = true;
      normalisedCount += 1;
    }
  }
  return {
    hasStructuredExtract,
    hasTranscript,
    hasDataBytes,
    hasNormalised,
    converterVariant: meta.converter?.variant,
    extractSheetCount,
    normalisedCount,
  };
}

// A dataset whose only class is reference-context (a not-held response, a
// referral, a policy signpost) is a record, not a processable dataset. Its
// existence is worth recording; the pipeline stages simply do not apply.
function isRecordOnly(meta: FoiEntryMeta): boolean {
  const classes = meta.datasetClasses ?? [];
  return classes.length > 0 && classes.every(c => c === 'reference-context');
}

const ENRICHABLE_CLASSES = new Set(['register-snapshot', 'available-pool']);

export function buildFoiRows(foiDir: string = FOI_ARCHIVE_DIR): DatasetRow[] {
  return listFoiEntryKeys(foiDir).map((key) => {
    const meta = readFoiEntryMeta(foiDir, key);
    const classes = meta.datasetClasses ?? [];
    // Group by the first genuine dataset class; reference-context is a
    // fallback, so an entry that is also (say) an issuance-events list is filed
    // as a dataset, not buried among the records.
    const primaryClass = classes.find(c => c !== 'reference-context') ?? classes[0] ?? 'reference-context';
    const recordOnly = isRecordOnly(meta);
    const s = foiSignals(meta);

    let stages: Record<StageKey, StageCell>;
    if (recordOnly) {
      const naDetail = 'a held record, not a processable dataset — provenance recorded, pipeline not applicable';
      stages = {
        read: { state: 'na', detail: naDetail },
        understood: { state: 'na', detail: naDetail },
        validated: { state: 'na', detail: naDetail },
        normalised: { state: 'na', detail: naDetail },
        enriched: { state: 'na', detail: naDetail },
      };
    } else {
      const readCell: StageCell = s.hasStructuredExtract
        ? { state: 'done', detail: `machine-readable extract present (${s.extractSheetCount || 1} sheet/CSV extract${s.extractSheetCount === 1 ? '' : 's'})` }
        : s.hasTranscript ? { state: 'partial', detail: 'a prose transcription of the document is held; structured extraction not yet done' }
          : s.hasDataBytes ? { state: 'none', detail: 'data bytes held but not yet extracted (e.g. a scan awaiting OCR)' }
            : { state: 'none', detail: 'no readable data held' };

      const understoodCell: StageCell = s.converterVariant !== undefined
        ? { state: 'done', detail: `fields mapped to canonical shape (converter variant ${s.converterVariant})` }
        : s.hasStructuredExtract ? { state: 'partial', detail: 'columns visible in the extract but not yet mapped to a canonical converter' }
          : { state: 'none', detail: 'fields not yet identified' };

      const validatedCell: StageCell = s.hasNormalised
        ? { state: 'done', detail: 'extract→normalised chain present; row/line accounting reconciled by the FOI validator in CI' }
        : s.hasStructuredExtract ? { state: 'partial', detail: 'extract validated for structure; no canonical conversion yet' }
          : { state: 'none', detail: 'nothing validated' };

      const normalisedCell: StageCell = s.hasNormalised
        ? { state: 'done', detail: `${s.normalisedCount} normalised CSV${s.normalisedCount === 1 ? '' : 's'} present (canonical schema)` }
        : { state: 'none', detail: 'no normalised output yet' };

      const enrichable = classes.some(c => ENRICHABLE_CLASSES.has(c));
      const enrichedCell: StageCell = (s.hasNormalised && enrichable)
        ? { state: 'partial', detail: 'enriched collectively in the master database (reference joins, components, flags) rather than as a per-entry file' }
        : { state: 'none', detail: 'no reference-enrichment artefact' };

      stages = {
        read: readCell,
        understood: understoodCell,
        validated: validatedCell,
        normalised: normalisedCell,
        enriched: enrichedCell,
      };
    }

    return {
      key,
      lane: 'foi',
      title: meta.title,
      datasetClasses: classes,
      primaryClass,
      recordOnly,
      vintage: meta.dataVintage,
      vintageNote: meta.dataVintageNote,
      authority: foiAuthority(meta),
      entryHref: `datasets/foi/${encodeURIComponent(key)}/index.html`,
      metaHref: `https://github.com/MysterAitch/amateur-callsigns-file-watch/blob/main/archive/foi/${encodeURIComponent(key)}/meta.json`,
      stages,
    };
  });
}

export function buildHeldRows(foiDir: string = FOI_ARCHIVE_DIR): DatasetRow[] {
  return [...buildOpenDataRows(), ...buildFoiRows(foiDir)];
}

// ---- Known-but-absent: parsed from the source register ----------------------

export interface KnownAbsent {
  source: string;
  status: string;
  notes: string;
  section: string;
  vintage: string | null;
  action: string;
}

// Sections of the register that enumerate DATASETS (as opposed to records,
// context documents or reference sources). Only these contribute known-but-
// absent dataset rows, so context material is never mislabelled as a dataset.
const DATASET_SECTION_RE = /register snapshots|attribute addenda/i;
// The register's controlled statuses that mean "known, but not in the
// processed archive". Matched as whole tokens so a status like "partly
// ingested … Still to fetch" (partially held) is deliberately not swept in.
const ABSENT_STATUS_RE = /\bpending-(fetch|ingest)\b/;

function stripMarkdown(cell: string): string {
  return cell
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) -> text
    .trim();
}

// A best-effort ISO/month vintage from a register date cell ("2016-07",
// "~2018-12", "2013-12", "various", "2013→2025"). Returns null when no single
// point date is present, so ranges and prose never masquerade as a firm date.
function vintageFromCell(cell: string): string | null {
  const m = /(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(cell);
  if (m === null) return null;
  const month = Number(m[2]);
  // Guard against a year-range like "~2020-21" or "2017-2018" whose second
  // number is not a real month: only a valid month yields a dated vintage.
  if (month < 1 || month > 12) return null;
  return m[3] !== undefined ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`;
}

function actionFor(status: string): string {
  if (/pending-fetch/.test(status)) {
    return 'Known but not held — recover the authoritative copy (FOI disclosure log, UK Government Web Archive, or a fresh request), or ask the community for a copy.';
  }
  return 'Bytes reportedly on disk (the local drop zone) — write or wire up a converter and commit to the archive.';
}

// Parse the source register's markdown tables. A table is recognised by a
// header row followed by a `|---|` separator; the column whose header is
// "status" locates the status cell, and the first column is the source label.
// The remembered header persists within a section so a table split by a prose
// note (as the attribute-addenda table is) still parses.
export function parseKnownAbsent(markdown: string): KnownAbsent[] {
  const lines = markdown.split(/\r?\n/);
  const out: KnownAbsent[] = [];
  let section = '';
  let statusIdx = -1;
  let dateIdx = -1;
  const seen = new Set<string>();

  const cellsOf = (line: string): string[] =>
    line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());

  for (const line of lines) {
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading !== null) {
      section = heading[1].trim();
      statusIdx = -1;
      dateIdx = -1;
      continue;
    }
    if (!/^\s*\|/.test(line)) continue; // not a table row
    if (/^\s*\|[\s:|-]+\|?\s*$/.test(line)) continue; // separator row

    const cells = cellsOf(line);
    const lowered = cells.map(c => c.toLowerCase());
    // A header row declares the columns; remember where status/date sit.
    if (lowered.includes('status')) {
      statusIdx = lowered.indexOf('status');
      dateIdx = lowered.findIndex(c => c === 'date' || c === 'data vintage');
      continue;
    }
    if (statusIdx === -1 || statusIdx >= cells.length) continue;
    if (!DATASET_SECTION_RE.test(section)) continue;

    const status = stripMarkdown(cells[statusIdx]);
    if (!ABSENT_STATUS_RE.test(status)) continue;
    const source = stripMarkdown(cells[0]);
    if (source === '' || seen.has(source)) continue;
    seen.add(source);
    const notes = statusIdx + 1 < cells.length ? stripMarkdown(cells[cells.length - 1]) : '';
    const dateCell = dateIdx >= 0 && dateIdx < cells.length ? cells[dateIdx] : '';
    out.push({
      source,
      status,
      notes,
      section,
      vintage: vintageFromCell(dateCell),
      action: actionFor(status),
    });
  }
  return out;
}

export function readKnownAbsent(registerPath: string = SOURCE_REGISTER): KnownAbsent[] {
  if (!fs.existsSync(registerPath)) return [];
  return parseKnownAbsent(fs.readFileSync(registerPath, 'utf8'));
}

// ---- Series & gaps ----------------------------------------------------------

export interface SeriesGap { from: string; to: string; months: number; }
export interface Series {
  label: string;
  classKey: string;
  vintages: { key: string; vintage: string; href: string }[];
  latest: string | null;
  earliest: string | null;
  gaps: SeriesGap[];
  knownAbsentCount: number;
}

// Human labels for the dataset classes, used as series names and group headings.
export const CLASS_LABELS: Readonly<Record<string, string>> = {
  'register-snapshot': 'Register snapshots',
  'available-pool': 'Available-pool lists',
  'forbidden-list': 'Forbidden-suffix lists',
  'issuance-events': 'Issuance-event lists',
  'statistics-aggregate': 'Statistics & aggregates',
  'attribute-addendum': 'Attribute addenda',
  'reference-context': 'Records & context (not datasets)',
};

const CLASS_ORDER = [
  'register-snapshot', 'available-pool', 'forbidden-list', 'issuance-events',
  'statistics-aggregate', 'attribute-addendum', 'reference-context',
];

function monthIndex(vintage: string): number | null {
  const m = /^(\d{4})-(\d{2})/.exec(vintage);
  return m === null ? null : Number(m[1]) * 12 + (Number(m[2]) - 1);
}

// Consecutive-vintage gaps over a threshold (months), so a long silence in a
// series is visible without inventing "days ago" arithmetic (which would make
// the page non-deterministic). Purely a function of the committed vintages.
const GAP_THRESHOLD_MONTHS = 9;

export function buildSeries(rows: DatasetRow[], knownAbsent: KnownAbsent[]): Series[] {
  const series: Series[] = [];
  for (const classKey of CLASS_ORDER) {
    if (classKey === 'reference-context') continue; // records, not a time series
    const members = rows
      .filter(r => !r.recordOnly && r.datasetClasses.includes(classKey) && r.vintage !== null)
      .map(r => ({ key: r.key, vintage: r.vintage as string, href: r.entryHref }))
      .sort((a, b) => a.vintage.localeCompare(b.vintage));
    if (members.length === 0) continue;

    const gaps: SeriesGap[] = [];
    for (let i = 1; i < members.length; i += 1) {
      const prev = monthIndex(members[i - 1].vintage);
      const curr = monthIndex(members[i].vintage);
      if (prev === null || curr === null) continue;
      const months = curr - prev;
      if (months >= GAP_THRESHOLD_MONTHS) {
        gaps.push({ from: members[i - 1].vintage, to: members[i].vintage, months });
      }
    }
    // A known-absent item counts towards this series when its register section
    // matches the class (register snapshots ↔ register-snapshot, addenda ↔
    // attribute-addendum); a light, honest attribution, not a precise join.
    const sectionMatch = classKey === 'register-snapshot' ? /register snapshots/i
      : classKey === 'attribute-addendum' ? /attribute addenda/i : null;
    const knownAbsentCount = sectionMatch === null ? 0
      : knownAbsent.filter(k => sectionMatch.test(k.section)).length;

    series.push({
      label: CLASS_LABELS[classKey] ?? classKey,
      classKey,
      vintages: members,
      latest: members[members.length - 1].vintage,
      earliest: members[0].vintage,
      gaps,
      knownAbsentCount,
    });
  }
  return series;
}

// ---- Rendering --------------------------------------------------------------

const GLYPH: Record<CellState, string> = { done: '✓', partial: '~', none: '✗', na: '·' };
const STATE_WORD: Record<CellState, string> = { done: 'done', partial: 'partial', none: 'not done', na: 'not applicable' };

function cellHtml(stageLabel: string, cell: StageCell): string {
  const title = `${stageLabel}: ${STATE_WORD[cell.state]} — ${cell.detail}`;
  return `<td class="cell"><span class="pill st-${cell.state}" title="${escapeHtml(title)}">`
    + `<span aria-hidden="true">${GLYPH[cell.state]}</span>`
    + `<span class="visually-hidden">${escapeHtml(`${stageLabel} ${STATE_WORD[cell.state]}`)}</span>`
    + '</span></td>';
}

function humaniseVintage(v: string | null): string {
  if (v === null) return '<span class="muted">not dated</span>';
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? escapeHtml(humanDate(v)) : escapeHtml(v);
}

function rowHtml(row: DatasetRow): string {
  const cells = STAGES.map(s => cellHtml(s.label, row.stages[s.key])).join('');
  const classNote = row.datasetClasses.length > 1
    ? ` <span class="muted">(${escapeHtml(row.datasetClasses.join(', '))})</span>` : '';
  // Lead with the human dataset name (issue #328); the raw archive key follows
  // as a secondary, monospace identifier so a reader sees what the dataset is
  // before its machine key. The name links to the entry page for provenance.
  return `<tr>`
    + `<th scope="row" class="dskey"><a href="${row.entryHref}">${escapeHtml(row.title)}</a>${classNote}`
    + `<span class="dstitle"><span class="mono">${escapeHtml(row.key)}</span></span></th>`
    + `<td class="vintage">${humaniseVintage(row.vintage)}</td>`
    + `<td class="auth"><span class="atag" title="${escapeHtml(`Axis 2 (source authority): ${row.authority.detail}`)}">${escapeHtml(row.authority.label)}</span></td>`
    + cells
    + '</tr>';
}

// The main inventory grid: held datasets grouped by data type, one row each,
// with the five processing-stage cells. Groups follow CLASS_ORDER so like sits
// with like and an empty stage stands out against its neighbours.
export function renderInventoryGrid(rows: DatasetRow[]): string {
  const headCells = STAGES.map(s =>
    `<th scope="col" class="cell" title="${escapeHtml(s.blurb)}">${escapeHtml(s.label)}</th>`).join('');
  const head = `<thead><tr><th scope="col">Dataset</th><th scope="col">Vintage</th>`
    + `<th scope="col" title="Axis 2 — source authority, a separate question from processing">Source</th>${headCells}</tr></thead>`;

  const groups = [...CLASS_ORDER];
  for (const r of rows) if (!groups.includes(r.primaryClass)) groups.push(r.primaryClass);

  const sections: string[] = [];
  for (const classKey of groups) {
    const members = rows
      .filter(r => r.primaryClass === classKey)
      .sort((a, b) => (a.vintage ?? '￿').localeCompare(b.vintage ?? '￿') || a.key.localeCompare(b.key));
    if (members.length === 0) continue;
    const label = CLASS_LABELS[classKey] ?? classKey;
    sections.push(
      `<tbody><tr class="grouprow"><th scope="colgroup" colspan="${3 + STAGES.length}">${escapeHtml(label)} <span class="muted">(${members.length})</span></th></tr>`
      + members.map(rowHtml).join('')
      + '</tbody>',
    );
  }
  return `<div class="overflow"><table class="grid">${head}${sections.join('')}</table></div>`;
}

// Per-type rollup: for each data type, how many datasets it holds and, per
// stage, how many are fully done vs partial — the "n exist, n fully run, n
// partial" summary the issue asks for.
export function renderRollup(rows: DatasetRow[]): string {
  const groups = [...CLASS_ORDER];
  for (const r of rows) if (!groups.includes(r.primaryClass)) groups.push(r.primaryClass);
  const stageHead = STAGES.map(s => `<th scope="col" class="num">${escapeHtml(s.label)}</th>`).join('');
  const bodyRows: string[] = [];
  for (const classKey of groups) {
    const members = rows.filter(r => r.primaryClass === classKey && !r.recordOnly);
    if (members.length === 0) continue;
    const cells = STAGES.map((s) => {
      const done = members.filter(r => r.stages[s.key].state === 'done').length;
      const partial = members.filter(r => r.stages[s.key].state === 'partial').length;
      const text = partial > 0 ? `${done}✓ ${partial}~` : `${done}✓`;
      return `<td class="num">${text}</td>`;
    }).join('');
    bodyRows.push(`<tr><th scope="row">${escapeHtml(CLASS_LABELS[classKey] ?? classKey)}</th>`
      + `<td class="num">${members.length}</td>${cells}</tr>`);
  }
  return `<div class="overflow"><table><thead><tr><th scope="col">Data type</th>`
    + `<th scope="col" class="num">Datasets</th>${stageHead}</tr></thead><tbody>${bodyRows.join('')}</tbody></table></div>`
    + '<p class="muted">Per stage: how many datasets of that type are fully done (✓) and, where relevant, partial (~). Records that are not datasets are excluded.</p>';
}

// The known-but-absent table: datasets the source register names that the
// processed archive does not yet hold, each with the register's own status,
// notes, and a plain next-step. This is the gap-finder and the work-queue.
export function renderKnownAbsent(items: KnownAbsent[]): string {
  if (items.length === 0) {
    return '<p class="muted">The source register lists no dataset as pending-fetch or pending-ingest — nothing known-but-absent to show.</p>';
  }
  const rows = items.map(k =>
    `<tr><th scope="row">${escapeHtml(k.source)}</th>`
    + `<td>${humaniseVintage(k.vintage)}</td>`
    + `<td><code>${escapeHtml(k.status)}</code></td>`
    + `<td>${escapeHtml(k.action)}</td></tr>`).join('');
  return `<div class="overflow"><table><thead><tr>`
    + '<th scope="col">Dataset (from the register)</th><th scope="col">Vintage</th>'
    + '<th scope="col">Register status</th><th scope="col">Suggested next step</th>'
    + `</tr></thead><tbody>${rows}</tbody></table></div>`
    + '<p class="muted">Parsed from the dataset sections of '
    + '<a href="https://github.com/MysterAitch/amateur-callsigns-file-watch/blob/main/docs/source-register.md">docs/source-register.md</a> '
    + '— every row whose status is <code>pending-fetch</code> or <code>pending-ingest</code>. '
    + 'On the grid these sit at “Read ✗”: known to exist, provenance recorded, not yet held.</p>';
}

// Series coverage & gaps: per data type, the vintages held over time, the
// latest (staleness at a glance), and any long silence between consecutive
// held vintages — so a gap and a stale series are visible facts.
export function renderSeriesGaps(series: Series[]): string {
  const blocks = series.map((sv) => {
    const timeline = sv.vintages
      .map(v => `<a class="vpill" href="${v.href}" title="${escapeHtml(v.key)}">${humaniseVintage(v.vintage)}</a>`)
      .join(' ');
    const gapNotes = sv.gaps.length === 0
      ? ''
      : '<ul class="gaps">' + sv.gaps.map(g =>
        `<li>Gap of ${g.months} months between <b>${humaniseVintage(g.from)}</b> and <b>${humaniseVintage(g.to)}</b> — consider recovering an intervening snapshot (FOI request or community copy).</li>`).join('') + '</ul>';
    const absentNote = sv.knownAbsentCount > 0
      ? `<p class="muted">${sv.knownAbsentCount} further ${sv.knownAbsentCount === 1 ? 'dataset is' : 'datasets are'} known-but-absent in this series (see the table above).</p>`
      : '';
    return `<div class="series"><h3>${escapeHtml(sv.label)} `
      + `<span class="muted">(${sv.vintages.length} held, ${humaniseVintage(sv.earliest)} → ${humaniseVintage(sv.latest)})</span></h3>`
      + `<p class="timeline">${timeline}</p>${gapNotes}${absentNote}</div>`;
  });
  return blocks.join('')
    + `<p class="muted">A “gap” is a silence of ${GAP_THRESHOLD_MONTHS} months or more between consecutive held vintages — a deterministic fact of the committed data, not a judgement. The latest held vintage in each series is its staleness at a glance. A dataset carrying more than one class appears in each of its series, so a series count can exceed that type's group on the grid (which files each dataset once, under its primary class).</p>`;
}

// ---- Injection --------------------------------------------------------------

const PLACEHOLDER = 'generated at deploy time — build the site to populate';

export function injectDataStatus(pagePath: string, foiDir: string = FOI_ARCHIVE_DIR, registerPath: string = SOURCE_REGISTER): void {
  const rows = buildHeldRows(foiDir);
  const knownAbsent = readKnownAbsent(registerPath);
  const series = buildSeries(rows, knownAbsent);

  const heldCount = rows.filter(r => !r.recordOnly).length;
  const recordCount = rows.filter(r => r.recordOnly).length;
  const summary = `<p class="lead">Tracking <b>${rows.length}</b> held ${rows.length === 1 ? 'dataset' : 'datasets'} `
    + `(<b>${heldCount}</b> processable, <b>${recordCount}</b> records/context) and `
    + `<b>${knownAbsent.length}</b> known-but-absent, all derived at build time from the committed archive and the source register.</p>`;

  let html = fs.readFileSync(pagePath, 'utf8');
  const replacements: [string, string][] = [
    [`<div id="ds-summary">${PLACEHOLDER}</div>`, `<div id="ds-summary" data-prerendered>${summary}</div>`],
    [`<div id="ds-grid">${PLACEHOLDER}</div>`, `<div id="ds-grid" data-prerendered>${renderInventoryGrid(rows)}</div>`],
    [`<div id="ds-rollup">${PLACEHOLDER}</div>`, `<div id="ds-rollup" data-prerendered>${renderRollup(rows)}</div>`],
    [`<div id="ds-known-absent">${PLACEHOLDER}</div>`, `<div id="ds-known-absent" data-prerendered>${renderKnownAbsent(knownAbsent)}</div>`],
    [`<div id="ds-series">${PLACEHOLDER}</div>`, `<div id="ds-series" data-prerendered>${renderSeriesGaps(series)}</div>`],
  ];
  for (const [placeholder, replacement] of replacements) {
    if (!html.includes(placeholder)) throw new Error(`placeholder not found in ${pagePath}: ${placeholder}`);
    html = html.replace(placeholder, replacement);
  }
  const sha = (process.env.GITHUB_SHA ?? 'dev').slice(0, 9);
  html = html.replace('<span id="build-sha"></span>', ` from commit <code>${sha}</code>`);
  fs.writeFileSync(pagePath, html);
}

function main(): void {
  const [pagePath] = process.argv.slice(2).filter(a => a.trim().length > 0);
  if (!pagePath) {
    console.error('usage: node src/ci/build-data-status.ts <path-to-data-status.html>');
    process.exitCode = 1;
    return;
  }
  injectDataStatus(pagePath);
  console.log(`data-status page pre-rendered into ${pagePath}`);
}

if (import.meta.main) {
  main();
}
