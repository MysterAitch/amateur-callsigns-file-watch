/**
 * Parallel gzip for the deploy artefact packaging (issue #546). Level-9 gzip is
 * the miss-path tent-pole of the database build - measured ~65% of
 * build-sqlite.ts's own time, with the single combined-DB compression alone at
 * ~102 s single-threaded (#533). The compression is embarrassingly parallel, so
 * this module spreads it across the runner's cores two complementary ways:
 *
 *  - ONE LARGE STREAM (the combined database, the union CSV, the ledger twin):
 *    Node's zlib is single-stream per buffer and cannot split one input across
 *    cores, so a single big compression stays single-threaded under zlib. `pigz`
 *    genuinely divides one gzip stream across every core, so the large helpers
 *    prefer it when the runner has it (ubuntu-latest ships it) and fall back to a
 *    STREAMED zlib gzip - never holding the whole multi-hundred-MB file in memory.
 *
 *  - MANY INDEPENDENT FILES (the ~45 per-dataset databases): data-parallel
 *    across the libuv threadpool with Node's async zlib and a bounded pool - no
 *    external dependency, and running them concurrently is the win. pigz is
 *    deliberately NOT used per-file here: 45 pigz processes each wanting all
 *    cores would oversubscribe, whereas the threadpool shares the cores cleanly.
 *
 * EQUIVALENCE: changing the gzip tool or level changes the .gz BYTES legitimately
 * (any level/tool decompresses to identical bytes), so byte-identity of the .gz
 * is the wrong gate. The gate is decompressed-stream equality - the produced .gz
 * must gunzip to exactly the source bytes - asserted in gzip.test.ts and by the
 * build oracles that gunzip and compare contents.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as zlib from 'zlib';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const gzipAsync = promisify(zlib.gzip);

// Which gzip implementation a large-stream compression uses. `pigz` splits one
// stream across all cores; `zlib` is Node's built-in, single-stream per input.
export type GzipBackend = 'pigz' | 'zlib';

// Detect pigz once and remember the answer: the probe spawns a process, so it is
// resolved lazily on first use and cached for the rest of the build.
let pigzProbe: boolean | undefined;

// Whether `pigz` is on PATH. Kept synchronous and memoised so callers can branch
// on it without threading a promise through the build. The probe runs pigz with
// its version flag and treats a clean exit as present; anything else (ENOENT, a
// non-zero exit) means absent, so a runner without pigz transparently falls back.
export function pigzAvailable(): boolean {
  if (pigzProbe === undefined) {
    try {
      // pigz prints its version and exits 0 when present; status !== 0 or a
      // spawn error (ENOENT) both read as absent, so a runner without pigz
      // transparently falls back to zlib.
      const result = spawnSync('pigz', ['--version'], { stdio: 'ignore' });
      pigzProbe = result.error === undefined && result.status === 0;
    } catch {
      pigzProbe = false;
    }
  }
  return pigzProbe;
}

// Reset the memoised probe. Exposed for tests that need to exercise both the
// present and absent branches; a build never calls it.
export function resetPigzProbeForTests(): void {
  pigzProbe = undefined;
}

// The backend a large-stream compression should use unless a caller forces one:
// pigz when available (the multicore win on a single big stream), else zlib.
// Announces the choice once to stderr so a build log makes it visible which path
// a runner took (pigz confirmed present vs the zlib fallback) - never to stdout,
// so it cannot pollute a build's output.
let announcedBackend = false;
function defaultLargeBackend(): GzipBackend {
  const backend: GzipBackend = pigzAvailable() ? 'pigz' : 'zlib';
  if (!announcedBackend) {
    announcedBackend = true;
    process.stderr.write(backend === 'pigz'
      ? 'gzip: using pigz (parallel, all cores) for large streams\n'
      : 'gzip: pigz not found - using single-stream zlib for large streams\n');
  }
  return backend;
}

// Compress `inputPath` to `outPath`. For a single LARGE file (the combined
// database, the ledger twin) - pigz across all cores when available, else a
// streamed zlib gzip so even the fallback never buffers the whole file. `backend`
// forces a choice (tests exercise both); omitted, it auto-selects.
export async function gzipFileToFile(inputPath: string, outPath: string, level: number, backend?: GzipBackend): Promise<void> {
  const chosen = backend ?? defaultLargeBackend();
  if (chosen === 'pigz') {
    await pigzFileToFile(inputPath, outPath, level);
    return;
  }
  await pipeline(fs.createReadStream(inputPath), zlib.createGzip({ level }), fs.createWriteStream(outPath));
}

// Compress an in-memory buffer to `outPath`. For a single large in-memory source
// (the union CSV, assembled as a Buffer because it exceeds V8's max string
// length). pigz reads the buffer on stdin; the zlib fallback gzips it directly.
export async function gzipBufferToFile(source: Buffer, outPath: string, level: number, backend?: GzipBackend): Promise<void> {
  const chosen = backend ?? defaultLargeBackend();
  if (chosen === 'pigz') {
    await pigzBufferToFile(source, outPath, level);
    return;
  }
  fs.writeFileSync(outPath, await gzipAsync(source, { level }));
}

export interface GzipJob {
  inputPath: string;
  outPath: string;
}

// Compress MANY independent files concurrently - the ~45 per-dataset databases.
// Data-parallel across the libuv threadpool with Node's async zlib, bounded so
// at most `concurrency` files are read+compressed at once (peak memory stays
// ~concurrency files, not all of them). No external dependency: the win here is
// running the independent compressions at the same time, not splitting any one.
export async function gzipManyFilesToFiles(
  jobs: readonly GzipJob[],
  level: number,
  concurrency: number = os.availableParallelism(),
): Promise<void> {
  const limit = Math.max(1, Math.min(concurrency, jobs.length));
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= jobs.length) return;
      const job = jobs[index];
      await pipeline(fs.createReadStream(job.inputPath), zlib.createGzip({ level }), fs.createWriteStream(job.outPath));
    }
  };
  await Promise.all(Array.from({ length: limit }, () => worker()));
}

// Spawn pigz reading a file directly (no giant JS buffer): `pigz -<level> -c
// input` writes the gzip stream to stdout, which we pipe to `outPath`. Rejects on
// a spawn error or a non-zero exit so a compression failure is never silent.
async function pigzFileToFile(inputPath: string, outPath: string, level: number): Promise<void> {
  const child = spawn('pigz', [`-${level}`, '-c', inputPath], { stdio: ['ignore', 'pipe', 'inherit'] });
  const out = fs.createWriteStream(outPath);
  child.stdout.pipe(out);
  await Promise.all([awaitClean(child), once(out, 'finish')]);
}

// Spawn pigz reading the source on stdin: `pigz -<level> -c` writes the gzip
// stream to stdout, piped to `outPath`. The write to stdin and the read from
// stdout proceed together, so a large buffer drains without deadlock.
async function pigzBufferToFile(source: Buffer, outPath: string, level: number): Promise<void> {
  const child = spawn('pigz', [`-${level}`, '-c'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const out = fs.createWriteStream(outPath);
  child.stdout.pipe(out);
  child.stdin.end(source);
  await Promise.all([awaitClean(child), once(out, 'finish')]);
}

// Resolve when the child exits cleanly; reject on a spawn error (e.g. ENOENT) or
// a non-zero exit code, naming pigz so a failure is diagnosable in the build log.
async function awaitClean(child: ReturnType<typeof spawn>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`pigz exited with code ${code ?? 'null'}`));
    });
  });
}
