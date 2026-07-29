/**
 * Microbenchmark suite for the pipeline's hot routines (issue #1004).
 *
 * Drives tinybench DIRECTLY rather than through `vitest bench`. Verified on
 * 2026-07-28 against vitest 4.1.10: `vitest bench --outputJson` writes an empty
 * `{"files":[]}` report while printing results to the terminal, and
 * `--reporter=json` errors on a bench run - so the built-in `--compare` baseline
 * path cannot be built on. tinybench is already installed (it is what
 * `vitest bench` runs on), so this adds no dependency and gains a JSON shape we
 * control and can therefore compare across months.
 *
 * WHY MICRO AS WELL AS MACRO. The CI arm matrix (perf-matrix.yml) measures whole
 * job wall-clock, where runner variance of 1.7x has been observed on identical
 * configuration - it can only resolve large effects, and it is the only way to
 * measure process-level levers like the coverage provider or GC flags. These
 * in-process benchmarks carry a margin of error near 1%, so they resolve effects
 * two orders of magnitude smaller. The rule: MEASURE AT THE LOWEST LEVEL THAT
 * CAN ANSWER THE QUESTION, because jitter grows with every layer above it.
 *
 * Usage: node src/ci/bench-suite.ts [--out <file>] [--time <ms per task>]
 */
import * as fs from 'fs';
import * as zlib from 'zlib';
import { Bench } from 'tinybench';
import { serialiseClaimJsonlLine } from '../v2/serialise.ts';
import type { Claim } from '../v2/claim.ts';
import { compareBenchRuns, renderBenchMarkdown, type BenchResult } from './bench-compare.ts';
import { parseJsonObject } from '../shared/json-shape.ts';

function makeClaim(i: number): Claim {
  return {
    layer: 'derived',
    rawSubject: `M7ABC${i}`,
    predicate: 'callsign/status',
    object: 'Issued to a licensee',
    rule: 'parse-attribute',
    provenance: {
      sourceFile: 'archive/open-data/2026-06-23/normalised.csv',
      ordinal: i,
      vintage: '2026-06-23',
    },
  } as Claim;
}

// Enough distinct claims that the engine cannot cache one shape's result; few
// enough that walking the array is not what gets measured.
const CLAIMS = Array.from({ length: 2000 }, (_, i) => makeClaim(i));
const LINES = CLAIMS.map(serialiseClaimJsonlLine);

// Candidate: build the JSON text directly, deferring to JSON.stringify only for
// values that may need escaping. Previously reported as slower; kept so the
// claim stays FALSIFIABLE rather than remembered. Instrumentation is not neutral
// between these two - istanbul instruments user JS statement by statement while
// JSON.stringify is native C++ and receives none - so this must be run WITHOUT
// coverage, the regime production actually uses.
function handRolled(claim: Claim): string {
  let out = '{"layer":' + JSON.stringify(claim.layer)
    + ',"rawSubject":' + JSON.stringify(claim.rawSubject)
    + ',"predicate":' + JSON.stringify(claim.predicate)
    + ',"object":' + JSON.stringify(claim.object)
    + ',"sourceFile":' + JSON.stringify(claim.provenance.sourceFile)
    + ',"ordinal":' + claim.provenance.ordinal
    + ',"vintage":' + JSON.stringify(claim.provenance.vintage);
  if (claim.rule !== undefined) out += ',"rule":' + JSON.stringify(claim.rule);
  return out + '}';
}

const encoder = new TextEncoder();
const scratch = new Uint8Array(1 << 21);

function argValue(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

const bench = new Bench({ time: Number(argValue('--time', '1000')) });

bench
  // Serialisation is ~41-43% of the ledger emit, itself ~45% of golden-master:
  // the single hottest routine in the pipeline.
  .add('serialise: object literal + JSON.stringify (current)', () => {
    for (const claim of CLAIMS) serialiseClaimJsonlLine(claim);
  })
  .add('serialise: hand-rolled concatenation', () => {
    for (const claim of CLAIMS) handRolled(claim);
  })
  // The phase no serialiser choice can reach. UTF-8 encoding is a SEPARATE
  // 14-15% of the emit, and it exists only because a JS string is materialised
  // first; encoding into a reused buffer deletes the phase rather than
  // accelerating it.
  .add('encode: materialise a string, then Buffer.from', () => {
    Buffer.from(LINES.join('\n'), 'utf8');
  })
  .add('encode: encodeInto a reused buffer', () => {
    let offset = 0;
    for (const line of LINES) {
      const { written } = encoder.encodeInto(line, scratch.subarray(offset));
      offset += written + 1;
      if (offset >= scratch.length - 1024) offset = 0;
    }
  });

// DECOMPOSITION. The two arms above are a fair comparison of two PRODUCTION
// STRATEGIES, but they are not a fair comparison of two ENCODING APIs: the
// Buffer.from arm also performs a string join and allocates a fresh ~490 KB
// buffer every iteration, while the encodeInto arm reuses a scratch buffer and
// never joins. Three differences are bundled.
//
// That matters because a platform difference was attributed to the encoding APIs
// (#1026: Windows favoured encodeInto, Linux and macOS favoured Buffer.from). If
// what actually differs by platform is LARGE-BUFFER ALLOCATION or string join,
// the conclusion is about the allocator, not about the API - and the remedy would
// be entirely different.
//
// These arms isolate each component so the effect can be attributed rather than
// assumed. Each does exactly one thing.
const PREJOINED = LINES.join(String.fromCharCode(10));
const PREJOINED_BYTES = Buffer.byteLength(PREJOINED, 'utf8');
bench
  .add('component: join 2000 strings (no encoding)', () => {
    LINES.join(String.fromCharCode(10));
  })
  .add('component: allocate a ~490KB buffer (no encoding)', () => {
    Buffer.allocUnsafe(PREJOINED_BYTES);
  })
  .add('component: Buffer.from a PRE-joined string', () => {
    Buffer.from(PREJOINED, 'utf8');
  })
  .add('component: encodeInto the SAME pre-joined string, reused buffer', () => {
    encoder.encodeInto(PREJOINED, scratch);
  });

// COMPRESSION (#997). The level/codec choice is data-shape dependent and cannot
// be settled once: every new derived tier shifts the ratio of repeated key names
// to distinguishing content, and each new dataset brings a different field
// structure. Ratio is DETERMINISTIC so it needs no repetitions; only the timing
// does, which is what this harness is for.
//
// The choice must stay PINNED rather than auto-selected - byte-determinism is a
// core tenet, and a compressor that picks a level per run would emit different
// bytes from identical inputs. So this benchmark exists to justify changing the
// pin deliberately, not to drive it automatically.
// A LARGER corpus than the serialisation arms use, deliberately. zstd derives its
// compression parameters from the level AND the input size, so the ratio ranking
// is size-dependent: at ~0.4 MB the levels are monotonic (74.0 / 75.0 / 76.0x),
// while at ~44 MB level 1 BEATS level 3 outright. A small sample would therefore
// give a confident and wrong answer to the question #997 actually asks, which is
// about a 12.73 GiB corpus.
//
// This is still far short of corpus scale and cannot settle the absolute ratio -
// that needs the real ledger (see #997). What it can do repeatably is compare
// codecs and track whether the ranking MOVES when Node's zlib bindings change.
const COMPRESSION_CORPUS_LINES = 120_000;
const CORPUS = Buffer.from(
  Array.from({ length: COMPRESSION_CORPUS_LINES }, (_, i) => serialiseClaimJsonlLine(makeClaim(i)))
    .join(String.fromCharCode(10)),
  'utf8',
);
const zstd = (level: number) => (): void => {
  zlib.zstdCompressSync(CORPUS, { params: { [zlib.constants.ZSTD_c_compressionLevel]: level } });
};
bench
  .add('compress: zstd level 1', zstd(1))
  .add('compress: zstd level 3', zstd(3))
  .add('compress: zstd level 9', zstd(9))
  .add('compress: gzip level 1', () => { zlib.gzipSync(CORPUS, { level: 1 }); })
  .add('compress: gzip level 6 (default)', () => { zlib.gzipSync(CORPUS); })
  .add('compress: brotli quality 1', () => {
    zlib.brotliCompressSync(CORPUS, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 1 } });
  });

await bench.run();

// Ratios are deterministic, so they are reported ONCE rather than benchmarked.
// Reporting them alongside the timings keeps the trade visible: the fastest
// codec is not always the smallest, and on this corpus the ranking inverts with
// how self-similar the data is.
const ratios: Record<string, number> = {
  'zstd-1': CORPUS.length / zlib.zstdCompressSync(CORPUS, { params: { [zlib.constants.ZSTD_c_compressionLevel]: 1 } }).length,
  'zstd-3': CORPUS.length / zlib.zstdCompressSync(CORPUS, { params: { [zlib.constants.ZSTD_c_compressionLevel]: 3 } }).length,
  'zstd-9': CORPUS.length / zlib.zstdCompressSync(CORPUS, { params: { [zlib.constants.ZSTD_c_compressionLevel]: 9 } }).length,
  'gzip-1': CORPUS.length / zlib.gzipSync(CORPUS, { level: 1 }).length,
  'gzip-6': CORPUS.length / zlib.gzipSync(CORPUS).length,
  'brotli-1': CORPUS.length / zlib.brotliCompressSync(CORPUS, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 1 } }).length,
};
console.log(`\ncompression ratios over ${(CORPUS.length / 1048576).toFixed(1)} MB of ledger-shaped JSONL (deterministic, not benchmarked):`);
for (const [k, v] of Object.entries(ratios).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(10)} ${v.toFixed(1).padStart(6)}x`);
}

const results: BenchResult[] = bench.tasks.map(task => ({
  name: task.name,
  mean: task.result?.mean ?? 0,
  rme: task.result?.rme ?? 100,
  samples: task.result?.samples.length ?? 0,
  hz: task.result?.hz ?? 0,
}));

for (const r of results) {
  console.log(`${r.name.padEnd(52)} ${r.hz.toFixed(0).padStart(10)} hz  +/-${r.rme.toFixed(2)}%  (${r.samples} samples)`);
}

// Compare against a stored baseline when one is supplied. Silence here is the
// designed-for outcome: a report that flags routine jitter trains its readers to
// stop reading it, which costs more than the regression it was meant to catch.
const baselinePath = argValue('--baseline', '');
if (baselinePath !== '' && fs.existsSync(baselinePath)) {
  const stored = parseJsonObject(fs.readFileSync(baselinePath, 'utf8'), baselinePath) as unknown as {
    node?: string; results?: BenchResult[];
  };
  if (stored.node !== undefined && stored.node !== process.version) {
    console.log(`\n> Baseline recorded on Node ${stored.node}, this run is ${process.version}. Still compared - a runtime change is a main reason to keep baselines - but not like-for-like.`);
  }
  console.log('\n' + renderBenchMarkdown(compareBenchRuns(results, stored.results ?? [])));
}

const out = argValue('--out', '');
if (out !== '') {
  // node and platform are recorded WITH the numbers: every figure here is
  // conditional on them, and a baseline compared across a runtime change without
  // saying so is how a Node upgrade gets mistaken for a code regression.
  fs.writeFileSync(out, JSON.stringify({
    recordedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    results,
  }, null, 2) + '\n');
}
