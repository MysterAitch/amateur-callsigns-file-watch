import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Co-locate tests with source: `src/foo.ts` -> `src/foo.test.ts`. Keeps a
    // test's subject one click away and avoids a parallel `tests/` tree that
    // has to be kept in sync as the code moves around.
    include: ['src/**/*.test.ts'],
    // Node environment (no jsdom for tests) - we don't test DOM code here.
    // The scrape module does use jsdom internally, but we test its pure
    // helpers rather than the whole page-fetch flow.
    environment: 'node',
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
