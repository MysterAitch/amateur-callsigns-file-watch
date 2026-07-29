/**
 * Wide comparison of candidate ledger intermediate formats, on the REAL corpus
 * (issue #997/#994).
 *
 * WHY REAL DATA. Every format figure quoted so far came from synthetic uniform
 * claims, and this session has repeatedly shown ratios that do not survive a
 * change of scale or shape - the zstd level inversion appears only above ~26 MB,
 * and compression ratios differ several-fold between uniform synthetic lines and
 * real varied text. The real corpus is 55.4M claims across 71 sources with a
 * heavily skewed size distribution, so a uniform sample cannot stand in for it.
 *
 * WHAT IT MEASURES, per format: bytes, serialise time, write time, and whether
 * DuckDB can ingest it and how fast. Serialise and ingest are measured
 * separately because they trade against each other - a format that is cheap to
 * write can be dear to parse, and only the total matters.
 *
 * SCOPE. Runs over the N largest sources rather than all 71: they carry the bulk
 * of the corpus (27 of 71 sources are 77.6% of it) and holding the whole corpus
 * in memory is not possible - the production emit is per-source for that reason.
 * So this measures real shape at real per-source scale, not the corpus total.
 * Multiply by source count for a corpus estimate, and say so when quoting it.
 *
 * Usage: node src/ci/ledger-format-bench.ts [sourceCount] [--out <file>]
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { execFileSync } from 'node:child_process';
import { buildLedger } from '../v2/build-ledger.ts';
import { readClaimsJsonlSync } from '../v2/serialise.ts';
import { findDuckdb } from '../v2/build-ledger-db.ts';
import type { Claim } from '../v2/claim.ts';

const NL = String.fromCharCode(10);
const TAB = String.fromCharCode(9);
const COLS = ['layer', 'rawSubject', 'predicate', 'object', 'sourceFile', 'ordinal', 'vintage', 'rule'] as const;
const SHORT: Record<string, string> = { layer: 'l', rawSubject: 's', predicate: 'p', object: 'o', sourceFile: 'f', ordinal: 'n', vintage: 'v', rule: 'r' };

function argValue(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

// An explicit switch, not dynamic indexing. Indexing a Claim by string and
// coercing with String() would silently emit "[object Object]" for any field
// that is not a primitive - a corruption that no format comparison would notice
// and every downstream read would inherit. Fields are enumerated so a schema
// change breaks the build instead.
function cell(c: Claim, k: typeof COLS[number]): string {
  switch (k) {
    case 'layer': return c.layer;
    case 'rawSubject': return c.rawSubject;
    case 'predicate': return c.predicate;
    case 'object': return c.object;
    case 'sourceFile': return c.provenance.sourceFile;
    case 'ordinal': return String(c.provenance.ordinal);
    case 'vintage': return c.provenance.vintage;
    case 'rule': return c.rule ?? '';
  }
}

// TSV assumes no tab or newline in any value. That is an ASSUMPTION about real
// data, not a property of the format, so it is CHECKED rather than trusted - a
// silent corruption here would be far worse than a slower format.
function tsvUnsafeCount(claims: readonly Claim[]): number {
  let bad = 0;
  for (const c of claims) {
    for (const k of COLS) {
      const v = cell(c, k);
      if (v.includes(TAB) || v.includes(NL)) bad++;
    }
  }
  return bad;
}

const zstd = (buf: Buffer, level: number): Buffer =>
  zlib.zstdCompressSync(buf, { params: { [zlib.constants.ZSTD_c_compressionLevel]: level } });

const csvEsc = (s: string): string => (/[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);

function build(claims: readonly Claim[]): Record<string, () => Buffer> {
  const jsonl = (): Buffer => Buffer.from(claims.map(c => JSON.stringify({
    layer: c.layer, rawSubject: c.rawSubject, predicate: c.predicate, object: c.object,
    sourceFile: c.provenance.sourceFile, ordinal: c.provenance.ordinal, vintage: c.provenance.vintage, rule: c.rule,
  })).join(NL) + NL, 'utf8');
  const shortJsonl = (): Buffer => Buffer.from(claims.map(c => {
    const o: Record<string, unknown> = {};
    for (const k of COLS) o[SHORT[k]] = k === 'ordinal' ? c.provenance.ordinal : cell(c, k);
    return JSON.stringify(o);
  }).join(NL) + NL, 'utf8');
  const csv = (): Buffer => Buffer.from(COLS.join(',') + NL
    + claims.map(c => COLS.map(k => csvEsc(cell(c, k))).join(',')).join(NL) + NL, 'utf8');
  const tsv = (): Buffer => Buffer.from(COLS.join(TAB) + NL
    + claims.map(c => COLS.map(k => cell(c, k)).join(TAB)).join(NL) + NL, 'utf8');
  return {
    'JSONL (current)': jsonl,
    'JSONL short keys': shortJsonl,
    'CSV': csv,
    'TSV': tsv,
    'JSONL + zstd-1': () => zstd(jsonl(), 1),
    'CSV + zstd-1': () => zstd(csv(), 1),
    'TSV + zstd-1': () => zstd(tsv(), 1),
    'TSV + zstd-9': () => zstd(tsv(), 9),
  };
}

const READER: Record<string, 'json' | 'csv' | 'tsv'> = {
  'JSONL (current)': 'json', 'JSONL short keys': 'json', 'CSV': 'csv', 'TSV': 'tsv',
  'JSONL + zstd-1': 'json', 'CSV + zstd-1': 'csv', 'TSV + zstd-1': 'tsv', 'TSV + zstd-9': 'tsv',
};
const EXT: Record<string, string> = {
  'JSONL (current)': 'jsonl', 'JSONL short keys': 'short.jsonl', 'CSV': 'csv', 'TSV': 'tsv',
  'JSONL + zstd-1': 'jsonl.zst', 'CSV + zstd-1': 'csv.zst', 'TSV + zstd-1': 'tsv.zst', 'TSV + zstd-9': 'tsv9.zst',
};

// Emit the real ledger once, then read back the largest sources' claims.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'fmt-real-'));
console.log('emitting the real ledger (this is the expensive part)...');
const emitStart = Date.now();
buildLedger(scratch, undefined, undefined, undefined, true);
console.log(`ledger emitted in ${((Date.now() - emitStart) / 1000).toFixed(1)}s`);

const ledgerDir = path.join(scratch, 'ledger');
const files = fs.readdirSync(ledgerDir)
  .filter(f => f.endsWith('.jsonl'))
  .map(f => ({ f, size: fs.statSync(path.join(ledgerDir, f)).size }))
  .sort((a, b) => b.size - a.size);

const take = Number(process.argv[2]) || 3;
console.log(`\n${files.length} source ledgers; profiling the ${take} largest\n`);

const duck = findDuckdb();
const rows: Record<string, unknown>[] = [];

for (const { f, size } of files.slice(0, take)) {
  const claims = readClaimsJsonlSync(path.join(ledgerDir, f));
  const unsafe = tsvUnsafeCount(claims);
  console.log(`=== ${f}  ${(size / 1048576).toFixed(1)} MB  ${claims.length.toLocaleString()} claims`
    + `  TSV-unsafe values: ${unsafe}${unsafe > 0 ? '  <-- TSV WOULD CORRUPT' : ''}`);
  console.log('  format'.padEnd(28) + 'MB'.padStart(9) + 'vs JSONL'.padStart(10) + 'ser ms'.padStart(9) + 'write'.padStart(8) + 'duckdb'.padStart(9) + 'total'.padStart(8));

  const builders = build(claims);
  let baseBytes = 0;
  for (const [name, make] of Object.entries(builders)) {
    const t0 = Date.now();
    const buf = make();
    const t1 = Date.now();
    const out = path.join(scratch, 'x.' + EXT[name]);
    fs.writeFileSync(out, buf);
    const t2 = Date.now();
    if (baseBytes === 0) baseBytes = buf.length;

    let readMs: number | null = null;
    if (duck !== null) {
      const p = out.split(String.fromCharCode(92)).join('/');
      const r = READER[name];
      const sql = r === 'json' ? `SELECT count(*) FROM read_json('${p}', format='newline_delimited');`
        : r === 'csv' ? `SELECT count(*) FROM read_csv('${p}');`
          : `SELECT count(*) FROM read_csv('${p}', delim='\\t');`;
      try { const t = Date.now(); execFileSync(duck, ['-c', sql], { stdio: 'pipe' }); readMs = Date.now() - t; }
      catch { readMs = -1; }
    }
    const total = readMs !== null && readMs >= 0 ? String((t1 - t0) + (t2 - t1) + readMs) : '-';
    console.log('  ' + name.padEnd(26) + (buf.length / 1048576).toFixed(1).padStart(9)
      + ((buf.length / baseBytes) * 100).toFixed(0).padStart(9) + '%'
      + String(t1 - t0).padStart(9) + String(t2 - t1).padStart(8)
      + (readMs === null ? 'n/a' : readMs < 0 ? 'FAILED' : String(readMs)).padStart(9)
      + total.padStart(8));
    rows.push({ source: f, format: name, bytes: buf.length, serialiseMs: t1 - t0, writeMs: t2 - t1, readMs, claims: claims.length, tsvUnsafe: unsafe });
    fs.rmSync(out, { force: true });
  }
  console.log('');
}

const out = argValue('--out', '');
if (out !== '') {
  fs.writeFileSync(out, JSON.stringify({ recordedAt: new Date().toISOString(), node: process.version, platform: `${process.platform}-${process.arch}`, rows }, null, 2) + NL);
}
fs.rmSync(scratch, { recursive: true, force: true });
