import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { createHash } from 'node:crypto';
import { gzipFileToFile, gzipBufferToFile, gzipManyFilesToFiles, pigzAvailable, type GzipBackend } from './gzip.ts';

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// The parallel-gzip helper (issue #546) speeds up the deploy artefact packaging
// by spreading level-9 gzip across cores - via pigz on a single big stream, and
// across the threadpool for the many independent per-dataset files. Swapping the
// gzip tool or level changes the .gz BYTES legitimately, so the load-bearing
// property is NOT byte-identity of the .gz - it is DECOMPRESSED-STREAM EQUALITY:
// whatever backend compressed it, the .gz must gunzip to exactly the source
// bytes. These tests are the fast, local backstop for that gate; the tiers and
// compact-ledger oracles gunzip real deploy artefacts and assert their contents.

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

// A source with enough structure and length that gzip actually transforms it
// (so "not equal to source" is a meaningful sanity check) yet stays tiny for a
// unit test. Repetition plus a pseudo-random tail exercises the DEFLATE path.
function makeSource(seed: number): Buffer {
  const parts: string[] = [];
  for (let i = 0; i < 4000; i += 1) parts.push(`row-${(i * 2654435761 + seed) % 100000},callsign-${i % 97},value-${i}\n`);
  return Buffer.from(parts.join(''), 'utf8');
}

// The backends to exercise: always zlib (the dependency-free fallback, present
// everywhere), plus pigz when the runner has it (CI's ubuntu-latest does), so
// both branches of every helper are covered where possible.
const BACKENDS: GzipBackend[] = ['zlib', ...(pigzAvailable() ? (['pigz'] as const) : [])];

let workDir: string;

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gzip-helper-'));
});

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('parallel gzip helper decompresses to exactly the source', { tags: ['unit'] }, () => {
  for (const backend of BACKENDS) {
    it(`GzipFileToFile_When${backend}Backend_ProducesGzThatGunzipsToTheSource`, async () => {
      const source = makeSource(1);
      const inputPath = path.join(workDir, `file-${backend}.bin`);
      const outPath = path.join(workDir, `file-${backend}.bin.gz`);
      fs.writeFileSync(inputPath, source);
      await gzipFileToFile(inputPath, outPath, 9, backend);
      const gz = fs.readFileSync(outPath);
      // A real gzip member (magic 1f 8b) that is not just the source copied.
      expect(gz.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
      expect(gz.equals(source)).toBe(false);
      // The gate: decompressed-stream equality, checked by hash.
      expect(sha256(zlib.gunzipSync(gz))).toBe(sha256(source));
    });

    it(`GzipBufferToFile_When${backend}Backend_ProducesGzThatGunzipsToTheSource`, async () => {
      const source = makeSource(2);
      const outPath = path.join(workDir, `buffer-${backend}.gz`);
      await gzipBufferToFile(source, outPath, 9, backend);
      expect(sha256(zlib.gunzipSync(fs.readFileSync(outPath)))).toBe(sha256(source));
    });
  }

  it('GzipManyFilesToFiles_WhenGivenIndependentFiles_EachGunzipsToItsOwnSource', async () => {
    // The per-dataset case: several independent files compressed concurrently -
    // each output must gunzip to exactly its own input, no crossed wires.
    const jobs = Array.from({ length: 12 }, (_, i) => {
      const source = makeSource(100 + i);
      const inputPath = path.join(workDir, `many-${i}.bin`);
      fs.writeFileSync(inputPath, source);
      return { inputPath, outPath: path.join(workDir, `many-${i}.bin.gz`), source };
    });
    await gzipManyFilesToFiles(jobs.map(j => ({ inputPath: j.inputPath, outPath: j.outPath })), 9);
    for (const job of jobs) {
      expect(sha256(zlib.gunzipSync(fs.readFileSync(job.outPath)))).toBe(sha256(job.source));
    }
  });

  it('GzipManyFilesToFiles_WhenConcurrencyIsOne_StillCompressesEveryFile', async () => {
    // Concurrency is a performance knob, not a correctness one: a serial run
    // (pool of one) must produce exactly the same decompressed content.
    const jobs = Array.from({ length: 5 }, (_, i) => {
      const source = makeSource(500 + i);
      const inputPath = path.join(workDir, `serial-${i}.bin`);
      fs.writeFileSync(inputPath, source);
      return { inputPath, outPath: path.join(workDir, `serial-${i}.bin.gz`), source };
    });
    await gzipManyFilesToFiles(jobs.map(j => ({ inputPath: j.inputPath, outPath: j.outPath })), 9, 1);
    for (const job of jobs) {
      expect(sha256(zlib.gunzipSync(fs.readFileSync(job.outPath)))).toBe(sha256(job.source));
    }
  });

  it('GzipLevel_WhenLowerLevelChosen_ChangesBytesButNotDecompressedContent', async () => {
    // The reason .gz byte-identity is the wrong gate: two levels yield different
    // .gz bytes yet identical decompressed content. This is exactly why the
    // deploy can parallelise/retool the gzip without any content oracle moving.
    const source = makeSource(3);
    const inputPath = path.join(workDir, 'level.bin');
    fs.writeFileSync(inputPath, source);
    const lo = path.join(workDir, 'level-1.gz');
    const hi = path.join(workDir, 'level-9.gz');
    await gzipFileToFile(inputPath, lo, 1, 'zlib');
    await gzipFileToFile(inputPath, hi, 9, 'zlib');
    const loBytes = fs.readFileSync(lo);
    const hiBytes = fs.readFileSync(hi);
    expect(loBytes.equals(hiBytes)).toBe(false);
    expect(sha256(zlib.gunzipSync(loBytes))).toBe(sha256(source));
    expect(sha256(zlib.gunzipSync(hiBytes))).toBe(sha256(source));
  });

  if (pigzAvailable()) {
    it('PigzAndZlib_WhenCompressingTheSameSource_DecompressToIdenticalBytes', async () => {
      // Cross-backend equivalence: pigz and zlib produce different .gz bytes but
      // the SAME decompressed content, so switching to pigz on the deploy path
      // is transparent to every consumer.
      const source = makeSource(4);
      const inputPath = path.join(workDir, 'cross.bin');
      fs.writeFileSync(inputPath, source);
      const viaPigz = path.join(workDir, 'cross-pigz.gz');
      const viaZlib = path.join(workDir, 'cross-zlib.gz');
      await gzipFileToFile(inputPath, viaPigz, 9, 'pigz');
      await gzipFileToFile(inputPath, viaZlib, 9, 'zlib');
      expect(sha256(zlib.gunzipSync(fs.readFileSync(viaPigz)))).toBe(sha256(source));
      expect(sha256(zlib.gunzipSync(fs.readFileSync(viaZlib)))).toBe(sha256(source));
    });
  }
});
