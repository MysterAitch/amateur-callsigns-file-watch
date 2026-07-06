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
      // Pragmatic accommodations for the existing idiom; tighten separately
      // if ever worth the churn.
      '@typescript-eslint/no-explicit-any': 'off',
      // Disagrees with tsc about csv-parse assertion necessity - tsc wins.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      // catch (err: any) with err.message access is used throughout for
      // execFileSync/axios error shapes.
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true, allowBoolean: true, allowAny: true }],
    },
  },
);
