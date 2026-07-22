import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseJsonArray } from '../shared/json-shape.ts';

// Test-taxonomy self-check (issues #336 / #398). The suite is partitioned two
// ways that must stay coherent: by DURATION (the `fast`/`heavy` vitest projects,
// with `heavy` = src/testing/heavy-tests.json) and by KIND (the declared
// `unit`/`ui`/`data-validity` tags). These tags are otherwise inert labels, so
// nothing but this meta-test stops a new validation from being silently
// mis-tiered — added to the fast pool where it oversubscribes the machine and
// flakes (#375), or a heavy build being tagged as a cheap unit guard. This test
// encodes the invariants so such a drift fails here, pre-merge, by name.

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const HEAVY_TESTS_JSON = 'src/testing/heavy-tests.json';
const FOLD_TESTS_JSON = 'src/testing/fold-tests.json';

// The declared tag vocabulary. Held as the self-check's own copy and tied back to
// vitest.config.ts by the parity assertion below, so a rename in either place
// trips a test rather than passing silently.
const DECLARED_TAGS = ['unit', 'ui', 'data-validity'] as const;
type Tag = (typeof DECLARED_TAGS)[number];

// build-dataset-pages.test.ts is deliberately left untagged in this pass: a
// separate in-flight change owns that file, so tagging it here would collide.
// The exemption is encoded explicitly (never a silent skip) so it is visible and
// retirable — delete this entry once that file carries its tags (follow-up on
// issue #336).
const UNTAGGED_EXEMPT = new Set<string>(['src/ci/build-dataset-pages.test.ts']);

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function testFilesUnder(dir: string): string[] {
  const root = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { recursive: true })
    .map(entry => toPosix(path.join(dir, entry.toString())))
    .filter(file => file.endsWith('.test.ts'));
}

// The two fast-project include globs are src/**/*.test.ts and site/**/*.test.ts,
// so the discovered set is exactly what the projects can run.
const ALL_TEST_FILES = [...testFilesUnder('src'), ...testFilesUnder('site')].sort();

const heavyTestsPath = path.join(REPO_ROOT, HEAVY_TESTS_JSON);
const HEAVY_LIST = parseJsonArray(fs.readFileSync(heavyTestsPath, 'utf8'), heavyTestsPath) as string[];
const foldTestsPath = path.join(REPO_ROOT, FOLD_TESTS_JSON);
const FOLD_LIST = parseJsonArray(fs.readFileSync(foldTestsPath, 'utf8'), foldTestsPath) as string[];

// Extract every tag applied anywhere in a file's `{ tags: [...] }` describe/test
// options. Source-text parsing (not execution) keeps the check cheap and lets it
// see every describe without collecting the real suites.
function tagsIn(relFile: string): Set<Tag> {
  const text = fs.readFileSync(path.join(REPO_ROOT, relFile), 'utf8');
  const found = new Set<Tag>();
  for (const optionList of text.matchAll(/tags:\s*\[([^\]]*)\]/g)) {
    for (const quoted of optionList[1].matchAll(/['"]([^'"]+)['"]/g)) {
      found.add(quoted[1] as Tag);
    }
  }
  return found;
}

describe('test taxonomy self-check (issues #336 / #398)', { tags: ['unit'] }, () => {
  it('DeclaredVocabulary_MatchesTheVitestConfig_SoTagNamesStayInSync', () => {
    // The tags array is the first `tags: [ ... ]` block in the config; each entry
    // is `{ name: 'X', description: '...' }`. Parsing it here fails loudly if a
    // tag is renamed in the config without updating this self-check (and vice versa).
    const config = fs.readFileSync(path.join(REPO_ROOT, 'vitest.config.ts'), 'utf8');
    // The real declaration is the `tags: [...]` block whose entries carry `name:`
    // — pick that one, so an incidental `{ tags: [...] }` mention in a comment does
    // not shadow it.
    const block = [...config.matchAll(/tags:\s*\[([\s\S]*?)\]/g)].map(m => m[1]).find(body => /name:\s*'/.test(body));
    expect(block, 'vitest.config.ts no longer declares a tags: [...] vocabulary with named entries').toBeDefined();
    const names = [...(block ?? '').matchAll(/name:\s*'([^']+)'/g)].map(m => m[1]);
    expect(new Set(names)).toEqual(new Set<string>(DECLARED_TAGS));
  });

  it('EveryTestFile_ExceptTheDocumentedExemption_CarriesAtLeastOneDeclaredTag', () => {
    const untagged: string[] = [];
    const undeclared: string[] = [];
    for (const file of ALL_TEST_FILES) {
      if (UNTAGGED_EXEMPT.has(file)) continue;
      const tags = tagsIn(file);
      if (tags.size === 0) {
        untagged.push(file);
        continue;
      }
      for (const tag of tags) {
        if (!DECLARED_TAGS.includes(tag)) undeclared.push(`${file}: ${tag}`);
      }
    }
    expect(untagged, 'these test files carry no declared tag — classify each by kind (unit / ui / data-validity)').toEqual([]);
    expect(undeclared, 'these test files use a tag outside the declared vocabulary').toEqual([]);
  });

  it('ExemptFiles_StillExist_SoAStaleExemptionCannotMaskAnUntaggedFile', () => {
    for (const file of UNTAGGED_EXEMPT) {
      expect(fs.existsSync(path.join(REPO_ROOT, file)), `${file} is exempt from tagging but no longer exists — retire the exemption`).toBe(true);
    }
  });

  it('EveryHeavyFile_IsADataValidation_CarryingADataValidityDescribe', () => {
    // A file is quarantined as `heavy` because it parses the whole real archive or
    // folds it through DuckDB — i.e. it is a data validation — so it must carry at
    // least one `data-validity` describe. A heavy file tagged only `unit` would be
    // a silent mis-tier. The converse does NOT hold: cheap full-corpus validations
    // (forbidden-suffix-history, trust-rating, cross-dataset-invariants) are
    // `data-validity` yet run in the fast pool, so heavy ⊆ data-validity, never the
    // reverse.
    const offenders: string[] = [];
    for (const file of HEAVY_LIST) {
      if (UNTAGGED_EXEMPT.has(file)) continue;
      if (!tagsIn(file).has('data-validity')) offenders.push(file);
    }
    expect(offenders, 'these heavy files lack a data-validity describe — a heavy build is by definition a data validation').toEqual([]);
  });

  it('EveryHeavyEntry_NamesAnExistingTestFile', () => {
    const missing = HEAVY_LIST.filter(file => !ALL_TEST_FILES.includes(file));
    expect(missing, 'heavy-tests.json lists a path that is not a discovered *.test.ts file').toEqual([]);
  });

  it('EveryFoldEntry_NamesAnExistingTestFile', () => {
    const missing = FOLD_LIST.filter(file => !ALL_TEST_FILES.includes(file));
    expect(missing, 'fold-tests.json lists a path that is not a discovered *.test.ts file').toEqual([]);
  });

  it('EveryFullCorpusFoldTest_IsRegisteredInBothLists_SoItRunsInTheFoldMatrixNotTheFastPool', () => {
    // `acquireClaimsSource` is the signature of a FULL-CORPUS fold: the test
    // opens the whole claims Parquet and folds it through DuckDB, taking
    // minutes. Such a file left out of the registration lists is not skipped —
    // it silently lands in the fast 2-shard pool, where a multi-minute fold
    // oversubscribes the runner and flakes (#375). Fixture-scale folds (which
    // build their own small ledgers) are fine in the fast pool and are exempt
    // by construction: they don't call the corpus acquirer.
    // Match the IMPORT of the acquirer (not any textual mention, which would
    // sweep up this self-check's own strings and comments).
    const importsAcquirer = /import\s*(?:type\s*)?\{[^}]*\bacquireClaimsSource\b[^}]*\}/;
    const unregistered: string[] = [];
    for (const file of ALL_TEST_FILES) {
      const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      if (!importsAcquirer.test(text)) continue;
      if (!HEAVY_LIST.includes(file) || !FOLD_LIST.includes(file)) unregistered.push(file);
    }
    expect(unregistered, 'these full-corpus fold tests are missing from heavy-tests.json and/or fold-tests.json — unregistered, they run (and flake) in the fast pool').toEqual([]);
  });

  it('FoldList_IsASubsetOfTheHeavyList_SoNoFoldTestAlsoRunsInTheFastPool', () => {
    // The fold matrix schedules FOLD_LIST directly; heavy-tests.json is what the
    // fast project EXCLUDES. A fold entry absent from the heavy list would run
    // twice: once in its matrix job and again in the fast pool.
    const leaked = FOLD_LIST.filter(file => !HEAVY_LIST.includes(file));
    expect(leaked, 'these fold-tests.json entries are missing from heavy-tests.json, so the fast pool runs them a second time').toEqual([]);
  });

  it('RegistrationLists_ContainNoDuplicateEntries_SoNoTestIsScheduledTwice', () => {
    const dupes = (list: string[]) => list.filter((file, i) => list.indexOf(file) !== i);
    expect(dupes(HEAVY_LIST), 'heavy-tests.json contains duplicate entries').toEqual([]);
    expect(dupes(FOLD_LIST), 'fold-tests.json contains duplicate entries').toEqual([]);
  });

  it('LaneUnion_CoversEveryTestFile_SoNothingIsUnrun', () => {
    // The projects partition by duration: `fast` = the discovered set minus the
    // heavy list; `heavy` = the list. Their union must be every discovered file,
    // so no file is silently un-run by both.
    const heavy = new Set(HEAVY_LIST);
    const fastLane = ALL_TEST_FILES.filter(file => !heavy.has(file));
    const union = new Set([...fastLane, ...HEAVY_LIST.filter(file => ALL_TEST_FILES.includes(file))]);
    expect([...union].sort()).toEqual(ALL_TEST_FILES);
    // And every discovered file sits under an included root, so a project glob runs it.
    const unreachable = ALL_TEST_FILES.filter(file => !file.startsWith('src/') && !file.startsWith('site/'));
    expect(unreachable, 'a test file lives outside src/ and site/, so neither project include glob runs it').toEqual([]);
  });
});
