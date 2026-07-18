// Type-aware lint (issue #15's linter slot). The high-value rules for this
// codebase are the async-correctness ones - no-floating-promises especially:
// the orchestrator is async end-to-end and a dropped promise means a silently
// skipped notification or state save.
import tseslint from 'typescript-eslint';
import globals from 'globals';

// The rules shared between the node-side pipeline (src/) and the browser
// runtime (site/): both are type-checked (the latter via checkJs + JSDoc,
// #530) so the same type-aware rules apply to both equally.
const sharedTypeAwareRules = {
  // any is forbidden (issue #40): caught values are unknown, narrowed via
  // errorMessage()/type guards. A legitimately unavoidable any needs a
  // single-line disable pragma with a justification comment.
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true, allowBoolean: true }],
};

// Parse-safety boundary (#812): `JSON.parse(...) as SomeType` lets tsc and
// type-aware lint both stay silent while a null/string/array reaches a field
// access downstream and throws unlocated - the assertion tells the compiler
// to trust a shape nothing has checked. The fix is always the same shape:
// `const parsed: unknown = JSON.parse(...)` (a type ANNOTATION, which does
// not suppress checking, rather than an assertion, which does) followed by a
// runtime guard (see src/shared/json-shape.ts) and only then an earned cast.
const noAssertedJsonParseRule = {
  selector: "TSAsExpression[expression.callee.object.name='JSON'][expression.callee.property.name='parse']",
  message:
    'Do not assert the shape of JSON.parse output - assign to `const x: unknown = JSON.parse(...)` and validate the shape before use (see src/shared/json-shape.ts). A cast here defeats both tsc and type-aware lint.',
};

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', 'archive/', 'docs/', '*.mjs'],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    // The node-side pipeline (src/): one tsc program (tsconfig.json), so
    // typescript-eslint's project service can auto-discover it per file.
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...sharedTypeAwareRules,
      // Disagrees with tsc about csv-parse assertion necessity - tsc wins.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      'no-restricted-syntax': ['error', noAssertedJsonParseRule],
    },
  },
  {
    // The browser runtime (site/), everything except the service worker: a
    // second, DOM-scoped tsc program (tsconfig.site.json, issue #464/#530).
    // It is a differently-named, non-referenced tsconfig, so the project
    // service (which only auto-discovers files literally named tsconfig.json)
    // cannot find it - the classic explicit `project` path is used instead.
    // Test files (site/**/*.test.ts) and global.d.ts share this program (the
    // tsconfig's include is site/**/*), so they get the same rules as the
    // .js modules, matching how src/**/*.test.ts get no special treatment.
    files: ['site/**/*.js', 'site/**/*.ts'],
    ignores: ['site/sw.js'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.site.json'],
        projectService: false,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.browser,
    },
    rules: sharedTypeAwareRules,
  },
  {
    // site/sw.js: the service-worker global scope, its own tsc program
    // (tsconfig.site-worker.json) for the same reason it cannot share a
    // program with the DOM-scoped one (see that tsconfig for the lib clash).
    files: ['site/sw.js'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.site-worker.json'],
        projectService: false,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.serviceworker,
    },
    rules: sharedTypeAwareRules,
  },
);
