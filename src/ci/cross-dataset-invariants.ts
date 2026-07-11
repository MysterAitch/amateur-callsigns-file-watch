/**
 * Cross-dataset invariant probes (issue #241): a committed, byte-deterministic
 * report joining the FOI lane against the open-data register on the `cleaned`
 * callsign key to surface relationships no single dataset shows. A change in a
 * PR diff is a drift signal.
 *
 * Probes so far: available-pool depletion, the decomposition of the
 * still-absent residue by current register status, the original-issue-date
 * invariant, and the available x record-of overlap matrix (each available
 * pool against every register vintage - the open-data publications and the
 * FOI register-snapshots). The last #241 probe, same-vintage complementarity,
 * stays blocked: it needs a register snapshot of the same vintage as an
 * available list, and none exists (available lists are 2013-2016; the
 * open-data register starts 2022, and no FOI register-snapshot matches those
 * early vintages). See the issue.
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
import { time, perfReport } from '../shared/perf.ts';

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

// Existence-guarded, matching the value-catalogue precedent: a missing file
// yields no rows rather than throwing, so partial archives (test fixtures, a
// sweep over entries that never normalised) degrade gracefully.
function readCsv(file: string): Record<string, string>[] {
  return fs.existsSync(file) ? parse(fs.readFileSync(file, 'utf8'), { columns: true, bom: true, skip_empty_lines: true }) as Record<string, string>[] : [];
}

// Join the FOI available-pool snapshots against the LATEST register on the
// cleaned key, in a single pass over the register. For each snapshot we learn:
// how much of the pool has been drawn down (allocated), how the still-absent
// remainder decomposes by current status, and how many of the now-allocated
// carry an original-start-date that predates the snapshot's vintage.
export function buildDepletion(): CrossDataset {
  return time('cross-dataset:depletion', buildDepletionImpl);
}

function buildDepletionImpl(): CrossDataset {
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

// --- Probe 1: available x record-of overlap matrix -------------------------
//
// Rows are the FOI available-pool snapshots; columns are every register
// vintage we hold - the open-data publications AND the FOI register-snapshots.
// A cell is the share of that pool's cleaned keys PRESENT in that register
// (intersection over pool size). Presence means the key carries any row in the
// register (Allocated, Reserved or still Available), not that it is allocated.

export interface OverlapPool { entry: string; vintage: string; size: number }
// `partial` flags a register archived as published-but-incomplete (an open-data
// intendedCoverage.complete === false, or an FOI snapshot only partly
// recovered): its column cannot overlap much by construction, so it is marked
// rather than read as low take-up.
export interface OverlapRegister { key: string; vintage: string; kind: 'open-data' | 'foi'; size: number; partial: boolean }
// present[poolIndex][registerIndex] = |pool ∩ register|, a count of distinct
// cleaned keys in common. Pools index the rows, registers the columns.
export interface OverlapMatrix { pools: OverlapPool[]; registers: OverlapRegister[]; present: number[][] }

// The cleaned-key set of a single normalised register file (open-data
// normalised.csv, or one FOI normalised--*.csv sheet). Empty callsigns and
// columns without a `callsign` field (e.g. forbidden-suffix sheets) contribute
// nothing, so mixed-sheet entries fold to their callsign union naturally.
function registerKeys(file: string): Set<string> {
  const keys = new Set<string>();
  for (const r of readCsv(file)) {
    const c = r['callsign'];
    if (c !== undefined && c !== '') keys.add(cleanedCallsign(c));
  }
  return keys;
}

// The available-pool snapshots as small cleaned-key sets (the matrix rows).
// Same selection and union rule as buildDepletion, sorted by vintage.
function loadAvailablePools(foiDir: string): { entry: string; vintage: string; keys: Set<string> }[] {
  const pools: { entry: string; vintage: string; keys: Set<string> }[] = [];
  for (const entry of listFoiEntryKeys(foiDir)) {
    const meta = readFoiEntryMeta(foiDir, entry);
    if (!(meta.datasetClasses ?? []).includes('available-pool')) continue;
    const keys = new Set<string>();
    for (const name of fs.readdirSync(path.join(foiDir, entry)).filter(n => /^normalised--.*\.csv$/.test(n)).sort()) {
      for (const c of registerKeys(path.join(foiDir, entry, name))) keys.add(c);
    }
    if (keys.size === 0) continue;
    pools.push({ entry, vintage: meta.dataVintage ?? '—', keys });
  }
  pools.sort((a, b) => a.vintage.localeCompare(b.vintage) || a.entry.localeCompare(b.entry));
  return pools;
}

// One register snapshot: its display key, vintage, provenance, and a lazy
// loader so we materialise its (large) cleaned-key set only when its column is
// being computed, then let it fall out of scope before the next.
interface RegisterSource { key: string; vintage: string; kind: 'open-data' | 'foi'; partial: boolean; load: () => Set<string> }

// Build the overlap matrix. Register sets are loaded ONE AT A TIME - an
// open-data normalised.csv is ~150k rows, so we compute a whole column against
// the (small) pool sets, record the counts, and discard the register set before
// moving on, never holding more than one register set at once. A register that
// yields no callsign union (e.g. an FOI register-snapshot whose sheets are
// unrecovered) is omitted rather than shown as a misleading all-zero column.
export function buildOverlapMatrix(): OverlapMatrix {
  return time('cross-dataset:overlap-matrix', buildOverlapMatrixImpl);
}

function buildOverlapMatrixImpl(): OverlapMatrix {
  const foiDir = path.join(CONSTANTS.DIRS.archive, 'foi');
  const pools = loadAvailablePools(foiDir);

  const sources: RegisterSource[] = [];
  for (const key of listArchiveKeys()) {
    const dir = path.join(CONSTANTS.DIRS.archive, key);
    let partial = false;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) as { intendedCoverage?: { complete?: boolean } };
      partial = meta.intendedCoverage?.complete === false;
    } catch { /* absent/unreadable meta: treat as complete, the file itself is the evidence */ }
    const file = path.join(dir, 'normalised.csv');
    sources.push({ key, vintage: key, kind: 'open-data', partial, load: () => registerKeys(file) });
  }
  for (const entry of listFoiEntryKeys(foiDir)) {
    const meta = readFoiEntryMeta(foiDir, entry);
    if (!(meta.datasetClasses ?? []).includes('register-snapshot')) continue;
    sources.push({
      key: entry,
      vintage: meta.dataVintage ?? '—',
      kind: 'foi',
      partial: meta.datasetRecovery === 'partial' || meta.datasetRecovery === 'unrecovered',
      load: () => {
        const keys = new Set<string>();
        for (const name of fs.readdirSync(path.join(foiDir, entry)).filter(n => /^normalised--.*\.csv$/.test(n)).sort()) {
          for (const c of registerKeys(path.join(foiDir, entry, name))) keys.add(c);
        }
        return keys;
      },
    });
  }
  sources.sort((a, b) => a.vintage.localeCompare(b.vintage) || a.key.localeCompare(b.key));

  const registers: OverlapRegister[] = [];
  const columns: number[][] = []; // per surviving register, a count per pool
  for (const src of sources) {
    const regSet = src.load();
    if (regSet.size === 0) continue;
    columns.push(pools.map((p) => {
      let n = 0;
      for (const c of p.keys) if (regSet.has(c)) n += 1;
      return n;
    }));
    registers.push({ key: src.key, vintage: src.vintage, kind: src.kind, size: regSet.size, partial: src.partial });
    // regSet goes out of scope here - only its counts survive.
  }

  const present = pools.map((_, pi) => columns.map(col => col[pi]));
  return { pools: pools.map(p => ({ entry: p.entry, vintage: p.vintage, size: p.keys.size })), registers, present };
}

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`;
}

function num(n: number): string {
  return n.toLocaleString('en-GB');
}

function renderOverlapMatrix(m: OverlapMatrix): string[] {
  const out: string[] = [];
  out.push('## Available × record-of overlap matrix');
  out.push('');
  out.push('Each FOI available-pool snapshot (row, by vintage) against every');
  out.push('register snapshot we hold (column, by vintage): the share of that');
  out.push('pool\'s cleaned keys **present** in that register — intersection over');
  out.push('pool size. "Record-of" registers are the open-data publications and');
  out.push('the FOI register-snapshots (the union of their `callsign` columns).');
  out.push('Presence means the key carries any row in that register (Allocated,');
  out.push('Reserved or still Available), not that it is allocated.');
  out.push('');
  out.push('Columns run oldest→newest left to right, and every register vintage');
  out.push('here falls at or after every pool vintage (the pools are 2013–2016;');
  out.push('the earliest register is 2016-09), so the row reads as an **age');
  out.push('gradient**: overlap climbs rightward as each pool is drawn down /');
  out.push('taken up into successively later registers. Declared, not verified;');
  out.push('`cleaned` is a join key, so a cell counts distinct keys in common,');
  out.push('never distinct stations, and absence is not evidence.');
  const anyPartial = m.registers.some(r => r.partial);
  if (anyPartial) {
    out.push('');
    out.push('Columns marked ⚠ are **partial publications** (archived as published');
    out.push('but incomplete): a register holding a few thousand rows cannot');
    out.push('overlap much of any pool, so those cells collapse to near-zero by');
    out.push('construction and interrupt the gradient — read the trend across the');
    out.push('complete columns.');
  }
  out.push('');
  out.push('Register snapshots (columns), by vintage:');
  out.push('');
  for (const r of m.registers) {
    out.push(`- \`${r.vintage}\`${r.partial ? ' ⚠' : ''} — ${r.kind === 'foi' ? 'FOI' : 'open-data'} \`${r.key}\` (${num(r.size)} keys${r.partial ? ', partial publication' : ''})`);
  }
  out.push('');
  const header = ['available-pool snapshot', 'vintage', 'pool', ...m.registers.map(r => r.partial ? `${r.vintage} ⚠` : r.vintage)];
  out.push(`| ${header.join(' | ')} |`);
  out.push(`|---|---|---:|${m.registers.map(() => '---:').join('|')}|`);
  m.pools.forEach((p, pi) => {
    const cells = m.registers.map((_, ri) => pct(m.present[pi][ri], p.size));
    out.push(`| \`${p.entry}\` | ${p.vintage} | ${num(p.size)} | ${cells.join(' | ')} |`);
  });
  out.push('');
  return out;
}

export function renderCrossDatasetInvariants(d: CrossDataset, overlap?: OverlapMatrix): string {
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

  if (overlap !== undefined) out.push(...renderOverlapMatrix(overlap));

  return out.join('\n');
}

export const CROSS_DATASET_INVARIANTS_PATH = 'reports/cross-dataset-invariants.md';

export function writeCrossDatasetInvariants(): { path: string; changed: boolean } {
  const markdown = renderCrossDatasetInvariants(buildDepletion(), buildOverlapMatrix());
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
  // Self-guarded: prints the profiling breakdown to stderr only under PERF.
  perfReport();
}
