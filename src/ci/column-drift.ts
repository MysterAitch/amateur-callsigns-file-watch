/**
 * Distributional drift fingerprints: per-column, per-vintage distribution
 * FINGERPRINTS over the open-data register vintages, compared vintage-over-
 * vintage (issue #862).
 *
 * The unknown-unknowns workhorse. Where EXPECTED_STATUS hand-authors the
 * expected value set for ONE column, this generalises to EVERY canonical
 * column with NO hand-authored expectations: for each (vintage, column) it
 * folds a fingerprint — the populated/blank split, distinct-value cardinality,
 * a value histogram, the length distribution, and a character-class /
 * per-character profile — and then flags where a fingerprint DIVERGED from the
 * previous vintage's. The detector specifies only that "the shape changed",
 * never what to look for, so a distribution shift nobody thought to write an
 * expectation for still surfaces.
 *
 * Posture (issue #467, binding): the detector FLAGS, it never adjudicates.
 * Every flag carries candidate explanations (a schema/variant change, an
 * export filter that omitted a cohort of rows, an upstream data event) and
 * chooses NONE of them; a novel value is surfaced, never auto-suppressed. The
 * flags feed the curiosities / change-history surfaces (#461 / #292) when
 * those land; here the committed golden report is the drift signal and the
 * working record.
 *
 * Deliberately-naive v1 divergence measure (issue #862, the S2/S3 precedent):
 * every signal is a simple, named comparison against a named, tunable
 * threshold (see DriftParams / DEFAULT_DRIFT_PARAMS). The measures are chosen
 * to be transparent rather than clever — a total-variation distance over the
 * value shares, a fold-change on cardinality, a share delta on blanks / char
 * classes / individual characters. Tuning is expected: a threshold that is
 * too loud on this corpus is a parameter to move, recorded here rather than
 * hidden.
 *
 * FOLD, not re-parse (issue #361): the fingerprints are DuckDB SQL over each
 * vintage's committed `normalised.csv` (read through the archive/projection
 * switch), one pass per vintage. The canonical schema is stable across every
 * open-data vintage (raw header drift is absorbed by the normaliser), so the
 * signal is per-column POPULATION and DISTRIBUTION, not header presence. The
 * cross-vintage divergence detection is a pure, unit-testable function over
 * the folded fingerprints — the S2 precedent, where the episode detector is
 * pure TypeScript over the day-signal fold. Committed as
 * reports/column-drift.md, byte-deterministic (every query carries a total
 * ORDER BY), so a new vintage shifting any fingerprint shows up as a PR diff.
 */

import * as fs from 'fs';
import * as path from 'path';
import { foldQuery } from '../v2/report-fold.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import { derivedEntryFile, derivedEntryFileExists } from '../shared/derived-entries.ts';
import { CANONICAL_COLUMNS } from '../sources/ofcom-amateur/normalise.ts';
import { time, perfReport } from '../shared/perf.ts';

// --- Tunable parameters (issue #862: named, tunable thresholds) -------------

export interface DriftParams {
  // How many of the most frequent values a fingerprint folds per column. Set
  // to the categorical cap so a categorical column (cardinality within the
  // cap) is folded IN FULL — the total-variation and novel-value measures then
  // read the complete value distribution, not a sample. A high-cardinality
  // column (callsigns, dates) is folded to the same depth as a histogram
  // sample; those measures skip it.
  valueHistogramDepth: number;
  // A column counts as CATEGORICAL — eligible for the value-distribution and
  // novel/retired-value measures — only when its cardinality is at most this
  // on BOTH sides of a comparison. Above it, a "novel value" is the norm
  // (every vintage mints fresh callsigns / dates) and says nothing.
  categoricalMaxCardinality: number;
  // The shape measures (cardinality, length, char-class, per-character) need
  // at least this many populated values on BOTH sides before they flag — a
  // "majority" of a 40-row partial publication is a handful of rows, not a
  // distribution (the same min-population wisdom the mass-episode detector
  // applies).
  minPopulatedForShape: number;
  // |Δ blank share| (blanks / rows) at or above this is a blank-share-shift.
  blankShareDelta: number;
  // Cardinality growing or shrinking by at least this fold-change is a
  // cardinality-shift.
  cardinalityRatio: number;
  // |Δ mean value length| at or above this is a length-shift.
  meanLengthDelta: number;
  // |Δ share of populated values containing a character class| at or above
  // this is a char-class-shift.
  classShareDelta: number;
  // A character whose containment share crosses this floor — present on one
  // side, absent (below the floor) on the other — is a character-appeared /
  // character-vanished flag. The Z-suffix cohort omission (#564) is exactly a
  // character vanishing from the callsign column.
  charPresenceDelta: number;
  // Total-variation distance over the value shares at or above this is a
  // value-distribution-shift (categorical columns only).
  tvdThreshold: number;
  // A categorical value present on one side and absent on the other, holding
  // at least this share where present, is a novel-value / retired-value flag.
  novelValueShare: number;
}

export const DEFAULT_DRIFT_PARAMS: DriftParams = {
  valueHistogramDepth: 50,
  categoricalMaxCardinality: 50,
  minPopulatedForShape: 100,
  blankShareDelta: 0.05,
  cardinalityRatio: 2,
  meanLengthDelta: 1,
  classShareDelta: 0.05,
  charPresenceDelta: 0.01,
  tvdThreshold: 0.1,
  novelValueShare: 0.005,
};

// How many of a column's top values the committed report renders per vintage
// (the fold always holds valueHistogramDepth; the full distribution is
// re-derivable). Kept small so the golden stays a readable working record.
export const RENDER_TOP_VALUES = 8;

// --- The character-class vocabulary -----------------------------------------
//
// Each populated value is tested for CONTAINING at least one character of a
// class; the fingerprint records the share of populated values that do. The
// classes are deliberately coarse and total over printable text, so a format
// or encoding change (lowercase creeping in, a non-ASCII contaminant, a
// punctuation shift) moves a share a reader can name.
export const CHAR_CLASSES = ['digit', 'upper', 'lower', 'space', 'punct', 'nonascii'] as const;
export type CharClass = (typeof CHAR_CLASSES)[number];

// The DuckDB regex each class tests (RE2 syntax). `punct` uses the POSIX class
// (every printable ASCII that is not a letter, digit or space — so `/`, `-`,
// `#` and friends); `nonascii` catches anything outside 7-bit ASCII (the NBSP
// / Excel-mangle contaminant family).
const CHAR_CLASS_REGEX: Record<CharClass, string> = {
  digit: '[0-9]',
  upper: '[A-Z]',
  lower: '[a-z]',
  space: '\\s',
  punct: '[[:punct:]]',
  nonascii: '[^\\x00-\\x7F]',
};

// --- Fingerprint shapes ------------------------------------------------------

export interface ValueCount {
  value: string;
  count: number;
}

export interface CharCount {
  // A single character (one Unicode codepoint as DuckDB split it). Rendered
  // via a printable marker where it is not a plain printable ASCII glyph.
  char: string;
  // Populated values containing this character at least once.
  count: number;
}

// One (vintage, column) fingerprint — the folded distribution summary.
export interface ColumnFingerprint {
  vintage: string;
  column: string;
  rows: number;
  populated: number;
  blank: number;
  cardinality: number;
  lengthMin: number | null;
  lengthMax: number | null;
  lengthMean: number | null;
  // Populated values containing each character class (a count, not a share —
  // shares are derived at read time so the stored figure is exact).
  classCounts: Record<CharClass, number>;
  // Per-character containment counts over the populated values, every distinct
  // character (the alphabets are small), ascending by character.
  charProfile: CharCount[];
  // The most frequent values (up to valueHistogramDepth), descending by count
  // then value. Complete for a categorical column.
  topValues: ValueCount[];
}

export interface VintageFingerprint {
  vintage: string;
  columns: ColumnFingerprint[];
}

// --- The per-vintage fold ----------------------------------------------------

// One open-data vintage's committed normalised.csv, resolved through the
// archive/projection switch.
export interface VintageCsv {
  vintage: string;
  file: string;
}

// Every open-data register vintage that carries a normalised.csv, in
// chronological order (archive keys are ISO dates). A vintage with no derived
// view is skipped honestly rather than folded as empty.
export function openDataVintageCsvs(): VintageCsv[] {
  return listArchiveKeys()
    .filter(key => derivedEntryFileExists(key, 'normalised.csv'))
    .map(key => ({ vintage: key, file: derivedEntryFile(key, 'normalised.csv') }));
}

function sqlPath(file: string): string {
  return path.resolve(process.cwd(), file).replace(/\\/g, '/').replace(/'/g, "''");
}

function sqlIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

// The fold SQL for ONE vintage: read the normalised.csv once into a temp
// table, melt the canonical columns into (col, value) rows, and aggregate each
// column's fingerprint — the counts, the length distribution, the char-class
// containment counts, the per-character containment list, and the top-value
// histogram — in a single pass. Every list carries an ORDER BY so the JSON is
// byte-deterministic.
function vintageFingerprintSql(file: string, depth: number): string {
  const melt = CANONICAL_COLUMNS
    .map(col => `SELECT '${col}' AS col, ${sqlIdent(col)} AS v FROM src`)
    .join('\n  UNION ALL ');
  const classCols = CHAR_CLASSES
    .map(cls => `count(*) FILTER (WHERE tv <> '' AND regexp_matches(v, '${CHAR_CLASS_REGEX[cls]}')) AS cls_${cls}`)
    .join(',\n    ');
  return `CREATE TEMP TABLE src AS SELECT * FROM read_csv('${sqlPath(file)}', header=true, all_varchar=true);
WITH melted AS (
  ${melt}
),
norm AS (SELECT col, coalesce(v, '') AS v, trim(coalesce(v, '')) AS tv FROM melted),
agg AS (
  SELECT col,
    count(*) AS rows,
    count(*) FILTER (WHERE tv = '') AS blank,
    count(DISTINCT CASE WHEN tv <> '' THEN v END) AS cardinality,
    min(length(v)) FILTER (WHERE tv <> '') AS lengthMin,
    max(length(v)) FILTER (WHERE tv <> '') AS lengthMax,
    round(avg(length(v)) FILTER (WHERE tv <> ''), 4) AS lengthMean,
    ${classCols}
  FROM norm GROUP BY col
),
pop AS (SELECT col, v, row_number() OVER () AS rid FROM norm WHERE tv <> ''),
charrows AS (SELECT DISTINCT col, rid, ch FROM (SELECT col, rid, unnest(string_split(v, '')) AS ch FROM pop)),
charcnt AS (SELECT col, ch, count(*) AS cnt FROM charrows GROUP BY col, ch),
chars AS (SELECT col, list(struct_pack("char" := ch, "count" := cnt) ORDER BY ch) AS charProfile FROM charcnt GROUP BY col),
valcnt AS (
  SELECT col, tv AS value, count(*) AS cnt FROM norm WHERE tv <> ''
  GROUP BY col, tv
  QUALIFY row_number() OVER (PARTITION BY col ORDER BY count(*) DESC, tv) <= ${depth}
),
tops AS (SELECT col, list(struct_pack("value" := value, "count" := cnt) ORDER BY cnt DESC, value) AS topValues FROM valcnt GROUP BY col)
SELECT agg.col AS column,
  rows, blank, cardinality, lengthMin, lengthMax, lengthMean,
  ${CHAR_CLASSES.map(cls => `cls_${cls}`).join(', ')},
  coalesce(chars.charProfile, []) AS charProfile,
  coalesce(tops.topValues, []) AS topValues
FROM agg LEFT JOIN chars USING (col) LEFT JOIN tops USING (col)
ORDER BY agg.col`;
}

interface FoldRow {
  column: string;
  rows: number;
  blank: number;
  cardinality: number;
  lengthMin: number | null;
  lengthMax: number | null;
  lengthMean: number | null;
  charProfile: CharCount[];
  topValues: ValueCount[];
  [classKey: string]: unknown;
}

export function foldVintageFingerprint(entry: VintageCsv, params: DriftParams = DEFAULT_DRIFT_PARAMS): ColumnFingerprint[] {
  const rows = foldQuery<FoldRow>(vintageFingerprintSql(entry.file, params.valueHistogramDepth));
  return rows.map(row => {
    const classCounts = {} as Record<CharClass, number>;
    for (const cls of CHAR_CLASSES) classCounts[cls] = Number(row[`cls_${cls}`] ?? 0);
    return {
      vintage: entry.vintage,
      column: row.column,
      rows: row.rows,
      populated: row.rows - row.blank,
      blank: row.blank,
      cardinality: row.cardinality,
      lengthMin: row.lengthMin,
      lengthMax: row.lengthMax,
      lengthMean: row.lengthMean,
      classCounts,
      charProfile: row.charProfile.map(c => ({ char: c.char, count: c.count })),
      topValues: row.topValues.map(v => ({ value: v.value, count: v.count })),
    };
  });
}

export function foldFingerprints(entries: readonly VintageCsv[], params: DriftParams = DEFAULT_DRIFT_PARAMS): VintageFingerprint[] {
  return entries.map(entry => ({
    vintage: entry.vintage,
    columns: time(`column-drift:fingerprint:${entry.vintage}`, () => foldVintageFingerprint(entry, params)),
  }));
}

// --- The divergence vocabulary ----------------------------------------------
//
// Authored, closed, glossed. Every flag names exactly one of these kinds, so a
// reader (and the #461 / #292 surfaces) can cite the measure a flag was raised
// under and re-run it. The kinds are ordered here in the report's reading
// order (coverage first, then shape, then value-level).
export type DriftKind =
  | 'column-populated'
  | 'column-emptied'
  | 'blank-share-shift'
  | 'cardinality-shift'
  | 'length-shift'
  | 'char-class-shift'
  | 'character-appeared'
  | 'character-vanished'
  | 'value-distribution-shift'
  | 'novel-value'
  | 'retired-value';

const DRIFT_KIND_ORDER: readonly DriftKind[] = [
  'column-populated',
  'column-emptied',
  'blank-share-shift',
  'cardinality-shift',
  'length-shift',
  'char-class-shift',
  'character-appeared',
  'character-vanished',
  'value-distribution-shift',
  'novel-value',
  'retired-value',
];

export const DRIFT_KIND_GLOSSES: ReadonlyMap<DriftKind, string> = new Map([
  ['column-populated', 'a column left entirely blank in the previous vintage carries values in this one — a coverage change, not a per-record event'],
  ['column-emptied', 'a column populated in the previous vintage is entirely blank in this one'],
  ['blank-share-shift', 'the share of blank cells moved by at least the blank-share threshold — a cohort of rows gained or lost the field'],
  ['cardinality-shift', 'the count of distinct values grew or shrank by at least the cardinality fold-change'],
  ['length-shift', 'the mean value length moved by at least the length threshold — often a rendering or format change'],
  ['char-class-shift', 'the share of values containing a character class (digit / letter-case / space / punctuation / non-ASCII) moved by at least the class-share threshold'],
  ['character-appeared', 'a character crossed the presence floor from absent to present — a contaminant arriving, or a cohort of values re-entering'],
  ['character-vanished', 'a character crossed the presence floor from present to absent — a contaminant cleaned, or a cohort of values omitted (the Z-suffix omission shape)'],
  ['value-distribution-shift', 'the value shares of a categorical column moved by a total-variation distance at or above the threshold'],
  ['novel-value', 'a categorical value present here was absent in the previous vintage, at or above the novel-value share'],
  ['retired-value', 'a categorical value present in the previous vintage is absent here, at or above the novel-value share'],
]);

// Candidate explanations offered beside every flag and CHOSEN nowhere (issue
// #467). A flag names a shape change; these are the families of cause a reader
// would weigh, never a verdict the detector reaches.
export const CANDIDATE_EXPLANATIONS: ReadonlyMap<DriftKind, readonly string[]> = new Map([
  ['column-populated', ['a schema / export-variant change added the field', 'an upstream backfill populated previously-absent data']],
  ['column-emptied', ['a schema / export-variant change dropped the field', 'an export filter excluded the field for this publication']],
  ['blank-share-shift', ['an export filter omitted (or restored) a cohort of rows', 'an upstream data event grew or shrank the populated pool', 'a schema / export-variant change']],
  ['cardinality-shift', ['an upstream data event added or removed distinct values', 'a coverage change (a partial publication)', 'a de-duplication or expansion in the export']],
  ['length-shift', ['a rendering / date-format change', 'a change in the underlying value space']],
  ['char-class-shift', ['an encoding or format change', 'a contamination (NBSP / Excel-mangle) arriving or cleaned', 'a change in the underlying value space']],
  ['character-appeared', ['a contamination arriving', 'a cohort of values re-entering the publication', 'an encoding change']],
  ['character-vanished', ['a cohort of values omitted from the publication (an export filter)', 'a contamination cleaned', 'an encoding change']],
  ['value-distribution-shift', ['an upstream data event re-weighted the categories', 'an export filter changed the row population', 'a relabelling upstream']],
  ['novel-value', ['a new category introduced upstream', 'a relabelling of an existing category', 'a coverage change surfacing a value']],
  ['retired-value', ['a category withdrawn upstream', 'a relabelling of an existing category', 'an export filter removing its rows']],
]);

// --- One flagged divergence --------------------------------------------------

export interface DriftSignal {
  column: string;
  fromVintage: string;
  toVintage: string;
  kind: DriftKind;
  // A reader-facing statement of the measured change (the before/after figures
  // that crossed the threshold).
  detail: string;
  // The measured magnitude that crossed the threshold — the ordering key for
  // "the biggest movers", never a severity verdict.
  magnitude: number;
}

// --- The pure divergence detector -------------------------------------------

function share(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function classShare(fp: ColumnFingerprint, cls: CharClass): number {
  return share(fp.classCounts[cls], fp.populated);
}

// A map of character -> containment share over populated values.
function charShares(fp: ColumnFingerprint): Map<string, number> {
  const shares = new Map<string, number>();
  for (const entry of fp.charProfile) shares.set(entry.char, share(entry.count, fp.populated));
  return shares;
}

// A map of value -> share over populated values, complete only for a
// categorical column (whose whole distribution fits within the fold depth).
function valueShares(fp: ColumnFingerprint): Map<string, number> {
  const shares = new Map<string, number>();
  for (const entry of fp.topValues) shares.set(entry.value, share(entry.count, fp.populated));
  return shares;
}

// Total-variation distance between two value-share distributions: half the sum
// of absolute share differences over the union of values. Bounded in [0, 1];
// 0 is identical, 1 is disjoint.
function totalVariationDistance(a: Map<string, number>, b: Map<string, number>): number {
  let sum = 0;
  for (const value of new Set([...a.keys(), ...b.keys()])) {
    sum += Math.abs((a.get(value) ?? 0) - (b.get(value) ?? 0));
  }
  return sum / 2;
}

// Compare one column across two consecutive vintages, emitting every flag the
// thresholds raise. Pure: everything a flag carries is computed from the two
// fingerprints and the parameters, so every figure is re-runnable.
function compareColumn(prev: ColumnFingerprint, cur: ColumnFingerprint, params: DriftParams): DriftSignal[] {
  const signals: DriftSignal[] = [];
  const base = { column: cur.column, fromVintage: prev.vintage, toVintage: cur.vintage };

  // Coverage: a column appearing or disappearing wholesale.
  if (prev.populated === 0 && cur.populated > 0) {
    signals.push({ ...base, kind: 'column-populated', detail: `blank in ${prev.vintage}, ${cur.populated.toLocaleString('en-GB')} populated here`, magnitude: cur.populated });
    return signals;
  }
  if (prev.populated > 0 && cur.populated === 0) {
    signals.push({ ...base, kind: 'column-emptied', detail: `${prev.populated.toLocaleString('en-GB')} populated in ${prev.vintage}, blank here`, magnitude: prev.populated });
    return signals;
  }
  if (prev.populated === 0 || cur.populated === 0) return signals;

  // Blank-share shift (a coverage signal, computed regardless of population
  // size — a shrinking publication is exactly the interesting case).
  const blankDelta = share(cur.blank, cur.rows) - share(prev.blank, prev.rows);
  if (Math.abs(blankDelta) >= params.blankShareDelta) {
    signals.push({ ...base, kind: 'blank-share-shift', detail: `blank ${pct(share(prev.blank, prev.rows))} -> ${pct(share(cur.blank, cur.rows))}`, magnitude: Math.abs(blankDelta) });
  }

  // The shape measures need a real distribution on both sides.
  const enoughToCompareShape = prev.populated >= params.minPopulatedForShape && cur.populated >= params.minPopulatedForShape;
  if (enoughToCompareShape) {
    if (prev.cardinality > 0 && cur.cardinality > 0) {
      const ratio = cur.cardinality / prev.cardinality;
      if (ratio >= params.cardinalityRatio || ratio <= 1 / params.cardinalityRatio) {
        signals.push({ ...base, kind: 'cardinality-shift', detail: `distinct values ${prev.cardinality.toLocaleString('en-GB')} -> ${cur.cardinality.toLocaleString('en-GB')} (x${ratio.toFixed(2)})`, magnitude: Math.abs(Math.log2(ratio)) });
      }
    }

    if (prev.lengthMean !== null && cur.lengthMean !== null) {
      const lenDelta = cur.lengthMean - prev.lengthMean;
      if (Math.abs(lenDelta) >= params.meanLengthDelta) {
        signals.push({ ...base, kind: 'length-shift', detail: `mean length ${prev.lengthMean.toFixed(2)} -> ${cur.lengthMean.toFixed(2)}`, magnitude: Math.abs(lenDelta) });
      }
    }

    for (const cls of CHAR_CLASSES) {
      const delta = classShare(cur, cls) - classShare(prev, cls);
      if (Math.abs(delta) >= params.classShareDelta) {
        signals.push({ ...base, kind: 'char-class-shift', detail: `${cls} share ${pct(classShare(prev, cls))} -> ${pct(classShare(cur, cls))}`, magnitude: Math.abs(delta) });
      }
    }

    const prevChars = charShares(prev);
    const curChars = charShares(cur);
    for (const ch of [...new Set([...prevChars.keys(), ...curChars.keys()])].sort()) {
      const before = prevChars.get(ch) ?? 0;
      const after = curChars.get(ch) ?? 0;
      if (before < params.charPresenceDelta && after >= params.charPresenceDelta) {
        signals.push({ ...base, kind: 'character-appeared', detail: `character ${renderChar(ch)}: ${pct(before)} -> ${pct(after)} of values`, magnitude: after - before });
      } else if (before >= params.charPresenceDelta && after < params.charPresenceDelta) {
        signals.push({ ...base, kind: 'character-vanished', detail: `character ${renderChar(ch)}: ${pct(before)} -> ${pct(after)} of values`, magnitude: before - after });
      }
    }
  }

  // Value-level measures: categorical columns only (both sides within the cap,
  // so both distributions are folded in full).
  const bothCategorical = prev.cardinality <= params.categoricalMaxCardinality
    && cur.cardinality <= params.categoricalMaxCardinality
    && enoughToCompareShape;
  if (bothCategorical) {
    const prevValues = valueShares(prev);
    const curValues = valueShares(cur);
    const tvd = totalVariationDistance(prevValues, curValues);
    if (tvd >= params.tvdThreshold) {
      signals.push({ ...base, kind: 'value-distribution-shift', detail: `total-variation distance ${tvd.toFixed(3)}`, magnitude: tvd });
    }
    for (const [value, after] of [...curValues].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (!prevValues.has(value) && after >= params.novelValueShare) {
        signals.push({ ...base, kind: 'novel-value', detail: `${renderValue(value)} (${pct(after)}) absent in ${prev.vintage}`, magnitude: after });
      }
    }
    for (const [value, before] of [...prevValues].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (!curValues.has(value) && before >= params.novelValueShare) {
        signals.push({ ...base, kind: 'retired-value', detail: `${renderValue(value)} (${pct(before)} in ${prev.vintage}) absent here`, magnitude: before });
      }
    }
  }

  return signals;
}

// Detect every flagged divergence across the fingerprint sequence: for each
// column, compare each vintage against the previous one carrying the column in
// the corpus order. The result is sorted into a total, deterministic order.
export function detectDrift(fingerprints: readonly VintageFingerprint[], params: DriftParams = DEFAULT_DRIFT_PARAMS): DriftSignal[] {
  const byColumn = new Map<string, ColumnFingerprint[]>();
  for (const vintage of fingerprints) {
    for (const column of vintage.columns) {
      const list = byColumn.get(column.column);
      if (list === undefined) byColumn.set(column.column, [column]);
      else list.push(column);
    }
  }
  const signals: DriftSignal[] = [];
  for (const columns of byColumn.values()) {
    for (let i = 1; i < columns.length; i++) {
      signals.push(...compareColumn(columns[i - 1], columns[i], params));
    }
  }
  return signals.sort((a, b) =>
    a.column.localeCompare(b.column)
    || a.toVintage.localeCompare(b.toVintage)
    || a.fromVintage.localeCompare(b.fromVintage)
    || DRIFT_KIND_ORDER.indexOf(a.kind) - DRIFT_KIND_ORDER.indexOf(b.kind)
    || a.detail.localeCompare(b.detail));
}

// --- The assembled drift picture --------------------------------------------

export interface ColumnDrift {
  params: DriftParams;
  fingerprints: VintageFingerprint[];
  signals: DriftSignal[];
}

export function computeColumnDrift(entries: readonly VintageCsv[], params: DriftParams = DEFAULT_DRIFT_PARAMS): ColumnDrift {
  const fingerprints = foldFingerprints(entries, params);
  const signals = detectDrift(fingerprints, params);
  return { params, fingerprints, signals };
}

export function buildColumnDrift(params: DriftParams = DEFAULT_DRIFT_PARAMS): ColumnDrift {
  return computeColumnDrift(openDataVintageCsvs(), params);
}

// --- Rendering ---------------------------------------------------------------

function num(n: number): string {
  return n.toLocaleString('en-GB');
}

function mdCode(value: string): string {
  return `\`${value}\``;
}

// A character rendered for a table cell: a plain printable ASCII glyph as
// itself (backtick-wrapped), anything else as a `U+XXXX` marker so invisibles
// and contaminants are visible and byte-stable.
function renderChar(ch: string): string {
  const codepoint = ch.codePointAt(0) ?? 0;
  if (codepoint >= 0x21 && codepoint <= 0x7e) return mdCode(ch);
  return `\`U+${codepoint.toString(16).toUpperCase().padStart(4, '0')}\``;
}

// A value rendered for a table cell: printable values as themselves (escaped),
// values carrying invisibles/contaminants with those characters exploded to
// markers so the contamination is visible.
function renderValue(value: string): string {
  let out = '';
  for (const ch of value) {
    const codepoint = ch.codePointAt(0) ?? 0;
    out += codepoint >= 0x20 && codepoint <= 0x7e ? ch : `{U+${codepoint.toString(16).toUpperCase().padStart(4, '0')}}`;
  }
  // Escape backslashes FIRST, then pipes: a value carrying a literal `\` (or
  // the sequence `\|`) would otherwise neutralise the pipe escaping and break
  // the markdown table row. Order matters — escaping pipes first would then
  // double-escape the backslashes this inserts.
  return mdCode(out.replace(/\\/g, '\\\\').replace(/\|/g, '\\|'));
}

function lengthCell(fp: ColumnFingerprint): string {
  if (fp.lengthMin === null || fp.lengthMax === null || fp.lengthMean === null) return '—';
  return `${fp.lengthMin} / ${fp.lengthMean.toFixed(2)} / ${fp.lengthMax}`;
}

// The character classes worth naming for a column in the summary table: those
// present in a minority (so an all-or-nothing class is not noise) — the ones a
// reader would scan for contamination.
function notableClasses(fp: ColumnFingerprint): string {
  const parts: string[] = [];
  for (const cls of CHAR_CLASSES) {
    const s = classShare(fp, cls);
    if (s > 0 && s < 1) parts.push(`${cls} ${pct(s)}`);
    else if (s === 1) parts.push(`${cls} all`);
  }
  return parts.length === 0 ? '—' : parts.join(', ');
}

export function renderColumnDrift(drift: ColumnDrift): string {
  const p = drift.params;
  const lines: string[] = [
    '# Column distributional drift (per-vintage fingerprints)',
    '',
    'Per-column, per-vintage distribution FINGERPRINTS over the open-data',
    'register vintages (issue #862): for every canonical column of each',
    'vintage’s `normalised.csv`, the populated/blank split, the distinct-value',
    'cardinality, the value histogram, the length distribution and a',
    'character-class / per-character profile — then the vintage-over-vintage',
    'DIVERGENCES the thresholds flag. This generalises `EXPECTED_STATUS` from',
    'one hand-authored column to EVERY column with no hand-authored',
    'expectations: the detector says only that "the shape changed", never what',
    'to look for. Regenerated and committed, so a new vintage shifting any',
    'fingerprint shows up as a PR diff.',
    '',
    '**This is one of two anomaly-detection surfaces, and the one that sees a',
    'STRUCTURAL anomaly** — a whole cohort or character class entering or leaving',
    'a publication. The other, `dataset-anomaly-flags`, compares a vintage’s',
    'aggregate metrics (record count, per-status shares, product-column',
    'emptiness) against its neighbours; it does not look inside the value space,',
    'so a class-wide disappearance is invisible there and visible here. Named',
    'because "where are anomalies detected?" leads naturally to the aggregate',
    'detector and straight past this report — which is where the `Z`-cohort',
    'omission between the 2025-11-11 and 2026-01-14 vintages was actually caught.',
    '',
    '**Flags, never verdicts** (issue #467): every divergence carries candidate',
    'explanations (a schema/variant change, an export filter, an upstream data',
    'event) and chooses none; a novel value is surfaced, never auto-suppressed.',
    'The measures are a deliberately naive v1 — simple, named comparisons',
    'against named, tunable thresholds — and are expected to be tuned against',
    'the corpus rather than trusted as calibrated. The canonical schema is',
    'stable across every open-data vintage (the normaliser absorbs raw header',
    'drift), so the signal here is per-column POPULATION and DISTRIBUTION, not',
    'header presence; raw-header/schema drift is out of this report’s scope.',
    '',
    '## Parameters',
    '',
    'The named thresholds each measure is tuned by (issue #862). A flag is not',
    'a calibrated alarm — a threshold too loud on this corpus is a parameter to',
    'move.',
    '',
    '| parameter | value | meaning |',
    '|---|---:|---|',
    `| categorical cardinality cap | ${num(p.categoricalMaxCardinality)} | value-distribution and novel/retired-value measures apply only to columns at or below this many distinct values on both sides |`,
    `| min populated for shape | ${num(p.minPopulatedForShape)} | shape measures need at least this many populated values on both sides |`,
    `| blank-share delta | ${pct(p.blankShareDelta)} | \`blank-share-shift\` fires at or above this absolute change in blank share |`,
    `| cardinality fold-change | x${p.cardinalityRatio} | \`cardinality-shift\` fires at or above this growth or shrink factor |`,
    `| mean-length delta | ${p.meanLengthDelta} | \`length-shift\` fires at or above this absolute change in mean length |`,
    `| class-share delta | ${pct(p.classShareDelta)} | \`char-class-shift\` fires at or above this absolute change in a class-containment share |`,
    `| character-presence floor | ${pct(p.charPresenceDelta)} | \`character-appeared\`/\`character-vanished\` fire when a character crosses this containment share |`,
    `| total-variation threshold | ${p.tvdThreshold.toFixed(2)} | \`value-distribution-shift\` fires at or above this distance over the value shares |`,
    `| novel-value share | ${pct(p.novelValueShare)} | a categorical value present on one side only, at or above this share, is \`novel-value\`/\`retired-value\` |`,
    '',
    '## Divergence vocabulary',
    '',
    'Every flag names exactly one measure (used only with these meanings), with',
    'the candidate explanations it is weighed against — none ever chosen.',
    '',
    ...[...DRIFT_KIND_GLOSSES.entries()].map(([kind, gloss]) => {
      const candidates = CANDIDATE_EXPLANATIONS.get(kind) ?? [];
      return `- **${kind}** — ${gloss}. Candidate explanations: ${candidates.join('; ')}.`;
    }),
    '',
  ];

  // Per-column fingerprint tables.
  lines.push(
    '## Per-column fingerprints',
    '',
    'One row per vintage per column: rows, the populated/blank split, distinct',
    'values, the length distribution (min / mean / max) and the notable',
    'character classes (those present in a minority of values, where a',
    'contaminant hides). The full per-character profile and the complete value',
    'histogram are re-derivable from the fold (src/ci/column-drift.ts).',
    '',
  );
  if (drift.fingerprints.length === 0) {
    lines.push('No open-data vintage carries a normalised.csv. This is "no data", not "no drift".', '');
  }
  for (const column of CANONICAL_COLUMNS) {
    const rows = drift.fingerprints
      .map(v => v.columns.find(c => c.column === column))
      .filter((c): c is ColumnFingerprint => c !== undefined);
    if (rows.length === 0) continue;
    lines.push(
      `### ${mdCode(column)}`,
      '',
      '| vintage | rows | populated | blank | distinct | length min/mean/max | notable char classes |',
      '|---|---:|---:|---:|---:|---|---|',
      ...rows.map(fp =>
        `| ${fp.vintage} | ${num(fp.rows)} | ${num(fp.populated)} (${pct(share(fp.populated, fp.rows))}) | ${num(fp.blank)} | ${num(fp.cardinality)} | ${lengthCell(fp)} | ${notableClasses(fp)} |`),
      '',
    );
  }

  // Top-value histograms per vintage for the columns where they read (a
  // categorical column shows its whole distribution; a high-cardinality column
  // shows its most concentrated values — where a mass-update spike surfaces).
  lines.push(
    '## Top values per vintage',
    '',
    `Up to ${RENDER_TOP_VALUES} most frequent values per column per vintage, with their`,
    'share of populated values. For a low-cardinality column this is the whole',
    'distribution; for a date or callsign column it is the concentration',
    'profile — a single day holding a majority is the mass-update fingerprint',
    '(issue #801). Values carrying invisibles/contaminants are exploded to',
    '`{U+XXXX}` markers.',
    '',
  );
  for (const column of CANONICAL_COLUMNS) {
    const rows = drift.fingerprints
      .map(v => v.columns.find(c => c.column === column))
      .filter((c): c is ColumnFingerprint => c !== undefined && c.topValues.length > 0);
    if (rows.length === 0) continue;
    lines.push(`### ${mdCode(column)}`, '');
    for (const fp of rows) {
      const top = fp.topValues.slice(0, RENDER_TOP_VALUES)
        .map(v => `${renderValue(v.value)} ${num(v.count)} (${pct(share(v.count, fp.populated))})`)
        .join(', ');
      lines.push(`- **${fp.vintage}** (${num(fp.cardinality)} distinct): ${top}`);
    }
    lines.push('');
  }

  // The flagged divergences.
  lines.push(
    '## Flagged divergences',
    '',
    'Every vintage-over-vintage flag the thresholds raised, in column then',
    'vintage order. A flag names a shape change and weighs candidate',
    'explanations; it reaches no verdict (issue #467). The `magnitude` column',
    'orders the biggest movers within a measure and is not a severity score.',
    '',
  );
  if (drift.signals.length === 0) {
    lines.push('No divergence crossed a threshold. This is "no flag", not a clean bill of health.', '');
  } else {
    lines.push(
      '| column | from | to | measure | detail | magnitude |',
      '|---|---|---|---|---|---:|',
      ...drift.signals.map(s =>
        `| ${mdCode(s.column)} | ${s.fromVintage} | ${s.toVintage} | ${s.kind} | ${s.detail} | ${s.magnitude.toFixed(3)} |`),
      '',
    );
  }

  return lines.join('\n');
}

export const COLUMN_DRIFT_PATH = 'reports/column-drift.md';

export function writeColumnDrift(): { path: string; changed: boolean } {
  const markdown = renderColumnDrift(buildColumnDrift());
  const target = path.resolve(process.cwd(), COLUMN_DRIFT_PATH);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined;
  const changed = existing !== markdown;
  if (changed) fs.writeFileSync(target, markdown);
  return { path: COLUMN_DRIFT_PATH, changed };
}

if (import.meta.main) {
  const { path: written, changed } = writeColumnDrift();
  console.log(`${changed ? 'wrote' : 'up to date'}: ${written}`);
  perfReport({ entrypoint: 'column-drift' });
}
