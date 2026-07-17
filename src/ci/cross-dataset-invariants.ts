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
 * is un-computable from current holdings and is committed as a DOCUMENTED
 * RESIDUAL: it needs a register snapshot of the same vintage as an available
 * list, and none exists (available lists are 2013-2016; the earliest register
 * snapshot is 2016-09, and no register vintage coincides with any pool
 * vintage). Rather than force it against a mismatched vintage, the section
 * commits the precise gap that blocks it (each pool's nearest register and how
 * far after it falls) and a self-check guards the block, so the probe unblocks
 * the moment a matched-vintage snapshot is ever added. See the issue.
 *
 * FOLD, not re-parse (issue #361): the per-vintage entity sets this report joins
 * are computed by a build-time DuckDB fold over the normalised register/pool
 * projections rather than by re-parsing every CSV in Node. DuckDB derives the
 * `cleaned` join key in SQL (the identical uppercase-and-strip rule), intersects
 * each pool against the ~160k-row registers in one pass, and resolves the latest
 * register's last-writer-wins status map deterministically. The fold replaces
 * the earlier hand-rolled join; its output is asserted byte-identical to the
 * committed golden (cross-dataset-invariants.test.ts) — that byte-identity is
 * the legacy-retirement gate. This is the first report folded from the claim
 * data via DuckDB; report-fold.ts is the shared scaffold others follow.
 *
 * `cleaned` is a JOIN KEY, not an identity (uppercased, stripped outside
 * A-Z/0-9/`/`); collisions are expected and deliberate, so counts are of
 * distinct cleaned keys, never asserted as distinct stations. Every figure is
 * DECLARED-not-verified: a reconciliation candidate, never a verdict.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CONSTANTS } from '../shared/utils.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import { derivedEntryFile, derivedEntryFileExists } from '../shared/derived-entries.ts';
import { listFoiEntryKeys, readFoiEntryMeta } from '../shared/foi-archive.ts';
import { foldQuery, csvFileList, cleanedKeyExpr } from '../v2/report-fold.ts';
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

// --- Source enumeration ----------------------------------------------------
//
// The fold reads the normalised projections the register-snapshot / available-
// pool entries already carry; enumeration (which files, which vintage, whether
// a publication is partial) stays in TypeScript because it is cheap metadata,
// and keeping it here preserves the exact selection and ordering the committed
// golden was built from.

// One FOI available-pool snapshot: its callsign-bearing normalised sheets.
interface PoolSource { entry: string; vintage: string; files: string[] }
// One "record-of" register: an open-data publication (a single normalised.csv)
// or an FOI register-snapshot (its normalised sheets), with the partial-coverage
// flag the matrix marks rather than reads as low take-up.
interface RegisterSource { key: string; vintage: string; kind: 'open-data' | 'foi'; partial: boolean; files: string[] }

// A normalised sheet contributes callsign keys only if it actually carries a
// `callsign` column; a forbidden-suffix sheet riding inside a register entry
// (suffix rows, no callsigns) contributes nothing, exactly as the prior per-row
// join skipped a missing `callsign` cell. Checking the header keeps such sheets
// out of the fold's read list rather than feeding read_csv a column it lacks.
function hasCallsignColumn(file: string): boolean {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(8192);
    const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const header = buffer.toString('utf8', 0, read).split(/\r?\n/)[0].replace(/^﻿/, '');
    return header.split(',').map(cell => cell.trim()).includes('callsign');
  } finally {
    fs.closeSync(fd);
  }
}

function normalisedSheets(dir: string): string[] {
  return fs.readdirSync(dir)
    .filter(name => /^normalised--.*\.csv$/.test(name))
    .sort()
    .map(name => path.join(dir, name))
    .filter(hasCallsignColumn);
}

// The available-pool snapshots (the matrix rows / the depletion rows), sorted by
// vintage then entry so the age gradient reads top-to-bottom.
function enumeratePools(foiDir: string): PoolSource[] {
  const pools: PoolSource[] = [];
  for (const entry of listFoiEntryKeys(foiDir)) {
    const meta = readFoiEntryMeta(foiDir, entry);
    if (!(meta.datasetClasses ?? []).includes('available-pool')) continue;
    const files = normalisedSheets(path.join(foiDir, entry));
    if (files.length === 0) continue;
    pools.push({ entry, vintage: meta.dataVintage ?? '—', files });
  }
  pools.sort((a, b) => a.vintage.localeCompare(b.vintage) || a.entry.localeCompare(b.entry));
  return pools;
}

// Every register vintage we hold (the matrix columns): the open-data
// publications keyed by date, plus the FOI register-snapshots. Sorted by vintage
// then key so columns run oldest→newest. A register whose sheets carry no
// callsign union is dropped downstream once the fold reports its size as zero,
// never shown as a misleading all-zero column.
function enumerateRegisters(foiDir: string): RegisterSource[] {
  const registers: RegisterSource[] = [];
  for (const key of listArchiveKeys()) {
    const dir = path.join(CONSTANTS.DIRS.archive, key);
    let partial = false;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) as { intendedCoverage?: { complete?: boolean } };
      partial = meta.intendedCoverage?.complete === false;
    } catch { /* absent/unreadable meta: treat as complete, the file itself is the evidence */ }
    // The register content is a derived file, so it resolves through the
    // archive/projection switch; meta.json above stays an archive read.
    const hasFile = derivedEntryFileExists(key, 'normalised.csv');
    const file = hasFile ? derivedEntryFile(key, 'normalised.csv') : undefined;
    registers.push({ key, vintage: key, kind: 'open-data', partial, files: file !== undefined && hasCallsignColumn(file) ? [file] : [] });
  }
  for (const entry of listFoiEntryKeys(foiDir)) {
    const meta = readFoiEntryMeta(foiDir, entry);
    if (!(meta.datasetClasses ?? []).includes('register-snapshot')) continue;
    registers.push({
      key: entry,
      vintage: meta.dataVintage ?? '—',
      kind: 'foi',
      partial: meta.datasetRecovery === 'partial' || meta.datasetRecovery === 'unrecovered',
      files: normalisedSheets(path.join(foiDir, entry)),
    });
  }
  registers.sort((a, b) => a.vintage.localeCompare(b.vintage) || a.key.localeCompare(b.key));
  return registers;
}

// The newest register (the depletion join's "latest register"): the last
// open-data key by lexicographic date order, exactly as the prior join chose it.
function latestRegisterKey(): string | undefined {
  return listArchiveKeys().sort().at(-1);
}

// A read_csv branch tagging every callsign key of a source's files with an index
// column, so one query can fold many sources at once. Empty raw callsigns are
// skipped (the prior join skipped `callsign === ''`); union_by_name lets a
// multi-sheet register fold to its callsign union regardless of the other
// columns each sheet carries.
function readBranch(files: readonly string[], indexColumn: string, index: number): string {
  return `SELECT ${index} AS ${indexColumn}, ${cleanedKeyExpr()} AS ck `
    + `FROM read_csv(${csvFileList(files)}, header=true, all_varchar=true, union_by_name=true) `
    + `WHERE callsign IS NOT NULL AND callsign <> ''`;
}

function unionBranches(sources: { files: string[] }[], indexColumn: string): string {
  return sources
    .map((source, index) => ({ source, index }))
    .filter(({ source }) => source.files.length > 0)
    .map(({ source, index }) => readBranch(source.files, indexColumn, index))
    .join('\nUNION ALL\n');
}

// Join the FOI available-pool snapshots against the LATEST register on the
// cleaned key. For each snapshot we learn: how much of the pool has been drawn
// down (allocated), how the still-absent remainder decomposes by current status,
// and how many of the now-allocated carry an original-start-date that predates
// the snapshot's vintage. The whole join is a single DuckDB fold.
export function buildDepletion(): CrossDataset {
  return time('cross-dataset:depletion', buildDepletionImpl);
}

// One folded depletion row as DuckDB returns it (allocatedTotal repeats the
// register-level Allocated count on every row; the fold carries it rather than
// making a second round-trip).
interface DepletionFoldRow {
  pidx: number;
  allocatedTotal: number;
  available: number;
  nowAllocated: number;
  nowReserved: number;
  stillAvailable: number;
  absentFromRegister: number;
  allocatedWithDate: number;
  issuedBeforeVintage: number;
}

function buildDepletionImpl(): CrossDataset {
  const register = latestRegisterKey();
  if (register === undefined) return { register: '', allocatedTotal: 0, rows: [] };
  const foiDir = path.join(CONSTANTS.DIRS.archive, 'foi');
  const pools = enumeratePools(foiDir);
  if (pools.length === 0) return { register, allocatedTotal: 0, rows: [] };

  // Derived-file read (archive/projection switched), forward-slashed for the
  // DuckDB read_csv literal it is interpolated into.
  const latestFile = derivedEntryFile(register, 'normalised.csv').replace(/\\/g, '/');
  const key = cleanedKeyExpr();
  const poolBranches = unionBranches(pools, 'pidx');
  const vintageValues = pools.map((pool, index) => `(${index}, '${pool.vintage}')`).join(', ');

  // SET threads TO 1: row_number() must reflect FILE ORDER so arg_max(status,rn)
  // reproduces the prior map's last-writer-wins on a cleaned-key collision (the
  // register lists e.g. "G6 FMU" and "G6FMU", which share a cleaned key with
  // differing status — the later row won). status is resolved over ALL rows; the
  // original-start-date over the Allocated rows only, matching the two separate
  // maps the join built. allocatedTotal counts Allocated ROWS, not distinct keys.
  const sql = `SET threads TO 1;
WITH reg AS (
  SELECT ${key} AS ck, status, substr(licence_version_original_start_date, 1, 10) AS d, row_number() OVER () AS rn
  FROM read_csv('${latestFile}', header=true, all_varchar=true)
  WHERE callsign IS NOT NULL AND callsign <> ''
),
status_map AS (SELECT ck, arg_max(status, rn) AS status FROM reg GROUP BY ck),
date_map AS (SELECT ck, arg_max(d, rn) AS d FROM reg WHERE status = 'Allocated' AND d <> '' GROUP BY ck),
pool_keys AS (SELECT DISTINCT pidx, ck FROM (${poolBranches})),
pool_vintage(pidx, vintage) AS (VALUES ${vintageValues}),
allocated AS (SELECT count(*) AS total FROM read_csv('${latestFile}', header=true, all_varchar=true) WHERE status = 'Allocated')
SELECT
  p.pidx AS pidx,
  (SELECT total FROM allocated) AS allocatedTotal,
  count(*) AS available,
  count(*) FILTER (WHERE sm.status = 'Allocated') AS nowAllocated,
  count(*) FILTER (WHERE sm.status = 'Reserved') AS nowReserved,
  count(*) FILTER (WHERE sm.status = 'Available') AS stillAvailable,
  count(*) FILTER (WHERE sm.status IS NULL OR sm.status NOT IN ('Allocated', 'Reserved', 'Available')) AS absentFromRegister,
  count(*) FILTER (WHERE sm.status = 'Allocated' AND dm.d IS NOT NULL) AS allocatedWithDate,
  count(*) FILTER (WHERE sm.status = 'Allocated' AND dm.d IS NOT NULL AND pv.vintage <> '—' AND dm.d < pv.vintage) AS issuedBeforeVintage
FROM pool_keys p
JOIN pool_vintage pv ON pv.pidx = p.pidx
LEFT JOIN status_map sm ON sm.ck = p.ck
LEFT JOIN date_map dm ON dm.ck = p.ck
GROUP BY p.pidx
ORDER BY p.pidx`;

  const folded = foldQuery<DepletionFoldRow>(sql);
  const byPidx = new Map(folded.map(row => [row.pidx, row]));
  const allocatedTotal = folded[0]?.allocatedTotal ?? 0;
  const empty: Omit<DepletionFoldRow, 'pidx' | 'allocatedTotal'> = { available: 0, nowAllocated: 0, nowReserved: 0, stillAvailable: 0, absentFromRegister: 0, allocatedWithDate: 0, issuedBeforeVintage: 0 };
  const rows: DepletionRow[] = pools.map((pool, index) => {
    // A pool present in enumeration always yields a fold row (its own keys are a
    // non-empty group), so the fallback is defensive only.
    const f = byPidx.get(index) ?? empty;
    return {
      entry: pool.entry, vintage: pool.vintage, available: f.available, nowAllocated: f.nowAllocated,
      stillAbsent: f.available - f.nowAllocated,
      nowReserved: f.nowReserved, stillAvailable: f.stillAvailable, absentFromRegister: f.absentFromRegister,
      allocatedWithDate: f.allocatedWithDate, issuedBeforeVintage: f.issuedBeforeVintage,
    };
  });
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

// Build the overlap matrix as a single DuckDB fold. Each register's distinct
// cleaned-key set is derived once (union_by_name folds a multi-sheet FOI
// snapshot to its callsign union), its size reported, and its intersection with
// every pool counted in the same pass — the ~14x-cheaper replacement for
// loading each ~150k-row register into a JS Set one at a time. A register that
// yields no callsign union is omitted (size zero), not shown as an all-zero
// column.
export function buildOverlapMatrix(): OverlapMatrix {
  return time('cross-dataset:overlap-matrix', buildOverlapMatrixImpl);
}

// One folded overlap row. Sentinels keep a single query self-describing: a
// pidx = -1 row carries a register's size; a ridx = -1 row carries a pool's
// size; a row with both indexes present is a (pool, register) intersection
// count. One register scan feeds all three.
interface OverlapFoldRow { pidx: number; ridx: number; n: number }

function buildOverlapMatrixImpl(): OverlapMatrix {
  const foiDir = path.join(CONSTANTS.DIRS.archive, 'foi');
  const pools = enumeratePools(foiDir);
  const registers = enumerateRegisters(foiDir);
  if (pools.length === 0 || registers.length === 0) {
    return { pools: pools.map(p => ({ entry: p.entry, vintage: p.vintage, size: 0 })), registers: [], present: pools.map(() => []) };
  }

  const poolBranches = unionBranches(pools, 'pidx');
  const registerBranches = unionBranches(registers, 'ridx');
  const sql = `WITH register_keys AS (SELECT DISTINCT ridx, ck FROM (${registerBranches})),
pool_keys AS (SELECT DISTINCT pidx, ck FROM (${poolBranches}))
SELECT CAST(-1 AS BIGINT) AS pidx, ridx, count(*) AS n FROM register_keys GROUP BY ridx
UNION ALL
SELECT pidx, CAST(-1 AS BIGINT) AS ridx, count(*) AS n FROM pool_keys GROUP BY pidx
UNION ALL
SELECT pool_keys.pidx AS pidx, register_keys.ridx AS ridx, count(*) AS n
  FROM pool_keys JOIN register_keys ON register_keys.ck = pool_keys.ck
  GROUP BY pool_keys.pidx, register_keys.ridx
ORDER BY pidx, ridx`;

  const folded = foldQuery<OverlapFoldRow>(sql);
  const registerSizeByRidx = new Map<number, number>();
  const poolSizeByPidx = new Map<number, number>();
  for (const row of folded) {
    if (row.pidx === -1 && row.ridx !== -1) registerSizeByRidx.set(row.ridx, row.n);
    else if (row.ridx === -1 && row.pidx !== -1) poolSizeByPidx.set(row.pidx, row.n);
  }

  // Keep only registers with a non-empty callsign union, preserving order.
  const survivingRidx = registers.map((_, index) => index).filter(index => (registerSizeByRidx.get(index) ?? 0) > 0);
  const outRegisters: OverlapRegister[] = survivingRidx.map((index) => {
    const source = registers[index];
    return { key: source.key, vintage: source.vintage, kind: source.kind, size: registerSizeByRidx.get(index) ?? 0, partial: source.partial };
  });
  const columnOfRidx = new Map(survivingRidx.map((ridx, column) => [ridx, column]));

  const present = pools.map(() => outRegisters.map(() => 0));
  for (const row of folded) {
    if (row.pidx < 0 || row.ridx < 0) continue;
    const column = columnOfRidx.get(row.ridx);
    if (column !== undefined) present[row.pidx][column] = row.n;
  }

  const outPools: OverlapPool[] = pools.map((pool, index) => ({ entry: pool.entry, vintage: pool.vintage, size: poolSizeByPidx.get(index) ?? 0 }));
  return { pools: outPools, registers: outRegisters, present };
}

// --- Probe 3: same-vintage complementarity (documented residual) -----------
//
// The invariant: at a single vintage the separately-published available-
// callsigns list and the register's occupied set (Allocated + Reserved) should
// be COMPLEMENTARY — a callsign is either available for issue or already taken,
// not both — so the available list and the occupied register together account
// for the issuable space, leaving only a small complement (the ~14% #223 set
// out to check). Testing it needs an available list AND a register snapshot of
// the SAME vintage.
//
// We hold no such pairing: the available-pool snapshots are 2013–2016, the
// earliest register snapshot is later, and no register vintage coincides with
// any pool vintage. So the probe is a DOCUMENTED RESIDUAL — un-computable from
// current holdings, never fabricated. What IS computable, and what this section
// commits, is the precise size of the gap that blocks it: for each pool, the
// nearest register snapshot held and how far after the pool it falls. The probe
// unblocks automatically once a register vintage equals a pool vintage (the gap
// reaches zero), a condition a self-check guards.

export interface ComplementarityGap {
  entry: string;
  poolVintage: string;
  nearestRegisterKey: string;
  nearestRegisterVintage: string;
  // Whole days between the pool vintage and the nearest register vintage;
  // undefined when either vintage is unparseable (e.g. the '—' placeholder).
  gapDays: number | undefined;
}
// `matched` is the unblock signal: true once any register snapshot shares a
// pool's vintage, at which point the complementarity check becomes computable
// and this residual must be replaced by the real probe.
export interface Complementarity { pools: ComplementarityGap[]; matched: boolean }

// A vintage as a whole-day UTC ordinal for gap arithmetic. Vintages carry mixed
// precision (YYYY, YYYY-MM, YYYY-MM-DD); a partial vintage is normalised to the
// first day of its period — a documented convention that keeps the gap
// deterministic. An unparseable vintage yields undefined so the gap renders as
// unknown rather than a misleading number.
function vintageToDayOrdinal(vintage: string): number | undefined {
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(vintage);
  if (match === null) return undefined;
  const year = Number(match[1]);
  const month = match[2] === undefined ? 1 : Number(match[2]);
  const day = match[3] === undefined ? 1 : Number(match[3]);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

// Build the same-vintage complementarity residual: pure vintage metadata (no
// DuckDB fold), because the probe is blocked precisely on which vintages we
// hold. For each available-pool snapshot it records the nearest register
// snapshot and the gap, and reports whether any register vintage now matches a
// pool vintage (the unblock signal).
export function buildComplementarity(): Complementarity {
  const foiDir = path.join(CONSTANTS.DIRS.archive, 'foi');
  const pools = enumeratePools(foiDir);
  // Only a register that actually carries callsign rows could serve as a
  // comparison snapshot; an empty-file enumeration entry is not one.
  const registers = enumerateRegisters(foiDir).filter(register => register.files.length > 0);

  const gaps: ComplementarityGap[] = pools.map(pool => {
    const poolOrdinal = vintageToDayOrdinal(pool.vintage);
    // The nearest register by absolute vintage distance, computed generally
    // rather than assuming every register is later — so a future same-or-earlier
    // register would be chosen correctly. registers are pre-sorted by vintage
    // then key, so the first-seen minimum makes ties deterministic.
    let nearest: { register: RegisterSource; gap: number | undefined } | undefined;
    for (const register of registers) {
      const registerOrdinal = vintageToDayOrdinal(register.vintage);
      const gap = poolOrdinal === undefined || registerOrdinal === undefined
        ? undefined
        : Math.abs(registerOrdinal - poolOrdinal);
      if (nearest === undefined) { nearest = { register, gap }; continue; }
      if (gap !== undefined && (nearest.gap === undefined || gap < nearest.gap)) nearest = { register, gap };
    }
    return {
      entry: pool.entry,
      poolVintage: pool.vintage,
      nearestRegisterKey: nearest?.register.key ?? '',
      nearestRegisterVintage: nearest?.register.vintage ?? '—',
      gapDays: nearest?.gap,
    };
  });

  const poolVintages = new Set(pools.map(pool => pool.vintage));
  const matched = registers.some(register => poolVintages.has(register.vintage));
  return { pools: gaps, matched };
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

function renderComplementarity(c: Complementarity): string[] {
  const out: string[] = [];
  out.push('## Same-vintage complementarity (documented residual)');
  out.push('');
  out.push('The invariant: at a single vintage the separately-published');
  out.push('available-callsigns list and the register\'s occupied set (Allocated');
  out.push('plus Reserved) should be **complementary** — a callsign is either');
  out.push('available for issue or already taken, not both — so the available list');
  out.push('and the occupied register together account for the issuable space,');
  out.push('leaving only a small complement (the ~14% #223 set out to check).');
  out.push('');
  out.push('This probe stays a **documented residual**: testing complementarity');
  out.push('needs an available list AND a register snapshot of the *same* vintage,');
  out.push('and we hold no such pairing. The available-pool snapshots are');
  out.push('2013–2016; the earliest register snapshot we hold is later, and no');
  out.push('register vintage coincides with any pool vintage. Rather than force it');
  out.push('against a mismatched vintage — which the overlap matrix above already');
  out.push('covers as a cross-vintage presence gradient — the gap that blocks it');
  out.push('is committed here precisely: for each pool, the nearest register');
  out.push('snapshot held and how far after the pool it falls.');
  out.push('');
  out.push('The probe **unblocks automatically** if a register snapshot of a');
  out.push('pool\'s vintage is ever added (the gap reaches zero); a self-check');
  out.push('guards that condition, so the residual cannot be silently assumed once');
  out.push('holdings change. Partial vintages are normalised to the first day of');
  out.push('their period for the day count.');
  out.push('');
  out.push('| available-pool snapshot | vintage | nearest register snapshot | register vintage | gap (days) |');
  out.push('|---|---|---|---|---:|');
  for (const p of c.pools) {
    out.push(`| \`${p.entry}\` | ${p.poolVintage} | \`${p.nearestRegisterKey}\` | ${p.nearestRegisterVintage} | ${p.gapDays === undefined ? '—' : num(p.gapDays)} |`);
  }
  out.push('');
  out.push(c.matched
    ? '**A register snapshot now shares a pool vintage** — the complementarity '
      + 'check is computable, and this residual must be replaced by the real probe.'
    : 'No register snapshot shares a pool vintage, so the complementarity check '
      + 'remains un-computable from current holdings — a documented residual, not '
      + 'an omission.');
  out.push('');
  return out;
}

export function renderCrossDatasetInvariants(d: CrossDataset, overlap?: OverlapMatrix, complementarity?: Complementarity): string {
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
  if (complementarity !== undefined) out.push(...renderComplementarity(complementarity));

  return out.join('\n');
}

export const CROSS_DATASET_INVARIANTS_PATH = 'reports/cross-dataset-invariants.md';

export function writeCrossDatasetInvariants(): { path: string; changed: boolean } {
  const markdown = renderCrossDatasetInvariants(buildDepletion(), buildOverlapMatrix(), buildComplementarity());
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
  // Self-guarded: prints the profiling breakdown to stderr only under PERF,
  // and writes the JSON per-run report when PERF_JSON names a path.
  perfReport({ entrypoint: 'cross-dataset-invariants' });
}
