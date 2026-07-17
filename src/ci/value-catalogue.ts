/**
 * Value catalogue (issues #43 / #223): a regenerated, committed golden-master
 * report enumerating every distinct value of the fields worth tracking,
 * across BOTH lanes (open-data publications + FOI observations, the latter now
 * parsed the same way, #171), with per-value counts and which lanes carry it.
 *
 * Because it is committed and byte-deterministic, a change in a PR diff IS the
 * drift signal - a new/unknown status value (Live, Quarantine), a prefix that
 * should not exist (M2), a vocabulary variant (Full vs Amateur Full Radio
 * Licence) all surface as a reviewable line change, without anyone having to
 * remember to look. It profiles the *derived/canonical* surface; the
 * raw-vs-normalised gap layer and the published page are follow-ons.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { CONSTANTS, type ArchiveMeta } from '../shared/utils.ts';
import { listArchiveKeys, parseSourceFileName } from '../shared/archive.ts';
import { derivedEntryFile, derivedEntryFileExists, isDerivedEntryFile } from '../shared/derived-entries.ts';
import { buildFoiObservations } from '../shared/foi-observations.ts';
import { parseCallsign, cleanedCallsign, loadReferenceData, normaliseLicenceCategory, type ReferenceData } from '../sources/ofcom-amateur/components.ts';
import { mdCode } from '../shared/markdown.ts';
import { buildValueCatalogueFold, type FoldedFields } from './value-catalogue-fold.ts';

// A blank source value is data (the source asserted an empty string); a value
// the source does not carry at all is a different thing. Both render legibly.
const BLANK = '(blank)';

// A value's per-source counts yield both breadth (how many distinct
// publications/entries carry it) and its timeline (count per dated open-data
// publication). bySource is exposed so the renderer can build the sparkline.
// The count-type breakdown (#245) disambiguates WHAT `count` counts: `count`
// is records (rows; the raw->record map is a 1:1 bijection here), while
// distinctCallsigns dedupes the same callsign recurring across publications and
// allocated narrows to those distinct callsigns recorded with an `Allocated`
// status somewhere in the corpus.
export interface ValueTally {
  value: string;
  count: number;
  lanes: string[];
  sources: number;
  bySource: Map<string, number>;
  distinctCallsigns: number;
  allocated: number;
}
export interface FieldCatalogue { field: string; distinct: number; total: number; values: ValueTally[] }

// callsigns / allocatedCallsigns are optional so hand-built fixtures (and any
// caller that only cares about counts/breadth) stay valid; they default to
// empty, yielding a zero breakdown.
export interface Cell { lanes: Set<string>; bySource: Map<string, number>; callsigns?: Set<string>; allocatedCallsigns?: Set<string> }
type Tallies = Map<string, Map<string, Cell>>;
// A bump carries, beyond the value itself, the callsign the value belongs to
// and whether that callsign's record is `Allocated` - the raw material for the
// records/callsigns/allocated breakdown.
interface BumpContext { n?: number; callsign?: string; allocated?: boolean }
type Bump = (field: string, value: string, lane: string, source: string, ctx?: BumpContext) => void;

// Accumulate into field -> value -> { lanes, per-source counts, callsigns }. The
// source is the publication date (open data) or the FOI entry key; keeping the
// count per source is what makes breadth and the timeline derivable, and the
// callsign sets are what make the count-type breakdown derivable. Pure over its
// inputs; the corpus reading is done by buildFieldTallies below.
function makeTallies(): { tallies: Tallies; bump: Bump } {
  const tallies: Tallies = new Map();
  const bump: Bump = (field, value, lane, source, ctx = {}) => {
    const { n = 1, callsign, allocated = false } = ctx;
    let byValue = tallies.get(field);
    if (byValue === undefined) { byValue = new Map(); tallies.set(field, byValue); }
    const key = value === '' ? BLANK : value;
    let cell = byValue.get(key);
    if (cell === undefined) { cell = { lanes: new Set(), bySource: new Map(), callsigns: new Set(), allocatedCallsigns: new Set() }; byValue.set(key, cell); }
    cell.lanes.add(lane);
    cell.bySource.set(source, (cell.bySource.get(source) ?? 0) + n);
    if (callsign !== undefined && callsign !== '') {
      (cell.callsigns ??= new Set()).add(callsign);
      if (allocated) (cell.allocatedCallsigns ??= new Set()).add(callsign);
    }
  };
  return { tallies, bump };
}

// The one register status that means "issued / in use". A callsign is counted
// as allocated for a value if any record carrying that value records this
// status (either lane - both spell it the same, so this is not open-data-only).
const ALLOCATED_STATUS = 'Allocated';

// The fields profiled and the lane each source contributes. `product` (open
// data) and `licence_class` (FOI) describe the same concept under different
// vocabularies, so they share one field to make the drift visible.
export const PRODUCT_FIELD = 'product / licence_class';

function tallyOpenData(bump: Bump, key: string): void {
  // Both inputs are derived files, so they resolve through the archive/
  // projection switch (issue #629 phase 2); missing files stay an empty
  // contribution, exactly as before.
  const readCsv = (name: string): Record<string, string>[] => {
    if (!isDerivedEntryFile(name) || !derivedEntryFileExists(key, name)) return [];
    return parse(fs.readFileSync(derivedEntryFile(key, name), 'utf8'), { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];
  };
  // Status lives on normalised.csv, keyed by callsign; components.csv (the
  // source of the parse-derived fields) has no status column, so build the
  // join once per entry to know whether each callsign's record is allocated.
  const allocatedByCallsign = new Map<string, boolean>();
  for (const r of readCsv('normalised.csv')) {
    const callsign = (r['callsign'] ?? '').trim();
    const allocated = (r['status'] ?? '').trim() === ALLOCATED_STATUS;
    allocatedByCallsign.set(callsign, allocated);
    bump('status', (r['status'] ?? '').trim(), 'open-data', key, { callsign, allocated });
    bump(PRODUCT_FIELD, (r['product'] ?? '').trim(), 'open-data', key, { callsign, allocated });
  }
  for (const r of readCsv('components.csv')) {
    const callsign = (r['callsign'] ?? '').trim();
    const allocated = allocatedByCallsign.get(callsign) ?? false;
    bump('prefix_series', (r['prefix_series'] ?? '').trim(), 'open-data', key, { callsign, allocated });
    bump('implied_class', (r['implied_class'] ?? '').trim(), 'open-data', key, { callsign, allocated });
    bump('parse_status', (r['parse_status'] ?? '').trim(), 'open-data', key, { callsign, allocated });
    for (const f of (r['flags'] ?? '').split(';').filter(x => x !== '')) bump('flags', f, 'open-data', key, { callsign, allocated });
  }
}

function tallyFoi(bump: Bump, ref: ReferenceData, foiDir: string): void {
  for (const obs of buildFoiObservations(foiDir)) {
    const status = obs.values['status'];
    const callsign = obs.callsign.trim();
    const allocated = (status ?? '').trim() === ALLOCATED_STATUS;
    const ctx = { callsign, allocated };
    if (status !== null && status !== undefined) bump('status', status.trim(), 'foi', obs.entry, ctx);
    const licenceClass = obs.values['licence_class'];
    if (licenceClass !== null && licenceClass !== undefined) bump(PRODUCT_FIELD, licenceClass.trim(), 'foi', obs.entry, ctx);
    const c = parseCallsign(obs.callsign, licenceClass ?? '', ref);
    bump('prefix_series', c.prefixSeries, 'foi', obs.entry, ctx);
    bump('implied_class', c.impliedClass, 'foi', obs.entry, ctx);
    bump('parse_status', c.parseStatus, 'foi', obs.entry, ctx);
    for (const f of c.flags) bump('flags', f, 'foi', obs.entry, ctx);
  }
}

export function buildFieldTallies(): Tallies {
  const { tallies, bump } = makeTallies();
  const ref = loadReferenceData();
  for (const key of listArchiveKeys().sort()) tallyOpenData(bump, key);
  tallyFoi(bump, ref, path.join(CONSTANTS.DIRS.archive, 'foi'));
  return tallies;
}

// The dated open-data publications, oldest first: the timeline axis every
// value's sparkline is drawn against. FOI entries carry breadth but not a
// position on this axis (their vintages are irregular), so they are excluded.
export function openDataTimeline(): string[] {
  return listArchiveKeys().sort();
}

// Order a field's values by count desc, then value, so the report is stable.
export function catalogueField(field: string, byValue: Map<string, Cell>): FieldCatalogue {
  const values: ValueTally[] = [...byValue.entries()]
    .map(([value, cell]) => ({
      value,
      count: [...cell.bySource.values()].reduce((s, n) => s + n, 0),
      lanes: [...cell.lanes].sort(),
      sources: cell.bySource.size,
      bySource: cell.bySource,
      distinctCallsigns: cell.callsigns?.size ?? 0,
      allocated: cell.allocatedCallsigns?.size ?? 0,
    }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  return { field, distinct: values.length, total: values.reduce((s, v) => s + v.count, 0), values };
}

// The "expected" sets — a value outside them is called out. Deliberately
// narrow: the point is to surface anything that is NOT one of the few states
// we have reasoned about, not to suppress it.
const EXPECTED_STATUS = new Set(['Allocated', 'Reserved', 'Available', BLANK]);

function notableSection(cats: Map<string, FieldCatalogue>, ref: ReferenceData): string[] {
  const lines: string[] = [];
  const status = cats.get('status');
  const unexpectedStatus = status?.values.filter(v => !EXPECTED_STATUS.has(v.value)) ?? [];
  if (unexpectedStatus.length > 0) {
    lines.push(`- **Status values with no canonical mapping decided**: ${unexpectedStatus.map(v => `${mdCode(v.value)} (${v.count.toLocaleString('en-GB')})`).join(', ')}. Seen but not reasoned about as register states - candidates for reconciliation or an FOI on the state vocabulary.`);
  }
  const prefixes = cats.get('prefix_series');
  const unknownPrefixes = prefixes?.values.filter(v => v.value !== BLANK && !ref.prefixSeries.has(v.value)) ?? [];
  if (unknownPrefixes.length > 0) {
    lines.push(`- **Prefix series outside the reference table** (\`reference-data/prefix-formats.csv\`): ${unknownPrefixes.map(v => `${mdCode(v.value)} (${v.count.toLocaleString('en-GB')})`).join(', ')}. A supposed-to-be-empty prefix that is not empty (e.g. \`M2\`) is exactly the kind of surprise this catalogue exists to flag.`);
  }
  const product = cats.get(PRODUCT_FIELD);
  const crossLane = product?.values.filter(v => v.lanes.length > 1).length ?? 0;
  const variants = product?.distinct ?? 0;
  if (variants > 3) {
    lines.push(`- **Licence product/class vocabulary drift**: ${variants} distinct variants across the corpus (${crossLane} appear in both lanes). The same class is written differently by source (e.g. \`Full\` vs \`Amateur Full Radio Licence\`) - these are passed through VERBATIM today (source fidelity), so this is the explicit, counted list of canonicalisation candidates.`);
  }
  return lines;
}

// One normalised licence category as the report renders it: records (rows),
// callsigns (distinct), allocated (the live-register slice) and the raw
// spellings it folds in with their record counts. The shape is common to the
// legacy computation and the ledger fold (value-catalogue-fold.ts), so the
// renderer draws the table the same way whichever path supplied the figures.
export interface LicenceCategoryFigures {
  category: string;
  records: number;
  callsigns: number;
  allocated: number;
  variants: { product: string; records: number }[];
}

// The legacy licence-category computation, factored out so both the renderer's
// fallback and the equivalence oracle (value-catalogue-fold.test.ts) share one
// definition. Collapses the product tally to canonical categories, unioning
// callsigns/allocated across the folded variants (never a double-counting sum),
// and returns the categories plus the blank and unmapped residues the section
// narrates.
export function computeLegacyLicenceCategories(
  product: FieldCatalogue | undefined,
  ref: ReferenceData,
  productCells?: Map<string, Cell>,
): { categories: LicenceCategoryFigures[]; blank?: ValueTally; unmapped: ValueTally[] } {
  if (product === undefined) return { categories: [], unmapped: [] };
  const byCategory = new Map<string, { total: number; variants: ValueTally[] }>();
  const unmapped: ValueTally[] = [];
  let blank: ValueTally | undefined;
  for (const v of product.values) {
    if (v.value === BLANK) { blank = v; continue; }
    const category = normaliseLicenceCategory(v.value, ref);
    if (category === null) { unmapped.push(v); continue; }
    const bucket = byCategory.get(category) ?? { total: 0, variants: [] };
    bucket.total += v.count;
    bucket.variants.push(v);
    byCategory.set(category, bucket);
  }
  const categories: LicenceCategoryFigures[] = [...byCategory.entries()]
    .map(([category, b]) => {
      const callsigns = new Set<string>();
      const allocated = new Set<string>();
      for (const v of b.variants) {
        const cell = productCells?.get(v.value);
        cell?.callsigns?.forEach(x => callsigns.add(x));
        cell?.allocatedCallsigns?.forEach(x => allocated.add(x));
      }
      const variants = [...b.variants]
        .sort((a, c) => c.count - a.count || a.value.localeCompare(c.value))
        .map(v => ({ product: v.value, records: v.count }));
      return { category, records: b.total, callsigns: callsigns.size, allocated: allocated.size, variants };
    })
    .sort((a, b) => b.records - a.records || a.category.localeCompare(b.category));
  return { categories, blank, unmapped };
}

// The "describe, then do" of the licence vocabulary drift (issue #232): the
// raw product/licence_class variants surfaced in Notable and the product table,
// collapsed to their canonical category via reference-data/licence-category.csv.
// The raw values are still carried verbatim (source fidelity); this is the
// derived, canonical view beside them, made visible so the normalisation is a
// reviewable artefact rather than a hidden mapping. A non-blank variant with no
// category is flagged, never silently dropped.
//
// FOLD, not re-derive (issue #361): when `folded` is supplied, the category
// table's figures come from the raw-keyed claim ledger's `licence_category`
// derived claim (value-catalogue-fold.ts) rather than the legacy product tally.
// The blank and unmapped residues are still read from the product tally — they
// describe the product FIELD (kept legacy for now), not the category derivation.
function licenceCategorySection(
  cats: Map<string, FieldCatalogue>,
  ref: ReferenceData,
  productCells?: Map<string, Cell>,
  folded?: LicenceCategoryFigures[],
): string[] {
  const legacy = computeLegacyLicenceCategories(cats.get(PRODUCT_FIELD), ref, productCells);
  const categories = folded ?? legacy.categories;
  if (categories.length === 0) return [];
  const blank = legacy.blank;
  const unmapped = legacy.unmapped;

  const mapped = categories.reduce((n, c) => n + c.variants.length, 0);
  const lines: string[] = [];
  lines.push('## Normalised licence category');
  lines.push('');
  lines.push(`The ${mapped} non-blank product/licence_class variants above collapse to ${categories.length} canonical categories via \`reference-data/licence-category.csv\`. The raw values are still passed through VERBATIM (source fidelity); this is the derived, canonical view beside them - the drift described above, resolved.`);
  lines.push('');
  lines.push('Counts use the same denominators as the value tables above - `records`');
  lines.push('(rows), `callsigns` (distinct), `allocated` (the live-register slice) -');
  lines.push('each **unioned** across the folded variants, so a callsign written two');
  lines.push('ways (e.g. `Full` in one publication, `Amateur Full Radio Licence` in');
  lines.push('another) counts once per category, not once per spelling. A plain sum of');
  lines.push('the raw per-variant figures would double-count and mislead.');
  lines.push('');
  lines.push('| normalised category | records | callsigns | allocated | folds in |');
  lines.push('|---|---:|---:|---:|---|');
  for (const c of categories) {
    const variants = c.variants
      .map(v => `${mdCode(v.product)} (${v.records.toLocaleString('en-GB')})`)
      .join(', ');
    lines.push(`| ${mdCode(c.category)} | ${c.records.toLocaleString('en-GB')} | ${c.callsigns.toLocaleString('en-GB')} | ${c.allocated.toLocaleString('en-GB')} | ${variants} |`);
  }
  lines.push('');
  if (blank !== undefined) {
    lines.push(`\`(blank)\` (${blank.count.toLocaleString('en-GB')} records, ${blank.distinctCallsigns.toLocaleString('en-GB')} callsigns, ${blank.allocated.toLocaleString('en-GB')} allocated) is not a category - the source asserted no product; it is left as-is.`);
    lines.push('');
  }
  if (unmapped.length > 0) {
    lines.push(`⚠ **Unmapped non-blank variants** (no category decided - add a row to \`reference-data/licence-category.csv\`): ${unmapped.map(v => `${mdCode(v.value)} (${v.count.toLocaleString('en-GB')})`).join(', ')}.`);
    lines.push('');
  }
  return lines;
}

// A per-value sparkline over the dated open-data publications: each bar is the
// value's count in that publication, scaled to the value's OWN peak so its
// temporal shape shows (present-then-gone reads differently from steady). `·`
// marks a publication where the value is absent - the point of the timeline.
const SPARK_BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
function sparkline(bySource: Map<string, number>, timeline: string[]): string {
  const counts = timeline.map(key => bySource.get(key) ?? 0);
  const peak = Math.max(0, ...counts);
  return counts
    .map(c => {
      if (c === 0) return '·';
      if (peak <= 1) return SPARK_BARS[SPARK_BARS.length - 1];
      return SPARK_BARS[Math.round(((c - 1) / (peak - 1)) * (SPARK_BARS.length - 1))];
    })
    .join('');
}

// The raw-vs-normalised gap (#242). Normalisation renames and sorts columns but
// preserves values, so the meaningful gap is at the callsign level: a source
// callsign that normalisation drops, or whose form it changes. This is a
// fidelity guard - mostly empty for clean exports, lighting up on a messy one.
export interface EntryFidelity { key: string; rawRows: number; normalisedRows: number; dropped: string[]; coerced: [string, string][] }

// Join each open-data publication's raw.csv against its normalised.csv by the
// cleaned callsign key (order-independent - the two files are sorted
// differently). Reads column 1 (the callsign) only, so it is uniform across
// source vintages whose other columns differ.
export function buildNormalisationFidelity(): EntryFidelity[] {
  const result: EntryFidelity[] = [];
  for (const key of listArchiveKeys().sort()) {
    const dir = path.join(CONSTANTS.DIRS.archive, key);
    // The parse source (the declared extract for a workbook or shape-only
    // header fill, else raw.csv) - so a workbook publication's fidelity is
    // checked rather than silently skipped.
    const metaPath = path.join(dir, 'meta.json');
    const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) as ArchiveMeta : undefined;
    const rawPath = path.join(dir, meta === undefined ? 'raw.csv' : parseSourceFileName(meta));
    // The raw side stays an archive read (the verbatim record); the normalised
    // side is a derived file and resolves through the archive/projection switch.
    if (!fs.existsSync(rawPath) || !derivedEntryFileExists(key, 'normalised.csv')) continue;
    const normPath = derivedEntryFile(key, 'normalised.csv');
    const rawRows = (parse(fs.readFileSync(rawPath, 'utf8'), { bom: true, skip_empty_lines: true, relax_column_count: true }) as string[][])
      .slice(1).map(r => r[0] ?? '');
    const normRows = (parse(fs.readFileSync(normPath, 'utf8'), { columns: true, bom: true, skip_empty_lines: true }) as Record<string, string>[])
      .map(r => r['callsign'] ?? '');
    const normByCleaned = new Map<string, Set<string>>();
    for (const c of normRows) {
      const k = cleanedCallsign(c);
      const s = normByCleaned.get(k); if (s === undefined) normByCleaned.set(k, new Set([c])); else s.add(c);
    }
    const dropped = new Set<string>();
    const coerced: [string, string][] = [];
    const seen = new Set<string>();
    for (const raw of rawRows) {
      const forms = normByCleaned.get(cleanedCallsign(raw));
      if (forms === undefined) { dropped.add(raw); continue; }
      if (!forms.has(raw) && !seen.has(raw)) { seen.add(raw); coerced.push([raw, [...forms][0]]); }
    }
    result.push({ key, rawRows: rawRows.length, normalisedRows: normRows.length, dropped: [...dropped], coerced });
  }
  return result;
}

function normalisationFidelitySection(fidelity: EntryFidelity[]): string[] {
  if (fidelity.length === 0) return [];
  const out: string[] = ['## Normalisation fidelity (raw → normalised)', ''];
  out.push('Each open-data publication\'s raw Ofcom bytes joined against its');
  out.push('normalised form by the cleaned callsign key (order-independent — the two');
  out.push('files are sorted differently). Normalisation renames and sorts columns');
  out.push('but preserves values, so this is a fidelity guard: a callsign `dropped`');
  out.push('(its cleaned key is absent from the normalised set) or `coerced` (its');
  out.push('cleaned key survives but its form changed) is a drift signal, not a');
  out.push('routine figure.');
  out.push('');
  out.push('| publication | raw rows | normalised rows | dropped | coerced |');
  out.push('|---|---:|---:|---:|---:|');
  for (const f of fidelity) {
    out.push(`| ${f.key} | ${f.rawRows.toLocaleString('en-GB')} | ${f.normalisedRows.toLocaleString('en-GB')} | ${f.dropped.length} | ${f.coerced.length} |`);
  }
  out.push('');
  const detailed = fidelity.filter(f => f.dropped.length > 0 || f.coerced.length > 0);
  for (const f of detailed) {
    const parts: string[] = [];
    if (f.dropped.length > 0) parts.push(`dropped ${f.dropped.length}: ${f.dropped.slice(0, 20).map(c => mdCode(c)).join(', ')}${f.dropped.length > 20 ? ` (+${f.dropped.length - 20} more)` : ''}`);
    if (f.coerced.length > 0) parts.push(`coerced ${f.coerced.length}: ${f.coerced.slice(0, 20).map(([r, n]) => `${mdCode(r)} → ${mdCode(n)}`).join(', ')}${f.coerced.length > 20 ? ` (+${f.coerced.length - 20} more)` : ''}`);
    out.push(`- **${f.key}** — ${parts.join('; ')}.`);
  }
  if (detailed.length === 0) out.push('No gaps: normalisation preserved every callsign across every publication.');
  out.push('');
  return out;
}

// FOLD, not re-derive (issue #361). `foldedCategories` supplies the licence-
// category table from the ledger's derived `licence_category` claim; `foldedFields`
// supplies the per-field value tables for the T1 parse-derived attributes
// (implied_class / parse_status / prefix_series / flags) from the ledger's parse
// tier. Both are OPTIONAL: without them the renderer falls back to the legacy
// tally, so the presentation tests (which pass hand-built tallies) are unaffected.
// The Notable and licence-category residue sections keep reading the legacy tally
// — they describe the raw product/status fields, still on the legacy path.
export function renderValueCatalogue(tallies: Tallies, ref: ReferenceData, timeline: string[] = [], fidelity: EntryFidelity[] = [], foldedCategories?: LicenceCategoryFigures[], foldedFields?: FoldedFields): string {
  const FIELD_ORDER = ['status', PRODUCT_FIELD, 'implied_class', 'parse_status', 'prefix_series', 'flags'];
  const cats = new Map<string, FieldCatalogue>();
  for (const field of FIELD_ORDER) {
    const byValue = tallies.get(field);
    if (byValue !== undefined) cats.set(field, catalogueField(field, byValue));
  }
  const hasTimeline = timeline.length > 0;

  const out: string[] = [];
  out.push('# Value catalogue');
  out.push('');
  out.push('Every distinct value of the tracked fields across the whole corpus');
  out.push('(open-data publications + FOI observations), with counts and the lanes');
  out.push('that carry it. Regenerated by the report sweep and committed, so a');
  out.push('change here in a PR diff is a drift signal - a new status, a prefix that');
  out.push('should not exist, a fresh vocabulary variant. Values are the *derived /');
  out.push('canonical* surface; nothing is dropped or force-mapped - unmapped values');
  out.push('are shown, never assumed away.');
  out.push('');
  out.push('Each figure names WHAT it counts, so a number is never ambiguous:');
  out.push('`records` is rows carrying the value (rows and records are 1:1 here -');
  out.push('the conversion is a bijection); `callsigns` is how many DISTINCT');
  out.push('callsigns those records span (the same callsign recurs across every');
  out.push('publication, so `records` far exceeds it); `allocated` is how many of');
  out.push('those distinct callsigns carry the `Allocated` status somewhere in the');
  out.push('corpus - the live-register slice of the population. `allocated` is not');
  out.push('meaningful for the `status` field itself (the value already IS the');
  out.push('status), so it shows `—` there.');
  out.push('');
  out.push('`sources` is how many distinct publications/entries carry the value:');
  out.push('breadth, not just volume - a value in 10 sources at 1 each reads very');
  out.push('differently from one source at 10,000.');
  if (hasTimeline) {
    out.push(`\`timeline\` is its count across the ${timeline.length} dated open-data`);
    out.push('publications, oldest→newest, each value scaled to its own peak');
    out.push('(`·` = absent from that publication; FOI entries add to `sources` but');
    out.push('not to this axis). A present-then-gone value is visible at a glance.');
  }
  out.push('');

  const notable = notableSection(cats, ref);
  if (notable.length > 0) {
    out.push('## Notable');
    out.push('');
    out.push(...notable);
    out.push('');
  }

  out.push(...licenceCategorySection(cats, ref, tallies.get(PRODUCT_FIELD), foldedCategories));

  out.push(...normalisationFidelitySection(fidelity));

  for (const field of FIELD_ORDER) {
    // A folded field's distribution comes from the ledger (issue #361); the rest
    // fall back to the legacy tally. Same FieldCatalogue shape either way, so the
    // table renders identically whichever path supplied the figures.
    const cat = foldedFields?.get(field) ?? cats.get(field);
    if (cat === undefined) continue;
    // The value of the `status` field already IS a status, so an "allocated"
    // sub-count of it is circular; render it not-applicable there.
    const allocatable = field !== 'status';
    out.push(`## \`${field}\` — ${cat.distinct} distinct`);
    out.push('');
    out.push(`| value | records | callsigns | allocated | sources |${hasTimeline ? ' timeline |' : ''} lanes |`);
    out.push(`|---|---:|---:|---:|---:|${hasTimeline ? '---|' : ''}---|`);
    for (const v of cat.values) {
      const spark = hasTimeline ? ` ${sparkline(v.bySource, timeline)} |` : '';
      const allocated = allocatable ? v.allocated.toLocaleString('en-GB') : '—';
      out.push(`| ${mdCode(v.value)} | ${v.count.toLocaleString('en-GB')} | ${v.distinctCallsigns.toLocaleString('en-GB')} | ${allocated} | ${v.sources} |${spark} ${v.lanes.join(', ')} |`);
    }
    out.push('');
  }
  return out.join('\n');
}

export const VALUE_CATALOGUE_PATH = 'reports/value-catalogue.md';

export function writeValueCatalogue(ledgerDir?: string): { path: string; changed: boolean } {
  const ref = loadReferenceData();
  // The "Normalised licence category" table and the T1 parse-derived field
  // distributions (implied_class / parse_status / prefix_series / flags) fold
  // from the raw-keyed claim ledger (issue #361); the raw `status` and
  // `product / licence_class` fields stay on the legacy tally for now (see
  // value-catalogue-fold.ts / the migration map). One ledger is materialised and
  // every section folds from it; a caller with a pre-built ledger passes its
  // directory.
  const { categories: foldedCategories, fields: foldedFields } = buildValueCatalogueFold(ledgerDir, ref);
  const markdown = renderValueCatalogue(buildFieldTallies(), ref, openDataTimeline(), buildNormalisationFidelity(), foldedCategories, foldedFields);
  // Written relative to the working directory - the SAME root the tallies read
  // archive/ from (CONSTANTS.DIRS.archive is relative). So a sweep run against
  // a fixture archive in a temp cwd writes ITS catalogue there, never
  // clobbering the committed real one.
  const target = path.resolve(process.cwd(), VALUE_CATALOGUE_PATH);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined;
  const changed = existing !== markdown;
  if (changed) fs.writeFileSync(target, markdown);
  return { path: VALUE_CATALOGUE_PATH, changed };
}

if (import.meta.main) {
  // An optional pre-built ledger directory (from `node src/v2/build-ledger.ts
  // <dir>`) lets a run fold the licence-category table without re-emitting the
  // corpus; omit it and the fold materialises its own.
  const [ledgerDir] = process.argv.slice(2).filter(a => a.trim().length > 0);
  const { path: written, changed } = writeValueCatalogue(ledgerDir);
  console.log(`${changed ? 'wrote' : 'up to date'}: ${written}`);
}
