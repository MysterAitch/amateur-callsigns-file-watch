// Type-aware lint (issue #15's linter slot). The high-value rules for this
// codebase are the async-correctness ones - no-floating-promises especially:
// the orchestrator is async end-to-end and a dropped promise means a silently
// skipped notification or state save.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', 'archive/', 'docs/', '*.mjs'],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // any is forbidden (issue #40): caught values are unknown, narrowed via
      // errorMessage()/type guards. A legitimately unavoidable any needs a
      // single-line disable pragma with a justification comment.
      '@typescript-eslint/no-explicit-any': 'error',
      // Disagrees with tsc about csv-parse assertion necessity - tsc wins.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true, allowBoolean: true }],
    },
  },
);
