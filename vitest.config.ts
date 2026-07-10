import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Co-locate tests with source: `src/foo.ts` -> `src/foo.test.ts`. Keeps a
    // test's subject one click away and avoids a parallel `tests/` tree that
    // has to be kept in sync as the code moves around.
    // Browser code lives in site/ (served as-is, outside the tsc program);
    // its pure, DOM-free helpers (e.g. site/browser-query.js) get co-located
    // unit tests too.
    include: ['src/**/*.test.ts', 'site/**/*.test.ts'],
    // Node environment (no jsdom for tests) - we don't test DOM code here.
    // The scrape module does use jsdom internally, but we test its pure
    // helpers rather than the whole page-fetch flow.
    environment: 'node',
    // The published .gz download artefacts are compressed at level 9 by the
    // deploy for the smallest downloads; the tiers build is CPU-heavy, and
    // ~half of it is that level-9 compression. Tests verify the artefacts'
    // CONTENTS (gunzip + row/query checks), not their size, and gzip level does
    // not affect functionality — so tests compress at level 1 for a large
    // speed-up. The deploy (which sets no such env var) keeps level 9.
    env: { TIERS_GZIP_LEVEL: '1' },
    // This suite is data-heavy by design: golden masters and deploy-artefact
    // builds routinely parse multi-hundred-thousand-row CSVs from the real
    // archive inside tests and hooks. The 5s/10s vitest defaults are tuned
    // for unit tests and flake on slower CI machines (three separate
    // timeout failures caught in CI, each passing locally) - a generous
    // repo-wide budget reflects what the tests actually do. Hangs still
    // fail; they just get ten minutes to prove themselves (the data-heavy real-archive builds grow with each ingested dataset).
    testTimeout: 600_000,
    // Hooks build whole deploy artefacts from the real archive; that work grows
    // with each ingested dataset, so the ceiling is generous for congested CI
    // runners (the #336 efficiency work reduces the actual time). Hangs still fail.
    hookTimeout: 600_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      // Regression floor, set just below measured coverage
      // (pure modules are well covered; the I/O-heavy scrape / process /
      // orchestrator bodies are not). Raise as coverage grows - never lower without a written reason.
      thresholds: {
        statements: 28,
        branches: 26,
        functions: 23,
        lines: 28,
      },
    },
  },
});
