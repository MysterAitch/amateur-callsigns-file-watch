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
import { CONSTANTS } from '../shared/utils.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import { buildFoiObservations } from '../shared/foi-observations.ts';
import { parseCallsign, loadReferenceData, type ReferenceData } from '../sources/ofcom-amateur/components.ts';

// A blank source value is data (the source asserted an empty string); a value
// the source does not carry at all is a different thing. Both render legibly.
const BLANK = '(blank)';

export interface ValueTally { value: string; count: number; lanes: string[] }
export interface FieldCatalogue { field: string; distinct: number; total: number; values: ValueTally[] }

type Bump = (field: string, value: string, lane: string, n?: number) => void;

// Accumulate counts into field -> value -> { count, lanes }. Pure over its
// inputs; the corpus reading is done by buildFieldTallies below.
function makeTallies(): { tallies: Map<string, Map<string, { count: number; lanes: Set<string> }>>; bump: Bump } {
  const tallies = new Map<string, Map<string, { count: number; lanes: Set<string> }>>();
  const bump: Bump = (field, value, lane, n = 1) => {
    let byValue = tallies.get(field);
    if (byValue === undefined) { byValue = new Map(); tallies.set(field, byValue); }
    const key = value === '' ? BLANK : value;
    const cell = byValue.get(key);
    if (cell === undefined) byValue.set(key, { count: n, lanes: new Set([lane]) });
    else { cell.count += n; cell.lanes.add(lane); }
  };
  return { tallies, bump };
}

// The fields profiled and the lane each source contributes. `product` (open
// data) and `licence_class` (FOI) describe the same concept under different
// vocabularies, so they share one field to make the drift visible.
const PRODUCT_FIELD = 'product / licence_class';

function tallyOpenData(bump: Bump, key: string): void {
  const dir = path.join(CONSTANTS.DIRS.archive, key);
  const readCsv = (name: string): Record<string, string>[] => {
    const p = path.join(dir, name);
    return fs.existsSync(p) ? parse(fs.readFileSync(p, 'utf8'), { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[] : [];
  };
  for (const r of readCsv('normalised.csv')) {
    bump('status', (r['status'] ?? '').trim(), 'open-data');
    bump(PRODUCT_FIELD, (r['product'] ?? '').trim(), 'open-data');
  }
  for (const r of readCsv('components.csv')) {
    bump('prefix_series', (r['prefix_series'] ?? '').trim(), 'open-data');
    bump('implied_class', (r['implied_class'] ?? '').trim(), 'open-data');
    bump('parse_status', (r['parse_status'] ?? '').trim(), 'open-data');
    for (const f of (r['flags'] ?? '').split(';').filter(x => x !== '')) bump('flags', f, 'open-data');
  }
}

function tallyFoi(bump: Bump, ref: ReferenceData, foiDir: string): void {
  for (const obs of buildFoiObservations(foiDir)) {
    const status = obs.values['status'];
    if (status !== null && status !== undefined) bump('status', status.trim(), 'foi');
    const licenceClass = obs.values['licence_class'];
    if (licenceClass !== null && licenceClass !== undefined) bump(PRODUCT_FIELD, licenceClass.trim(), 'foi');
    const c = parseCallsign(obs.callsign, licenceClass ?? '', ref);
    bump('prefix_series', c.prefixSeries, 'foi');
    bump('implied_class', c.impliedClass, 'foi');
    bump('parse_status', c.parseStatus, 'foi');
    for (const f of c.flags) bump('flags', f, 'foi');
  }
}

export function buildFieldTallies(): Map<string, Map<string, { count: number; lanes: Set<string> }>> {
  const { tallies, bump } = makeTallies();
  const ref = loadReferenceData();
  for (const key of listArchiveKeys().sort()) tallyOpenData(bump, key);
  tallyFoi(bump, ref, path.join(CONSTANTS.DIRS.archive, 'foi'));
  return tallies;
}

// Order a field's values by count desc, then value, so the report is stable.
export function catalogueField(field: string, byValue: Map<string, { count: number; lanes: Set<string> }>): FieldCatalogue {
  const values: ValueTally[] = [...byValue.entries()]
    .map(([value, { count, lanes }]) => ({ value, count, lanes: [...lanes].sort() }))
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
    lines.push(`- **Status values with no canonical mapping decided**: ${unexpectedStatus.map(v => `\`${v.value}\` (${v.count.toLocaleString('en-GB')})`).join(', ')}. Seen but not reasoned about as register states - candidates for reconciliation or an FOI on the state vocabulary.`);
  }
  const prefixes = cats.get('prefix_series');
  const unknownPrefixes = prefixes?.values.filter(v => v.value !== BLANK && !ref.prefixSeries.has(v.value)) ?? [];
  if (unknownPrefixes.length > 0) {
    lines.push(`- **Prefix series outside the reference table** (\`reference-data/prefix-formats.csv\`): ${unknownPrefixes.map(v => `\`${v.value}\` (${v.count.toLocaleString('en-GB')})`).join(', ')}. A supposed-to-be-empty prefix that is not empty (e.g. \`M2\`) is exactly the kind of surprise this catalogue exists to flag.`);
  }
  const product = cats.get(PRODUCT_FIELD);
  const crossLane = product?.values.filter(v => v.lanes.length > 1).length ?? 0;
  const variants = product?.distinct ?? 0;
  if (variants > 3) {
    lines.push(`- **Licence product/class vocabulary drift**: ${variants} distinct variants across the corpus (${crossLane} appear in both lanes). The same class is written differently by source (e.g. \`Full\` vs \`Amateur Full Radio Licence\`) - these are passed through VERBATIM today (source fidelity), so this is the explicit, counted list of canonicalisation candidates.`);
  }
  return lines;
}

export function renderValueCatalogue(tallies: Map<string, Map<string, { count: number; lanes: Set<string> }>>, ref: ReferenceData): string {
  const FIELD_ORDER = ['status', PRODUCT_FIELD, 'implied_class', 'parse_status', 'prefix_series', 'flags'];
  const cats = new Map<string, FieldCatalogue>();
  for (const field of FIELD_ORDER) {
    const byValue = tallies.get(field);
    if (byValue !== undefined) cats.set(field, catalogueField(field, byValue));
  }

  const out: string[] = [];
  out.push('# Value catalogue');
  out.push('');
  out.push('Every distinct value of the tracked fields across the whole corpus');
  out.push('(open-data publications + FOI observations), with counts and the lanes');
  out.push('that carry it. Regenerated by the normalise sweep and committed, so a');
  out.push('change here in a PR diff is a drift signal - a new status, a prefix that');
  out.push('should not exist, a fresh vocabulary variant. Values are the *derived /');
  out.push('canonical* surface; nothing is dropped or force-mapped - unmapped values');
  out.push('are shown, never assumed away.');
  out.push('');

  const notable = notableSection(cats, ref);
  if (notable.length > 0) {
    out.push('## Notable');
    out.push('');
    out.push(...notable);
    out.push('');
  }

  for (const field of FIELD_ORDER) {
    const cat = cats.get(field);
    if (cat === undefined) continue;
    out.push(`## \`${field}\` — ${cat.distinct} distinct`);
    out.push('');
    out.push('| value | count | lanes |');
    out.push('|---|---:|---|');
    for (const v of cat.values) {
      out.push(`| \`${v.value.replace(/\|/g, '\\|')}\` | ${v.count.toLocaleString('en-GB')} | ${v.lanes.join(', ')} |`);
    }
    out.push('');
  }
  return out.join('\n');
}

export const VALUE_CATALOGUE_PATH = 'reports/value-catalogue.md';

export function writeValueCatalogue(): { path: string; changed: boolean } {
  const ref = loadReferenceData();
  const markdown = renderValueCatalogue(buildFieldTallies(), ref);
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
  const { path: written, changed } = writeValueCatalogue();
  console.log(`${changed ? 'wrote' : 'up to date'}: ${written}`);
}
