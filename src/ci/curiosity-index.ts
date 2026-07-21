#!/usr/bin/env node

/**
 * Per-record curiosity index (issue #866, build side): a reference-free rarity
 * score for every record in a publication, sorted descending into a browsable
 * "most unusual records" report.
 *
 * WHAT it is. For each record we observe four categorical attributes the
 * pipeline already derives — the status/product pair, the callsign shape, the
 * flag combination and the licence-version date behaviour — and ask, of each,
 * how UNUSUAL this record's value is AMONG the records in the SAME
 * publication. "Unusual" is made precise as Shannon
 * surprisal: a value shared by a fraction f of the records carries
 * -log2(f) bits, so the single commonest value costs almost nothing and a
 * one-of-158k value costs ~17 bits. The curiosity index is the weighted sum of
 * the per-component surprisals; the report sorts by it and shows the working.
 *
 * WHY reference-free. Every frequency is computed from the publication's OWN
 * records — no external reference table, no authored "these are the odd ones"
 * list. The rarity emerges from the data: GOOUC and the unparseable
 * English-word tokens surface themselves because their shape (an all-letters
 * form the register never issues) IS rare, not because anyone flagged them.
 * The unparseable status is deliberately NOT a scoring input — leaning on it
 * would be circular (scoring "this is odd" with "we could not parse it"); the
 * shape earns their rank on its own. The scoring rules
 * are authored and documented (below and in CURIOSITY_COMPONENTS); which
 * records rank is then OBSERVED, never fitted.
 *
 * WHAT it is NOT. The index is a curiosity heuristic, not a quality judgement:
 * a rare record is not a wrong record. An antique 1903 issue, a visitor
 * reciprocal callsign and a genuine data defect can all score highly for the
 * same reason — they are uncommon — and the report says so. It surfaces
 * candidates for a human's attention (serendipity as a feature), nothing more.
 *
 * The score is [derived]: it is a deterministic function of the committed
 * derived views (components.csv + normalised.csv), reproducible from them and
 * carrying no independent authority over the raw record.
 *
 * Build side only. This module scores and renders the committed golden report
 * (reports/curiosity-index.md) through the report sweep, exactly as the other
 * standing reports do. The reader-facing page is a follow-up under the #104
 * page conventions.
 */

import * as fs from 'fs';
import * as path from 'path';
import { callsignPattern } from '../shared/stats.ts';
import { mdCode } from '../shared/markdown.ts';
import { parseCsvCached } from '../shared/parse-cache.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import { derivedEntryFile, derivedEntryFileExists } from '../shared/derived-entries.ts';

// The committed golden the report sweep regenerates and the drift gate pins.
export const CURIOSITY_INDEX_PATH = 'reports/curiosity-index.md';

// How many of the most-unusual records the report enumerates with full
// breakdowns. A standing, browsable top-N — large enough to clear the small
// unparseable cohort and reach the rare-shape/rare-flag long tail behind it.
export const CURIOSITY_TOP_N = 25;

// The named rarity signals. Each maps a record to ONE categorical value whose
// empirical frequency (within the scored publication) drives its surprisal.
// The `id`s are the stable component keys; `derive` reads the value off a
// record; `weight` scales the component's bits into the index (all 1.0 by
// default — equal weighting is the least-overfit choice, and kept here as the
// single place to retune should one signal ever prove to dominate spuriously).
export type ComponentId =
  | 'status-product'
  | 'shape'
  | 'flags'
  | 'date-behaviour';

export interface CuriosityRecord {
  callsign: string;
  // The parse status is read but is NOT a scoring component (see the module
  // header: scoring "unusual" with "unparseable" would be circular, and the
  // shape already carries the signal). It is retained so a consumer — the
  // corpus test's cohort selection, a future reader-facing filter — can
  // identify the unparseable/visitor records without re-deriving them.
  parseStatus: string;
  flags: string;
  status: string;
  product: string;
  originalStart: string;
  lastModified: string;
}

export interface ComponentDef {
  id: ComponentId;
  // Short label for the report's signal column.
  label: string;
  // One-line explanation of what the signal measures and why it is curious.
  description: string;
  weight: number;
  derive: (record: CuriosityRecord) => string;
}

// A blank cell rendered as an explicit token, so "(blank)" is a value a
// frequency can be computed for rather than an invisible gap.
function orBlank(value: string): string {
  return value === '' ? '(blank)' : value;
}

// The licence-version date behaviour category. The two version dates travel
// together in the norm; the curious cases are the asymmetries (only one
// present) and the ordering anomaly (a version modified BEFORE it started).
// ISO YYYY-MM-DD strings compare chronologically as plain strings.
export function dateBehaviour(originalStart: string, lastModified: string): string {
  const hasStart = originalStart !== '';
  const hasMod = lastModified !== '';
  if (!hasStart && !hasMod) return 'no-version-dates';
  if (hasStart && !hasMod) return 'original-start-only';
  if (!hasStart && hasMod) return 'last-modified-only';
  if (originalStart === lastModified) return 'unmodified-since-start';
  if (lastModified < originalStart) return 'modified-before-start';
  return 'modified-after-start';
}

export const CURIOSITY_COMPONENTS: readonly ComponentDef[] = [
  {
    id: 'status-product',
    label: 'status / product',
    description: 'rarity of the licence status paired with the product description (a blank product against an active status, an uncommon combination)',
    weight: 1,
    // The status and product joined with " / " (neither value contains a
    // solidus, so the pairing is unambiguous, and it renders cleanly in the
    // table where a literal pipe would become a {U+007C} marker).
    derive: record => `${orBlank(record.status)} / ${orBlank(record.product)}`,
  },
  {
    id: 'shape',
    label: 'callsign shape',
    description: 'rarity of the callsign’s abstract shape (A = letter, N = digit, invisibles as {U+XXXX} markers) — an all-letters or over-long shape is far from the ANAAA norm',
    weight: 1,
    derive: record => callsignPattern(record.callsign),
  },
  {
    id: 'flags',
    label: 'flag combination',
    description: 'rarity of the exact set of per-record flags carried (the overwhelming majority carry none, so any flag — and especially a combination — is unusual)',
    weight: 1,
    derive: record => (record.flags === '' ? '(none)' : record.flags),
  },
  {
    id: 'date-behaviour',
    label: 'date behaviour',
    description: 'rarity of the licence-version date pattern (both dates present and later-modified is the norm; a lone date, or a modification before the start, is uncommon)',
    weight: 1,
    derive: record => dateBehaviour(record.originalStart, record.lastModified),
  },
];

// One scored component of one record: the value observed, how many records in
// the publication share it, and the (weighted) bits of surprisal it contributes.
export interface ScoredComponent {
  id: ComponentId;
  label: string;
  value: string;
  sharedCount: number;
  total: number;
  bits: number;
}

// One scored record: its identity, its total curiosity index (bits) and the
// per-component breakdown that sums to it (the show-the-working evidence).
export interface ScoredRecord {
  callsign: string;
  index: number;
  totalBits: number;
  components: ScoredComponent[];
}

// Surprisal in bits of a value shared by `count` of `total` records. `count`
// is always >= 1 for a value that occurs (the record itself), so f > 0.
function surprisalBits(count: number, total: number): number {
  return -Math.log2(count / total);
}

// Score every record against every component: build each component's frequency
// table over the whole publication, then decompose each record into its
// per-component bits and sum (weighted) into its curiosity index. The result is
// sorted most-curious first, ties broken deterministically by callsign then by
// original row order, so the ordering — and the rendered report — is stable.
export function scoreCuriosity(records: readonly CuriosityRecord[]): ScoredRecord[] {
  const total = records.length;
  // Per-component value -> occurrence count across the publication.
  const frequencies = CURIOSITY_COMPONENTS.map(() => new Map<string, number>());
  const perRecordValues: string[][] = records.map((record) => {
    return CURIOSITY_COMPONENTS.map((component, c) => {
      const value = component.derive(record);
      frequencies[c].set(value, (frequencies[c].get(value) ?? 0) + 1);
      return value;
    });
  });

  const scored: ScoredRecord[] = records.map((record, index) => {
    let totalBits = 0;
    const components: ScoredComponent[] = CURIOSITY_COMPONENTS.map((component, c) => {
      const value = perRecordValues[index][c];
      const sharedCount = frequencies[c].get(value) ?? 0;
      const bits = surprisalBits(sharedCount, total) * component.weight;
      totalBits += bits;
      return { id: component.id, label: component.label, value, sharedCount, total, bits };
    });
    // Each record's breakdown leads with its strongest signal.
    components.sort((a, b) => (b.bits - a.bits) || componentOrder(a.id) - componentOrder(b.id));
    return { callsign: record.callsign, index, totalBits, components };
  });

  scored.sort((a, b) =>
    (b.totalBits - a.totalBits)
    || (a.callsign < b.callsign ? -1 : a.callsign > b.callsign ? 1 : 0)
    || (a.index - b.index));
  return scored;
}

function componentOrder(id: ComponentId): number {
  return CURIOSITY_COMPONENTS.findIndex(component => component.id === id);
}

// --- Reading a publication's records ----------------------------------------

// Join a publication's components.csv (parse status, flags, shape source) and
// normalised.csv (status, product, version dates) into the scorable record
// shape. Both derived views are read through the archive/projection switch;
// they are the SAME row order (both row-preserving projections of one raw
// register), keyed on the callsign column, so a row-index zip is exact — and
// verified as such: a callsign mismatch at any index is an integrity failure,
// never silently joined across.
export function readPublicationRecords(key: string): CuriosityRecord[] {
  const componentsRows = parseCsvCached(derivedEntryFile(key, 'components.csv'), { columns: true, skip_empty_lines: true });
  const normalisedRows = parseCsvCached(derivedEntryFile(key, 'normalised.csv'), { columns: true, skip_empty_lines: true });
  if (componentsRows.length !== normalisedRows.length) {
    throw new Error(`curiosity-index: ${key} components.csv (${componentsRows.length} rows) and normalised.csv (${normalisedRows.length} rows) disagree on row count — cannot join by row order`);
  }
  return componentsRows.map((component, i) => {
    const normalised = normalisedRows[i];
    const callsign = component.callsign ?? '';
    if (callsign !== (normalised.callsign ?? '')) {
      throw new Error(`curiosity-index: ${key} row ${i} callsign mismatch — components.csv "${callsign}" vs normalised.csv "${normalised.callsign ?? ''}"`);
    }
    return {
      callsign,
      parseStatus: component.parse_status ?? '',
      flags: component.flags ?? '',
      status: normalised.status ?? '',
      product: normalised.product ?? '',
      originalStart: normalised.licence_version_original_start_date ?? '',
      lastModified: normalised.licence_version_last_modified_date ?? '',
    };
  });
}

// The newest publication that carries both derived views in the current read
// mode — the one the report scores. Scans newest-first so a raw-only or
// still-underived newest entry (a foreign source, a fixture) is passed over
// rather than crashing the sweep; undefined when none qualifies.
export function newestCuriosityKey(): string | undefined {
  const keys = listArchiveKeys();
  for (let i = keys.length - 1; i >= 0; i--) {
    const key = keys[i];
    if (derivedEntryFileExists(key, 'components.csv') && derivedEntryFileExists(key, 'normalised.csv')) {
      return key;
    }
  }
  return undefined;
}

// --- Rendering --------------------------------------------------------------

// Deterministic integer grouping (1234567 -> "1,234,567"), independent of ICU
// locale data so the golden reproduces byte-for-byte everywhere.
function fmtInt(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// A percentage to three significant figures — enough to separate a
// one-in-a-hundred-thousand tail (0.000632%) from the ~100% norm, and never
// exponential for the frequencies in range.
function fmtPct(count: number, total: number): string {
  return `${((count / total) * 100).toPrecision(3)}%`;
}

function fmtBits(bits: number): string {
  return bits.toFixed(2);
}

// The two or three signals carrying the most bits, for the summary table's
// at-a-glance "why is this here" column.
function leadingSignals(record: ScoredRecord): string {
  return record.components
    .filter(component => component.bits > 0.005)
    .slice(0, 3)
    .map(component => `${component.label} ${fmtBits(component.bits)}`)
    .join('; ');
}

export function renderCuriosityIndex(key: string, scored: readonly ScoredRecord[]): string {
  const total = scored.length;
  const top = scored.slice(0, CURIOSITY_TOP_N);

  const rulesTable = [
    '| signal | what it measures |',
    '|---|---|',
    ...CURIOSITY_COMPONENTS.map(component =>
      `| ${component.label} | ${component.description}${component.weight === 1 ? '' : ` (weight ×${component.weight})`} |`),
  ];

  const summaryTable = [
    '| rank | callsign | curiosity index (bits) | leading signals |',
    '|---:|---|---:|---|',
    ...top.map((record, i) =>
      `| ${i + 1} | ${mdCode(record.callsign)} | ${fmtBits(record.totalBits)} | ${leadingSignals(record)} |`),
  ];

  const breakdowns = top.flatMap((record, i) => {
    const componentRows = record.components.map(component =>
      `| ${component.label} | ${mdCode(component.value)} | ${fmtInt(component.sharedCount)} of ${fmtInt(component.total)} | ${fmtPct(component.sharedCount, component.total)} | ${fmtBits(component.bits)} |`);
    return [
      `### ${i + 1}. ${mdCode(record.callsign)} — ${fmtBits(record.totalBits)} bits`,
      '',
      '| signal | this record’s value | records sharing it | share | bits |',
      '|---|---|---|---:|---:|',
      ...componentRows,
      `| **total** | | | | **${fmtBits(record.totalBits)}** |`,
      '',
    ];
  });

  const lines = [
    '# Per-record curiosity index',
    '',
    '<!-- Generated by the report sweep (issue #866); regenerated wholesale, so hand edits are overwritten. -->',
    `A reference-free rarity score for every record in the newest publication (**${key}**, ${fmtInt(total)} records), sorted to surface the most unusual. For each record we ask, of several attributes the pipeline already derives, how uncommon this record’s value is *among the records in this same publication*, and add up the surprises.`,
    '',
    'Each signal contributes **Shannon surprisal**: a value shared by a fraction _f_ of the records carries −log₂(_f_) bits, so the commonest value costs almost nothing and a one-of-a-kind value costs the most. The **curiosity index** is the (weighted) sum of the per-signal bits. Every frequency is computed from the publication’s own records — no external reference list, no hand-picked “odd ones”; the rarity emerges from the data.',
    '',
    'This is a **curiosity heuristic, not a quality judgement**: a rare record is not a wrong record. An antique issue, a visitor reciprocal callsign and a genuine data defect can all score highly for the same reason — they are uncommon. The score is [derived]: a deterministic function of the committed derived views, carrying no independent authority over the raw record. It surfaces candidates for a human’s attention, nothing more.',
    '',
    '## How a record is scored',
    '',
    ...rulesTable,
    '',
    `All signals are equally weighted (×1). A record’s index is the sum of the four bit-values; the breakdowns below show the working for each of the top ${top.length}.`,
    '',
    `## The ${top.length} most unusual records in ${key}`,
    '',
    ...summaryTable,
    '',
    '## Score breakdowns',
    '',
    'Each record’s signals are listed strongest-first. “Records sharing it” is how many records in the publication carry the same value for that signal — the frequency evidence behind the bits.',
    '',
    ...breakdowns,
  ];
  return lines.join('\n').replace(/\n+$/, '\n');
}

// Build and write the committed golden for the newest publication that carries
// derived views. A no-op (no file written, no failure) when none qualifies,
// mirroring the sweep's other current-state surfaces so a foreign or
// still-underived newest entry never crashes the run.
export function writeCuriosityIndex(): void {
  const key = newestCuriosityKey();
  if (key === undefined) return;
  const scored = scoreCuriosity(readPublicationRecords(key));
  fs.mkdirSync(path.dirname(CURIOSITY_INDEX_PATH), { recursive: true });
  fs.writeFileSync(CURIOSITY_INDEX_PATH, renderCuriosityIndex(key, scored));
}

if (import.meta.main) {
  writeCuriosityIndex();
}
