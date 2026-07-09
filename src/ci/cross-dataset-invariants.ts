/**
 * Cross-dataset invariant probes (issue #241): a committed, byte-deterministic
 * report joining the FOI lane against the open-data register on the `cleaned`
 * callsign key to surface relationships no single dataset shows. A change in a
 * PR diff is a drift signal.
 *
 * Probes so far: available-pool depletion, the decomposition of the
 * still-absent residue by current register status, and the original-issue-date
 * invariant. The remaining probes from #241 (available x record-of overlap
 * matrix, same-vintage complementarity) are staged; see the issue.
 *
 * `cleaned` is a JOIN KEY, not an identity (uppercased, stripped outside
 * A-Z/0-9/`/`); collisions are expected and deliberate, so counts are of
 * distinct cleaned keys, never asserted as distinct stations. Every figure is
 * DECLARED-not-verified: a reconciliation candidate, never a verdict.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { CONSTANTS } from '../shared/utils.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import { listFoiEntryKeys, readFoiEntryMeta } from '../shared/foi-archive.ts';
import { cleanedCallsign } from '../sources/ofcom-amateur/components.ts';

export interface DepletionRow {
  entry: string;
  vintage: string;
  available: number;
  nowAllocated: number;
  stillAbsent: number;
  // Probe 2 (absent-from-both, decomposed): the still-absent residue split by
  // the callsign's CURRENT status in the latest register. The three add up to
  // stillAbsent.
  nowReserved: number;
  stillAvailable: number;
  absentFromRegister: number;
  // Probe 5 (original-issue-date invariant): of the pool now allocated, how
  // many carry a licence original-start-date PREDATING the snapshot's vintage —
  // i.e. declared available at V yet apparently first licensed before V.
  allocatedWithDate: number;
  issuedBeforeVintage: number;
}

export interface CrossDataset { register: string; allocatedTotal: number; rows: DepletionRow[] }

function readCsv(file: string): Record<string, string>[] {
  return parse(fs.readFileSync(file, 'utf8'), { columns: true, bom: true, skip_empty_lines: true }) as Record<string, string>[];
}

// Join the FOI available-pool snapshots against the LATEST register on the
// cleaned key, in a single pass over the register. For each snapshot we learn:
// how much of the pool has been drawn down (allocated), how the still-absent
// remainder decomposes by current status, and how many of the now-allocated
// carry an original-start-date that predates the snapshot's vintage.
export function buildDepletion(): CrossDataset {
  const keys = listArchiveKeys().sort();
  const register = keys[keys.length - 1];
  if (register === undefined) return { register: '', allocatedTotal: 0, rows: [] };

  // cleaned key -> current status, and (for allocated) -> original-start-date.
  const status = new Map<string, string>();
  const originalStart = new Map<string, string>();
  let allocatedTotal = 0;
  for (const r of readCsv(path.join(CONSTANTS.DIRS.archive, register, 'normalised.csv'))) {
    const c = cleanedCallsign(r['callsign'] ?? '');
    const s = r['status'] ?? '';
    status.set(c, s);
    if (s === 'Allocated') {
      allocatedTotal += 1;
      const d = (r['licence_version_original_start_date'] ?? '').slice(0, 10);
      if (d !== '') originalStart.set(c, d);
    }
  }

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
    const vintage = meta.dataVintage ?? '—';
    let nowAllocated = 0, nowReserved = 0, stillAvailable = 0, absentFromRegister = 0;
    let allocatedWithDate = 0, issuedBeforeVintage = 0;
    for (const c of available) {
      const s = status.get(c);
      if (s === 'Allocated') {
        nowAllocated += 1;
        const d = originalStart.get(c);
        if (d !== undefined) {
          allocatedWithDate += 1;
          if (vintage !== '—' && d < vintage) issuedBeforeVintage += 1;
        }
      } else if (s === 'Reserved') {
        nowReserved += 1;
      } else if (s === 'Available') {
        stillAvailable += 1;
      } else {
        absentFromRegister += 1;
      }
    }
    rows.push({
      entry, vintage, available: available.size, nowAllocated,
      stillAbsent: available.size - nowAllocated,
      nowReserved, stillAvailable, absentFromRegister,
      allocatedWithDate, issuedBeforeVintage,
    });
  }
  rows.sort((a, b) => a.vintage.localeCompare(b.vintage) || a.entry.localeCompare(b.entry));
  return { register, allocatedTotal, rows };
}

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`;
}

function num(n: number): string {
  return n.toLocaleString('en-GB');
}

export function renderCrossDatasetInvariants(d: CrossDataset): string {
  const out: string[] = [];
  out.push('# Cross-dataset invariants');
  out.push('');
  out.push('Relationships the FOI lane and the open-data register only reveal when');
  out.push('joined on the `cleaned` callsign key (uppercased, stripped outside');
  out.push('A–Z/0–9/`/`) — a join key, not an identity, so counts are of distinct');
  out.push('cleaned keys. Regenerated and committed, so a change in a PR diff is a');
  out.push('drift signal. Every figure below is **declared, not verified**: a');
  out.push('candidate for reconciliation, never a verdict.');
  out.push('');

  out.push('## Available-pool depletion');
  out.push('');
  out.push('Each FOI "available callsigns" snapshot lists callsigns Ofcom declared');
  out.push('available at its vintage. Joined against the latest register');
  out.push(`(\`${d.register}\`, ${num(d.allocatedTotal)} Allocated): how many of`);
  out.push('that pool are now Allocated (drawn down) versus still absent from the');
  out.push('allocated set. Absence is not evidence of current availability — a');
  out.push('callsign may since have moved through Reserved or been withheld.');
  out.push('');
  out.push('| available-pool snapshot | vintage | available | now allocated | still absent | drawn down |');
  out.push('|---|---|---:|---:|---:|---:|');
  for (const r of d.rows) {
    out.push(`| \`${r.entry}\` | ${r.vintage} | ${num(r.available)} | ${num(r.nowAllocated)} | ${num(r.stillAbsent)} | ${pct(r.nowAllocated, r.available)} |`);
  }
  out.push('');

  out.push('## Absent-from-both, decomposed');
  out.push('');
  out.push('The still-absent remainder (available at the snapshot, not now');
  out.push('Allocated) split by the callsign\'s CURRENT status in the register:');
  out.push('now **Reserved** (held back), still **Available** (declared available');
  out.push('years on, never taken up), or **absent from the register entirely**');
  out.push('(no current row — withdrawn, never re-listed, or an artefact of the');
  out.push('cleaned join). The three sum to the still-absent column above.');
  out.push('');
  out.push('| available-pool snapshot | vintage | still absent | now reserved | still available | absent from register |');
  out.push('|---|---|---:|---:|---:|---:|');
  for (const r of d.rows) {
    out.push(`| \`${r.entry}\` | ${r.vintage} | ${num(r.stillAbsent)} | ${num(r.nowReserved)} | ${num(r.stillAvailable)} | ${num(r.absentFromRegister)} |`);
  }
  out.push('');

  out.push('## Original-issue-date invariant');
  out.push('');
  out.push('Of each pool now allocated, callsigns whose licence');
  out.push('original-start-date **predates** the snapshot that declared them');
  out.push('available. A callsign both "available" at vintage V and first licensed');
  out.push('before V is an apparent contradiction — a reconciliation candidate,');
  out.push('not a proven error (the available list may have included re-issuable');
  out.push('callsigns, or the recorded start-date may reflect an earlier holder).');
  out.push('');
  out.push('| available-pool snapshot | vintage | allocated with date | issued before vintage | share |');
  out.push('|---|---|---:|---:|---:|');
  for (const r of d.rows) {
    out.push(`| \`${r.entry}\` | ${r.vintage} | ${num(r.allocatedWithDate)} | ${num(r.issuedBeforeVintage)} | ${pct(r.issuedBeforeVintage, r.allocatedWithDate)} |`);
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
