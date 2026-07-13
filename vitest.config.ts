import { defineConfig, defaultExclude } from 'vitest/config';

// TRIAL (issue #478): the fast/heavy split existed only to quarantine the
// real-archive build tests, which each materialised the whole archive in a
// beforeAll and, run concurrently, oversubscribed the machine until their build
// hooks flaked past their budgets (issue #375/#380). The shared claims Parquet
// (#478) removes the biggest contention source - the fold suites now read one
// pre-built artefact instead of each re-materialising ~11 GB - so this trial
// drops the split entirely and lets every suite run in the default parallel
// pool. If contention/timeouts return on the 2-core CI runner we revert to the
// split (or a narrower one that quarantines only the true archive-builders).
export default defineConfig({
  test: {
    // Co-locate tests with source: `src/foo.ts` -> `src/foo.test.ts`. Browser
    // code lives in site/ (served as-is, outside the tsc program); its pure,
    // DOM-free helpers get co-located unit tests too.
    include: ['src/**/*.test.ts', 'site/**/*.test.ts'],
    exclude: [...defaultExclude],
    // Node environment (no jsdom) - we don't test DOM code here; the scrape
    // module uses jsdom internally but we test its pure helpers.
    environment: 'node',
    // Emit the single "DuckDB not installed" hint once, and (when opted in via
    // ACF_SHARED_CLAIMS) build the one shared claims Parquet the fold suites read.
    globalSetup: ['./src/testing/vitest-duckdb-global.ts'],
    // Bridge a repo-local `npm run setup:duckdb` install to DUCKDB_BIN, and point
    // the folds at the shared Parquet, before any test file is collected.
    setupFiles: ['./src/testing/vitest-duckdb.ts'],
    // The published .gz download artefacts compress at level 9 in the deploy;
    // tests check CONTENTS not size, so level 1 is a large speed-up (the deploy
    // sets no such env var and keeps level 9).
    env: { TIERS_GZIP_LEVEL: '1' },
    // This suite is data-heavy by design: golden masters and deploy-artefact
    // builds parse multi-hundred-thousand-row CSVs from the real archive inside
    // tests and hooks. The 5s/10s vitest defaults flake on slower CI machines - a
    // generous repo-wide budget reflects what the tests actually do. Hangs still
    // fail; they just get ten minutes to prove themselves.
    testTimeout: 600_000,
    hookTimeout: 600_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      // Regression floor, set just below measured coverage (pure modules are well
      // covered; the I/O-heavy scrape / process / orchestrator bodies are not).
      // Raise as coverage grows - never lower without a written reason.
      thresholds: {
        statements: 28,
        branches: 26,
        functions: 23,
        lines: 28,
      },
    },
  },
});
