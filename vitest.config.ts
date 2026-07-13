import { readFileSync } from 'fs';
import { defineConfig, defaultExclude } from 'vitest/config';

// The real-archive build tests each parse multi-hundred-thousand-row CSVs and
// assemble whole deploy artefacts inside a beforeAll hook. Run alongside the
// fast unit suite they oversubscribe the machine, and under that CPU/IO
// contention their build hooks flake past their per-hook budgets (issue #375) -
// a timeout that passes comfortably in isolation. They are quarantined into a
// dedicated `heavy` project that runs AFTER the fast suite (a higher
// sequence.groupOrder) and one file at a time (fileParallelism: false), so a
// heavy build always has the cores to itself. `npm test` still runs everything;
// the two pools simply never contend. Isolation, not a raised ceiling, is the
// fix - bumping timeouts is the whack-a-mole this pattern already outgrew.
// TRIAL (#478): the ISOLATED heavy files - each gets its own parallel CI job
// (see .github/workflows/ci.yml), pulling the pre-built claims Parquet artifact.
// This is the top of the measured duration distribution (>~90 s each in the
// baseline); the ~78 remaining files run together in the sharded `fast` pool.
//
// SINGLE SOURCE OF TRUTH: the list lives in src/testing/heavy-tests.json so this
// config (which excludes them from `fast`) and the CI matrix (which spawns one
// job per entry) read the identical set - the yml never hardcodes file paths, it
// derives its matrix from this file. Add or remove a heavy file in one place.
function loadHeavyTests(): string[] {
  const url = new URL('./src/testing/heavy-tests.json', import.meta.url);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(url, 'utf8'));
  } catch (err) {
    throw new Error(`Could not read/parse the heavy-test list ${url.pathname}: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed) || !parsed.every((entry): entry is string => typeof entry === 'string')) {
    throw new Error(`${url.pathname} must be a JSON array of test-file path strings.`);
  }
  return parsed;
}
const HEAVY_BUILD_TESTS = loadHeavyTests();

// Options every project shares. Kept in one place so the fast and heavy pools
// run under identical semantics - only their file selection and scheduling
// differ.
const shared = {
  // Node environment (no jsdom for tests) - we don't test DOM code here. The
  // scrape module does use jsdom internally, but we test its pure helpers
  // rather than the whole page-fetch flow.
  environment: 'node' as const,
  // The published .gz download artefacts are compressed at level 9 by the
  // deploy for the smallest downloads; the tiers build is CPU-heavy, and ~half
  // of it is that level-9 compression. Tests verify the artefacts' CONTENTS
  // (gunzip + row/query checks), not their size, and gzip level does not affect
  // functionality - so tests compress at level 1 for a large speed-up. The
  // deploy (which sets no such env var) keeps level 9.
  env: { TIERS_GZIP_LEVEL: '1' },
  // Bridge a repo-local `npm run setup:duckdb` install to DUCKDB_BIN before any
  // test file is collected, so the DuckDB-backed suites find the binary and run
  // (or skip honestly) instead of failing with ENOENT. The single "not
  // installed" hint is emitted by globalSetup below, not here.
  setupFiles: ['./src/testing/vitest-duckdb.ts'],
  // This suite is data-heavy by design: golden masters and deploy-artefact
  // builds routinely parse multi-hundred-thousand-row CSVs from the real archive
  // inside tests and hooks. The 5s/10s vitest defaults are tuned for unit tests
  // and flake on slower CI machines - a generous repo-wide budget reflects what
  // the tests actually do. Hangs still fail; they just get ten minutes to prove
  // themselves (the data-heavy real-archive builds grow with each ingested
  // dataset).
  testTimeout: 600_000,
  // Hooks build whole deploy artefacts from the real archive; that work grows
  // with each ingested dataset, so the ceiling is generous for congested CI
  // runners. Hangs still fail.
  hookTimeout: 600_000,
};

export default defineConfig({
  test: {
    // Emit the single "DuckDB not installed" hint once for the whole run (the
    // per-worker DUCKDB_BIN bridging is in the setupFiles above).
    globalSetup: ['./src/testing/vitest-duckdb-global.ts'],
    // Test taxonomy (issue #478). The declared vocabulary a test may carry as a
    // `{ tags: [...] }` option on describe/test; strictTags (default) rejects any
    // tag not listed here, so a typo fails loudly. Declaring them changes no
    // behaviour - tags are inert until a `--tags-filter` selects on them.
    // Environments follow a gated local -> full-data staging model (see
    // src/testing/TEST-TAXONOMY.md).
    tags: [
      { name: 'unit', description: 'Code-correctness guard: fixture in, assert the transform; no real dataset (local tier).' },
      { name: 'ui', description: 'Browser/DOM helper under site/ (jsdom); no real dataset (local tier).' },
      { name: 'data-validity', description: 'Validates the real full dataset / pipeline against encoded assumptions (full-data tier).' },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        // Live-deployment verification harnesses (the post-deploy smoke and
        // browser-console checks): they run against the real Pages site from
        // pages.yml - hitting the network and a real browser - so they are
        // exercised there, not unit-tested. Like *.test.ts they are test code,
        // not product code, and do not belong in the product-coverage denominator.
        'src/ci/smoke-test.ts',
        'src/ci/console-check.ts',
      ],
      // Regression floor, set just below measured coverage (pure modules are well
      // covered; the I/O-heavy scrape / process / orchestrator bodies are not).
      // Raise as coverage grows - never lower without a written reason.
      //
      // ENFORCED ONLY ON THE MERGED REPORT. The fan-out CI (#478) runs each
      // heavy/fast job over a SUBSET with --coverage, so applying the floor
      // per-job would fail every job (one file covers ~6% of src). Those jobs set
      // COVERAGE_SKIP_THRESHOLDS=1 to collect coverage without gating; the
      // `coverage` job then merges every blob and applies the floor to the whole.
      thresholds: process.env.COVERAGE_SKIP_THRESHOLDS
        ? undefined
        : {
            statements: 28,
            branches: 26,
            functions: 23,
            lines: 28,
          },
    },
    projects: [
      {
        test: {
          ...shared,
          name: 'fast',
          // Co-locate tests with source: `src/foo.ts` -> `src/foo.test.ts`. Keeps a
          // test's subject one click away and avoids a parallel `tests/` tree that
          // has to be kept in sync as the code moves around.
          // Browser code lives in site/ (served as-is, outside the tsc program);
          // its pure, DOM-free helpers (e.g. site/browser-query.js) get co-located
          // unit tests too.
          include: ['src/**/*.test.ts', 'site/**/*.test.ts'],
          // The heavy real-archive builders run in their own non-contended pool.
          exclude: [...defaultExclude, ...HEAVY_BUILD_TESTS],
        },
      },
      {
        test: {
          ...shared,
          name: 'heavy',
          include: HEAVY_BUILD_TESTS,
          // One heavy build at a time, so it never competes with a sibling build
          // for cores.
          fileParallelism: false,
          // Run this pool only once the fast suite has drained, so the two never
          // contend for the machine.
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
