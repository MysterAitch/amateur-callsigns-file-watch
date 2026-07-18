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
import { type ArchiveMeta } from '../shared/utils.ts';
import { DIRS } from '../shared/constants.ts';
import { listArchiveKeys, parseSourceFileName } from '../shared/archive.ts';
import { derivedEntryFile, derivedEntryFileExists, isDerivedEntryFile } from '../shared/derived-entries.ts';
import { buildFoiObservations } from '../shared/foi-observations.ts';
import { parseCallsign, cleanedCallsign, loadReferenceData, normaliseLicenceCategory, type ReferenceData } from '../sources/ofcom-amateur/components.ts';
import { mdCode } from '../shared/markdown.ts';
import { escapeHtml } from './render/html.ts';
import { buildValueCatalogueFold, type FoldedFields } from './value-catalogue-fold.ts';
import { availablePoolEntries } from '../v2/collectors/available-pool.ts';
import { forbiddenListEntries } from '../v2/collectors/forbidden-list.ts';
import { parseJsonObject } from '../shared/json-shape.ts';

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
  // Set on a MEMBERSHIP-DERIVED value only (the `status` fold's Available /
  // Forbidden buckets, issue #707): the family whose @listed membership the
  // bucket is projected from ('available-pool' / 'forbidden-list'). No source
  // asserted the value as a status — the ledger models it as family membership,
  // not a status claim — so the renderer labels the row as a projection and never
  // presents it as an attested status. Absent (undefined) on every attested value.
  membership?: string;
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

// The special-event / Notice-of-Variation licence-category family and the
// temporal character its NAMES suggest (issue #344). Ofcom issues these under
// a Notice of Variation; the names read as event-bounded (Special Event
// Station — a jubilee year, a single commemoration) or open-ended (the
// permanent variant, the research permit), but the register never defines the
// terms, so the characters below are the names' nominal reading, presented for
// the reader to weigh against the per-record evidence. The register's own
// created_date (record creation) and reserved_to_date (reservation expiry)
// BRACKET an event window rather than state it, and the snapshot day is only
// month-level, so any window is attested-or-bracketed, never inferred. The
// correspondence between the category and its temporal shape is a TENDENCY the
// register does not enforce (permanent records that nonetheless carry an expiry
// date, event records that carry none), surfaced beside the category table with
// the counter-examples flagged rather than smoothed. Keys are canonical
// categories of licence-category.csv; a category named here that the map no
// longer emits is a drift the tests catch.
type SesTemporalCharacter = 'event-bounded' | 'open-ended';
const SES_TEMPORAL_CHARACTER: ReadonlyMap<string, SesTemporalCharacter> = new Map([
  ['Special Event Station', 'event-bounded'],
  ['Permanent Special Event Station', 'open-ended'],
  ['Special Research Permit', 'open-ended'],
]);

// One special-event category's attested temporal-window evidence: over the FOI
// observations whose source STATES a reservation-expiry field (reserved_to_date
// present, not merely blank), how many carry an actual end date versus leave it
// open. Records from sources that do not carry the field at all are excluded —
// the register does not state a window there, so counting them would fabricate a
// denominator.
export interface SesWindowAttestation {
  category: string;
  character: SesTemporalCharacter;
  // Records whose source states the reservation-expiry field (the denominator).
  statingField: number;
  // Of those, records carrying a reservation-end date (an attested window close).
  withEndDate: number;
  // Of those, records leaving the field blank (open-ended within a stating source).
  openEnded: number;
}

// The register column that states a reservation's expiry — the attested close of
// an event window when a special-event callsign carries one.
const RESERVATION_EXPIRY_COLUMN = 'reserved_to_date';

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
  tallyFoi(bump, ref, path.join(DIRS.archive, 'foi'));
  return tallies;
}

// Attest the special-event family's temporal windows (issue #344) from the FOI
// observations. For each observation whose licence_class maps into a
// SES_TEMPORAL_CHARACTER category AND whose source states the reservation-expiry
// field, tally whether it carries an end date or leaves it open. Only the FOI
// register snapshots carry this field, so the attestation is legitimately sparse
// — the evidence brackets the window, which is why it is reported beside the
// category rather than folded into it. Categories with no attesting record are
// omitted (nothing attested), never shown as a fabricated zero-window.
export function collectSesWindowAttestation(foiDir: string, ref: ReferenceData): SesWindowAttestation[] {
  const acc = new Map<string, { statingField: number; withEndDate: number; openEnded: number }>();
  for (const obs of buildFoiObservations(foiDir)) {
    const licenceClass = obs.values['licence_class'];
    if (licenceClass === null || licenceClass === undefined) continue;
    const category = normaliseLicenceCategory(licenceClass, ref);
    if (category === null || !SES_TEMPORAL_CHARACTER.has(category)) continue;
    const expiry = obs.values[RESERVATION_EXPIRY_COLUMN];
    // null = the source does not carry the field, so it states no window here.
    if (expiry === null || expiry === undefined) continue;
    const bucket = acc.get(category) ?? { statingField: 0, withEndDate: 0, openEnded: 0 };
    bucket.statingField += 1;
    if (expiry.trim() === '') bucket.openEnded += 1; else bucket.withEndDate += 1;
    acc.set(category, bucket);
  }
  const attestations: SesWindowAttestation[] = [];
  for (const [category, character] of SES_TEMPORAL_CHARACTER) {
    const bucket = acc.get(category);
    if (bucket === undefined) continue;
    attestations.push({ category, character, ...bucket });
  }
  return attestations;
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
  // Only ATTESTED statuses are candidates for reconciliation; a membership-derived
  // projection (issue #707) is not a "seen but unreasoned" status value, so it is
  // excluded from the drift call-out.
  const unexpectedStatus = status?.values.filter(v => v.membership === undefined && !EXPECTED_STATUS.has(v.value)) ?? [];
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

// --- Membership-derived rows: demoted from `status` to their own curio section (issue #722) ---
//
// The `status` fold still PROJECTS the `Available` (available-pool) and
// `Forbidden` (forbidden-list) membership rows exactly as before (issue #707) -
// the drift-golden function is untouched, so a tenth pool snapshot or a fifth
// forbidden disclosure still changes the committed report. Only the PUBLISHED
// presentation moves: these two rows read, in the prominent status table, as
// facts about the callsign world (a `records` figure with no number a reader
// carries in their head), when they are really facts about the archive - rows
// summed across however many snapshots of one family happen to be held. So
// they are pulled out of the status table into this section, led by the
// quantities that matter (distinct callsigns, latest snapshot size) with the
// vintage stated plainly and the records-sum kept but marked as corpus
// coverage, never as availability/forbiddenness information.

// One family's vintage span, read straight from the FOI archive metadata the
// collectors already expose (available-pool.ts / forbidden-list.ts) - no new
// derivation, just the dataVintage already carried by each held entry.
export interface MembershipVintage {
  minVintage: string;
  maxVintage: string;
  // The entry (ledger source key) carrying the latest vintage, so the renderer
  // can read that source's own record count straight off the value's bySource
  // breakdown - the same breakdown the timeline/breadth columns already use.
  latestEntry: string;
}

function earliestAndLatest(entries: { entry: string; meta: { dataVintage: string | null } }[]): MembershipVintage | undefined {
  const dated = entries
    .map(e => ({ entry: e.entry, vintage: e.meta.dataVintage }))
    .filter((e): e is { entry: string; vintage: string } => typeof e.vintage === 'string' && e.vintage !== '')
    .sort((a, b) => a.vintage.localeCompare(b.vintage));
  if (dated.length === 0) return undefined;
  return { minVintage: dated[0].vintage, maxVintage: dated[dated.length - 1].vintage, latestEntry: dated[dated.length - 1].entry };
}

// The two membership families' vintage spans, keyed to match ValueTally.membership.
export function collectMembershipVintages(foiDir: string): Map<string, MembershipVintage> {
  const out = new Map<string, MembershipVintage>();
  const pool = earliestAndLatest(availablePoolEntries(foiDir));
  if (pool !== undefined) out.set('available-pool', pool);
  const forbidden = earliestAndLatest(forbiddenListEntries(foiDir));
  if (forbidden !== undefined) out.set('forbidden-list', forbidden);
  return out;
}

// The year portion of a dataVintage string (`YYYY-MM-DD` or `YYYY-MM`) - all the
// prose below needs, and robust to the two precisions the archive carries.
function vintageYear(vintage: string): string {
  return vintage.slice(0, 4);
}

// Family-specific prose: the noun for one held snapshot, what the family
// declares a callsign/suffix AS, and (available-pool only) the domain fact that
// the pool's snapshots predate the M7/M8/M9 prefix releases - so even the
// LATEST one describes a namespace that no longer exists in that shape.
const MEMBERSHIP_FAMILY_PROSE: ReadonlyMap<string, { snapshotNoun: string; declaredAs: string; staleness?: string }> = new Map([
  ['available-pool', {
    snapshotNoun: 'pool snapshots',
    declaredAs: 'available',
    staleness: ' (pre-M7/M8/M9 - the namespace these snapshots describe no longer exists in that shape)',
  }],
  ['forbidden-list', { snapshotNoun: 'forbidden-suffix disclosures', declaredAs: 'forbidden' }],
]);

// One membership row's table line: vintage stated plainly, then LED by the
// meaningful quantities (distinct callsigns, latest snapshot size), with the
// records-sum retained but explicitly marked as corpus coverage rather than a
// population figure.
function membershipCuriosityRow(v: ValueTally, vintages: Map<string, MembershipVintage>): string {
  const family = v.membership ?? '';
  const prose = MEMBERSHIP_FAMILY_PROSE.get(family);
  const vintage = vintages.get(family);
  const vintageText = vintage === undefined
    ? `${v.sources} ${prose?.snapshotNoun ?? 'snapshots'}`
    : `${v.sources} ${prose?.snapshotNoun ?? 'snapshots'}, ${vintageYear(vintage.minVintage)}–${vintageYear(vintage.maxVintage)}${prose?.staleness ?? ''}`;
  const latestSize = vintage !== undefined ? v.bySource.get(vintage.latestEntry) : undefined;
  const latestText = latestSize === undefined || vintage === undefined
    ? '—'
    : `${latestSize.toLocaleString('en-GB')} (${vintage.maxVintage})`;
  const declaredAs = prose?.declaredAs ?? 'listed';
  const label = `${mdCode(v.value)} — ${family} membership`;
  const recordsText = `${v.count.toLocaleString('en-GB')} rows across ${v.sources} held snapshots — grows with ingestion, not with ${declaredAs === 'available' ? 'availability' : 'forbiddenness'}`;
  return `| ${label} | ${vintageText} | ${v.distinctCallsigns.toLocaleString('en-GB')} | ${latestText} | ${recordsText} |`;
}

// The internal cross-checks/curio section (issue #722): the membership-derived
// rows the `status` fold projects, demoted here from the prominent status
// table. Omitted entirely when the fold carries no membership row (e.g. a
// presentation test's hand-built tallies), so no section is fabricated.
function membershipCuriositiesSection(status: FieldCatalogue | undefined, vintages: Map<string, MembershipVintage>): string[] {
  const rows = status?.values.filter(v => v.membership !== undefined) ?? [];
  if (rows.length === 0) return [];
  const lines: string[] = [];
  lines.push('## Cross-checks and curiosities');
  lines.push('');
  lines.push('Artefacts of the corpus itself, not facts about the callsign world today -');
  lines.push('kept for corroboration (issue #723) and the contradiction-gap check (issue');
  lines.push('#724), never as a read of current availability or forbiddenness.');
  lines.push('');
  lines.push('### Membership-derived rows demoted from `status`');
  lines.push('');
  lines.push('No source ever recorded these two values in a status column - the ledger');
  lines.push('models them as FOI family membership (available-pool `@listed` /');
  lines.push('forbidden-list `@listed`), not a per-record status claim (issue #707), and');
  lines.push('the `status` table above no longer shows them. Each is its own corpus');
  lines.push('artefact with its own vintage: led by the quantities that matter -');
  lines.push('distinct callsigns and the latest held snapshot\'s size - with the');
  lines.push('records-sum kept but marked plainly as corpus coverage (it grows when the');
  lines.push('archive grows, not when availability/forbiddenness changes).');
  lines.push('');
  lines.push('| row | vintage | distinct callsigns | latest snapshot | records (corpus coverage) |');
  lines.push('|---|---|---:|---:|---|');
  for (const v of rows) lines.push(membershipCuriosityRow(v, vintages));
  lines.push('');
  return lines;
}

// A short glossary-style note anchoring the records-vs-callsigns semantics
// (issue #722) with a concrete, always-live teaching example: the `status`
// field's attested `Allocated` row, whose records figure is the corpus's
// ingestion depth (one entry per held snapshot a callsign appears in), not a
// population count. Read straight off the already-computed status catalogue -
// no new computation tier - so the numbers can never drift from the table
// below it. Omitted (never fabricated) when the fold hands no `status` field.
function recordsVsCallsignsGloss(status: FieldCatalogue | undefined): string[] {
  const allocated = status?.values.find(v => v.value === 'Allocated' && v.membership === undefined);
  if (allocated === undefined) return [];
  return [
    'For scale, the teaching example: the corpus\'s `Allocated` status alone',
    `carries ${allocated.count.toLocaleString('en-GB')} records from just`,
    `${allocated.distinctCallsigns.toLocaleString('en-GB')} distinct callsigns across ${allocated.sources} held`,
    'snapshots - the record count tracks how many snapshots the corpus holds,',
    'not how many callsigns exist.',
    '',
  ];
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
// The special-event family's temporal-character note (issue #344), rendered
// beside the category table. It names each category's temporal shape and reports
// the attested reservation-window coverage, then FLAGS the counter-examples the
// register carries rather than smoothing them: permanent records that
// nonetheless expire, event records left open. Absent attestation (no source
// stating the field) yields no note.
function sesTemporalCharacterSection(windows: readonly SesWindowAttestation[]): string[] {
  if (windows.length === 0) return [];
  const lines: string[] = [];
  lines.push('### Temporal character of the special-event family');
  lines.push('');
  lines.push('The special-event / Notice-of-Variation category NAMES suggest different');
  lines.push('temporal shapes — `Special Event Station` reads as event-bounded (a');
  lines.push('jubilee year, a single commemoration), `Permanent Special Event Station`');
  lines.push('and `Special Research Permit` as open-ended — but the register does not');
  lines.push('define these terms, so the reading is the name\'s, not a rule, and the');
  lines.push('per-record evidence below is left for the reader to weigh.');
  lines.push('The register\'s own `created_date` (record creation) and');
  lines.push('`reserved_to_date` (reservation expiry) BRACKET an event window rather');
  lines.push('than state it, and the snapshot day is only month-level, so any window');
  lines.push('is attested-or-bracketed, never inferred. Only the register snapshots');
  lines.push('that state a reservation-expiry field attest a window, so the counts');
  lines.push('below are that field\'s slice of each category, not its whole population.');
  lines.push('');
  lines.push('| category | nominal character (from the name) | records stating a reservation field | with an end date | left open |');
  lines.push('|---|---|---:|---:|---:|');
  for (const w of windows) {
    lines.push(`| ${mdCode(w.category)} | ${w.character} | ${w.statingField.toLocaleString('en-GB')} | ${w.withEndDate.toLocaleString('en-GB')} | ${w.openEnded.toLocaleString('en-GB')} |`);
  }
  lines.push('');
  // The counter-examples: an event-bounded record left open, or an open-ended
  // record that nonetheless expires. Resolve AND flag (transparency) — the
  // window is read per record, never assumed from the category name.
  const eventOpen = windows.filter(w => w.character === 'event-bounded' && w.openEnded > 0);
  const permExpiring = windows.filter(w => w.character === 'open-ended' && w.withEndDate > 0);
  if (eventOpen.length > 0 || permExpiring.length > 0) {
    // "1 record ... carries" but "36 records ... carry": agree noun and verb so a
    // lone counter-example still reads correctly. Singular/plural verb given.
    const records = (n: number, singularVerb: string, pluralVerb: string): string =>
      `${n.toLocaleString('en-GB')} record${n === 1 ? '' : 's'} ${n === 1 ? singularVerb : pluralVerb}`;
    const clauses: string[] = [];
    for (const w of permExpiring) {
      clauses.push(`${mdCode(w.category)}: ${records(w.withEndDate, 'nonetheless carries', 'nonetheless carry')} an end date`);
    }
    for (const w of eventOpen) {
      clauses.push(`${mdCode(w.category)}: ${records(w.openEnded, 'carries', 'carry')} none`);
    }
    lines.push(`⚠ The correspondence is a tendency the register does not enforce, flagged rather than smoothed — ${clauses.join('; ')}. The window is read per record from the register, never assumed from the category.`);
    lines.push('');
  }
  return lines;
}

function licenceCategorySection(
  cats: Map<string, FieldCatalogue>,
  ref: ReferenceData,
  productCells?: Map<string, Cell>,
  folded?: LicenceCategoryFigures[],
  sesWindows: readonly SesWindowAttestation[] = [],
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
  lines.push(...sesTemporalCharacterSection(sesWindows));
  return lines;
}

// A per-value sparkline over the dated open-data publications: each bar is the
// value's count in that publication, scaled to the value's OWN peak so its
// temporal shape shows (present-then-gone reads differently from steady). `·`
// marks a publication where the value is absent - the point of the timeline.
//
// The bars alone are a picture of the data, not the data (issue #732): a
// screen reader has nothing useful to announce for a run of block
// characters, and nothing on the page states the dates/values behind them.
// So the bars are wrapped in a self-describing span - `role="img"` +
// `aria-label` supplies the accessible name (a bare `title` is weakly
// supported by assistive tech), `title` repeats the same pairs for a mouse
// hover. Both list EVERY bar's date:count, in bar order, at the timeline's
// own precision (the archive key strings), thousands-separated -
// completeness over brevity, since this IS the data the bars stand in for.
//
// The `title` reaches a mouse only - it neither taps nor focuses (issue
// #742). A native `<details>` disclosure carries the SAME date:count pairs
// (one source, three consumers: aria-label, title, disclosure - never
// recomputed) reachable by touch (tap) and keyboard (Tab to focus,
// Enter/Space to open), with no script required to open it. It is appended
// after the span rather than replacing the tooltip - belt-and-braces, since
// the tooltip still serves a hovering mouse fastest.
//
// `title` joins its pairs with ` · ` rather than a newline: a
// newline-separated title (one publication per line on hover) was considered
// (issue #783) but would touch every timeline row in the committed golden
// master for a purely cosmetic hover change - not worth that churn, so the
// separator stays as it is.
//
// Every interpolated date/count passes through escapeHtml at the point it
// enters these strings - defence-in-depth (#783), not a live gap: today's
// values are archive key strings and toLocaleString('en-GB') output, never
// free text, so nothing here currently has anything to escape. If either
// input's shape ever changed to carry a metacharacter, it could not break
// out of the `title`/`aria-label` attributes or the disclosure markup.
const SPARK_BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const SPARKLINE_DISCLOSURE_SUMMARY = 'Per-publication counts';
function sparkline(bySource: Map<string, number>, timeline: string[]): string {
  const counts = timeline.map(key => bySource.get(key) ?? 0);
  const peak = Math.max(0, ...counts);
  const bars = counts
    .map(c => {
      if (c === 0) return '·';
      if (peak <= 1) return SPARK_BARS[SPARK_BARS.length - 1];
      return SPARK_BARS[Math.round(((c - 1) / (peak - 1)) * (SPARK_BARS.length - 1))];
    })
    .join('');
  const pairs = timeline.map((date, i) => `${escapeHtml(date)}: ${escapeHtml(counts[i].toLocaleString('en-GB'))}`);
  const ariaLabel = `timeline across ${timeline.length} publications: ${pairs.join('; ')}`;
  const title = pairs.join(' · ');
  const disclosure = `<details><summary>${SPARKLINE_DISCLOSURE_SUMMARY}</summary>${pairs.join('<br>')}</details>`;
  return `<span role="img" aria-label="${ariaLabel}" title="${title}">${bars}</span>${disclosure}`;
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
    const dir = path.join(DIRS.archive, key);
    // The parse source (the declared extract for a workbook or shape-only
    // header fill, else raw.csv) - so a workbook publication's fidelity is
    // checked rather than silently skipped.
    const metaPath = path.join(dir, 'meta.json');
    const meta = fs.existsSync(metaPath) ? parseJsonObject(fs.readFileSync(metaPath, 'utf8'), metaPath) as ArchiveMeta : undefined;
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

// FOLD, not re-derive (issues #361 / #444 / #707). `foldedCategories` supplies the
// licence-category table from the ledger's derived `licence_category` claim;
// `foldedFields` supplies the per-field value tables for EVERY tracked field —
// `status` and raw `product / licence_class` (folded from the raw observation
// layer, scoped to the register lane, with status projecting its membership
// buckets), implied_class / parse_status / prefix_series (the parse tier) and
// `flags` (every signal riding FLAG_PREDICATE). Both are OPTIONAL: without them the
// renderer falls back to the legacy tally, so the presentation tests (which pass
// hand-built tallies) are unaffected. In production the folds cover every field,
// including Notable and the licence-category residues.
export function renderValueCatalogue(tallies: Tallies, ref: ReferenceData, timeline: string[] = [], fidelity: EntryFidelity[] = [], foldedCategories?: LicenceCategoryFigures[], foldedFields?: FoldedFields, sesWindows: readonly SesWindowAttestation[] = [], membershipVintages: Map<string, MembershipVintage> = new Map()): string {
  const FIELD_ORDER = ['status', PRODUCT_FIELD, 'implied_class', 'parse_status', 'prefix_series', 'flags'];
  // Every field folds from the raw-keyed claim ledger (issues #361 / #444 / #707);
  // a folded catalogue is preferred, falling back to the legacy tally only for a
  // presentation test that hands a field no fold. So Notable, the licence-category
  // residues and the field tables all read one `cats` map, folded in production.
  const cats = new Map<string, FieldCatalogue>();
  for (const field of FIELD_ORDER) {
    const folded = foldedFields?.get(field);
    if (folded !== undefined) { cats.set(field, folded); continue; }
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
  out.push(...recordsVsCallsignsGloss(cats.get('status')));
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

  out.push(...licenceCategorySection(cats, ref, tallies.get(PRODUCT_FIELD), foldedCategories, sesWindows));

  out.push(...normalisationFidelitySection(fidelity));

  for (const field of FIELD_ORDER) {
    // Every field's distribution folds from the ledger (issues #361 / #444 / #707);
    // a presentation test may still hand a legacy tally. Same FieldCatalogue shape
    // either way, so the table renders identically whichever path supplied it.
    const cat = cats.get(field);
    if (cat === undefined) continue;
    // The value of the `status` field already IS a status, so an "allocated"
    // sub-count of it is circular; render it not-applicable there.
    const allocatable = field !== 'status';
    // The `status` fold still PROJECTS the membership-derived `Available` /
    // `Forbidden` buckets (issue #707) - they are excluded from THIS table
    // (issue #722: demoted to the Cross-checks and curiosities section below)
    // rather than shown inline, so the header's distinct count and the table
    // rows both reflect the attested values a reader actually sees here.
    const attestedValues = cat.values.filter(v => v.membership === undefined);
    out.push(`## \`${field}\` — ${attestedValues.length} distinct`);
    out.push('');
    if (attestedValues.length !== cat.values.length) {
      out.push('Two membership-derived rows this table would otherwise carry -');
      out.push('`Available` (available-pool membership) and `Forbidden`');
      out.push('(forbidden-list membership) - are demoted to the **Cross-checks and');
      out.push('curiosities** section below (issue #722): no source recorded them in a');
      out.push('status column, so they are corpus artefacts with their own vintage,');
      out.push('never availability/forbiddenness information about the callsign world');
      out.push('today.');
      out.push('');
    }
    out.push(`| value | records | callsigns | allocated | sources |${hasTimeline ? ' timeline |' : ''} lanes |`);
    out.push(`|---|---:|---:|---:|---:|${hasTimeline ? '---|' : ''}---|`);
    for (const v of attestedValues) {
      const spark = hasTimeline ? ` ${sparkline(v.bySource, timeline)} |` : '';
      const allocated = allocatable ? v.allocated.toLocaleString('en-GB') : '—';
      out.push(`| ${mdCode(v.value)} | ${v.count.toLocaleString('en-GB')} | ${v.distinctCallsigns.toLocaleString('en-GB')} | ${allocated} | ${v.sources} |${spark} ${v.lanes.join(', ')} |`);
    }
    out.push('');
  }

  out.push(...membershipCuriositiesSection(cats.get('status'), membershipVintages));

  return out.join('\n');
}

export const VALUE_CATALOGUE_PATH = 'reports/value-catalogue.md';

export function writeValueCatalogue(ledgerDir?: string): { path: string; changed: boolean } {
  const ref = loadReferenceData();
  // The "Normalised licence category" table and EVERY tracked field distribution
  // — `status` and raw `product / licence_class` (the raw observation layer,
  // scoped to the register lane, status projecting its membership buckets),
  // implied_class / parse_status / prefix_series, and `flags` — fold from the
  // raw-keyed claim ledger (issues #361 / #444 / #707). One ledger is materialised
  // and every section folds from it; a caller with a pre-built ledger passes its
  // directory.
  const { categories: foldedCategories, fields: foldedFields } = buildValueCatalogueFold(ledgerDir, ref);
  const foiDir = path.join(DIRS.archive, 'foi');
  const sesWindows = collectSesWindowAttestation(foiDir, ref);
  // The membership-derived rows' vintage spans (issue #722), read straight off
  // the FOI archive metadata the available-pool/forbidden-list collectors
  // already expose - so the Cross-checks and curiosities section states each
  // family's vintage plainly rather than leaving it to the reader to derive.
  const membershipVintages = collectMembershipVintages(foiDir);
  // Every value-catalogue field now folds from the raw-keyed claim ledger (issues
  // #361 / #444 / #707), so the report is produced entirely from the folds; the
  // legacy full-corpus tally (buildFieldTallies) is retired from the production
  // path and survives only as the equivalence oracle's witness in the tests. An
  // empty tally map is passed so the renderer reads the folds for every field.
  const markdown = renderValueCatalogue(new Map(), ref, openDataTimeline(), buildNormalisationFidelity(), foldedCategories, foldedFields, sesWindows, membershipVintages);
  // Written relative to the working directory - the SAME root the tallies read
  // archive/ from (DIRS.archive is relative). So a sweep run against
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
