/**
 * Cross-dataset invariant probes (issue #241): a committed, byte-deterministic
 * report joining the FOI lane against the open-data register on the `cleaned`
 * callsign key to surface relationships no single dataset shows. A change in a
 * PR diff is a drift signal.
 *
 * FIRST CUT: one probe — available-pool depletion. The remaining probes from
 * #241 (available x record-of overlap matrix, absent-from-both decomposition,
 * same-vintage complementarity, original-start-date) are staged; see the issue.
 *
 * `cleaned` is a JOIN KEY, not an identity (uppercased, stripped outside
 * A-Z/0-9/`/`); collisions are expected and deliberate, so counts are of
 * distinct cleaned keys, never asserted as distinct stations.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { CONSTANTS } from '../shared/utils.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import { listFoiEntryKeys, readFoiEntryMeta } from '../shared/foi-archive.ts';
import { cleanedCallsign } from '../sources/ofcom-amateur/components.ts';

export interface DepletionRow { entry: string; vintage: string; available: number; nowAllocated: number; stillAbsent: number }

function readCsv(file: string): Record<string, string>[] {
  return parse(fs.readFileSync(file, 'utf8'), { columns: true, bom: true, skip_empty_lines: true }) as Record<string, string>[];
}

// Probe: of the callsigns each FOI available-pool snapshot listed as available,
// how many are Allocated in the LATEST register (the pool has been drawn down),
// versus still absent from the allocated set. Depletion over the years between
// the snapshot's vintage and today.
export function buildDepletion(): { register: string; allocatedTotal: number; rows: DepletionRow[] } {
  const keys = listArchiveKeys().sort();
  const register = keys[keys.length - 1];
  if (register === undefined) return { register: '', allocatedTotal: 0, rows: [] };
  const allocated = new Set(
    readCsv(path.join(CONSTANTS.DIRS.archive, register, 'normalised.csv'))
      .filter(r => r['status'] === 'Allocated')
      .map(r => cleanedCallsign(r['callsign'] ?? '')),
  );

  const foiDir = path.join(CONSTANTS.DIRS.archive, 'foi');
  const rows: DepletionRow[] = [];
  for (const entry of listFoiEntryKeys(foiDir)) {
    const meta = readFoiEntryMeta(foiDir, entry);
    if (!(meta.datasetClasses ?? []).includes('available-pool')) continue;
    const available = new Set<string>();
    for (const name of fs.readdirSync(path.join(foiDir, entry)).filter(n => /^normalised--.*\.csv$/.test(n)).sort()) {
      for (const r of readCsv(path.join(foiDir, entry, name))) {
        const c = r['callsign'];
        if (c !== undefined && c !== '') available.add(cleanedCallsign(c));
      }
    }
    if (available.size === 0) continue;
    let nowAllocated = 0;
    for (const c of available) if (allocated.has(c)) nowAllocated += 1;
    rows.push({ entry, vintage: meta.dataVintage ?? '—', available: available.size, nowAllocated, stillAbsent: available.size - nowAllocated });
  }
  rows.sort((a, b) => a.vintage.localeCompare(b.vintage) || a.entry.localeCompare(b.entry));
  return { register, allocatedTotal: allocated.size, rows };
}

export function renderCrossDatasetInvariants(d: { register: string; allocatedTotal: number; rows: DepletionRow[] }): string {
  const out: string[] = [];
  out.push('# Cross-dataset invariants');
  out.push('');
  out.push('Relationships the FOI lane and the open-data register only reveal when');
  out.push('joined on the `cleaned` callsign key (uppercased, stripped outside');
  out.push('A–Z/0–9/`/`) — a join key, not an identity, so counts are of distinct');
  out.push('cleaned keys. Regenerated and committed, so a change in a PR diff is a');
  out.push('drift signal. First cut: one probe (available-pool depletion); the rest');
  out.push('of issue #241 is staged.');
  out.push('');
  out.push('## Available-pool depletion');
  out.push('');
  out.push(`Each FOI "available callsigns" snapshot lists callsigns Ofcom declared`);
  out.push(`available at its vintage. Joined against the latest register`);
  out.push(`(\`${d.register}\`, ${d.allocatedTotal.toLocaleString('en-GB')} Allocated): how many of`);
  out.push('that pool are now Allocated (drawn down) versus still absent from the');
  out.push('allocated set. Absence is not evidence of current availability — a');
  out.push('callsign may since have moved through Reserved or been withheld.');
  out.push('');
  out.push('| available-pool snapshot | vintage | available | now allocated | still absent | drawn down |');
  out.push('|---|---|---:|---:|---:|---:|');
  for (const r of d.rows) {
    const pct = r.available === 0 ? '—' : `${((r.nowAllocated / r.available) * 100).toFixed(1)}%`;
    out.push(`| \`${r.entry}\` | ${r.vintage} | ${r.available.toLocaleString('en-GB')} | ${r.nowAllocated.toLocaleString('en-GB')} | ${r.stillAbsent.toLocaleString('en-GB')} | ${pct} |`);
  }
  out.push('');
  return out.join('\n');
}

export const CROSS_DATASET_INVARIANTS_PATH = 'reports/cross-dataset-invariants.md';

export function writeCrossDatasetInvariants(): { path: string; changed: boolean } {
  const markdown = renderCrossDatasetInvariants(buildDepletion());
  const target = path.resolve(process.cwd(), CROSS_DATASET_INVARIANTS_PATH);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined;
  const changed = existing !== markdown;
  if (changed) fs.writeFileSync(target, markdown);
  return { path: CROSS_DATASET_INVARIANTS_PATH, changed };
}

if (import.meta.main) {
  const { path: written, changed } = writeCrossDatasetInvariants();
  console.log(`${changed ? 'wrote' : 'up to date'}: ${written}`);
}
