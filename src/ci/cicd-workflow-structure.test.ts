import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// CI/CD structure contract (ADR 0019). The unified `cicd.yaml` carries the
// highest-blast-radius invariants in the repo: the required-check job NAMES (a
// rename blocks every merge), the deploy gating (an ungated deploy would publish
// from a pull request), the job-scoped write permissions (the read-only-CI
// posture of ADR 0012), and the test-excluding cache keys (#517 — a regression to
// bare hashFiles would rebuild the whole corpus on any test edit). Each was
// navigated by hand while the pipeline was assembled; these tests pin them so a
// later workflow edit fails here, pre-merge, instead of via a broken deploy or a
// frozen merge queue.

const WORKFLOW = path.join('.github', 'workflows', 'cicd.yaml');
const CLOSURE_ACTION = path.join('.github', 'actions', 'closure-hash', 'action.yml');

// Normalise to LF so the line-anchored patterns below are line-ending agnostic
// (a Windows checkout carries CRLF; the Linux CI runner carries LF).
function workflow(): string {
  return fs.readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
}

// A job's YAML block: from its 2-space-indented header to the next top-level job
// key (also 2-space, a letter — comment lines start with `#`, steps are deeper),
// or end of file. Enough to assert what a given job contains without a YAML dep.
function jobBlock(wf: string, name: string): string {
  const m = wf.match(new RegExp(`\\n {2}${name}:\\n([\\s\\S]*?)(?=\\n {2}[A-Za-z][\\w-]*:\\n|$)`));
  if (m === null) throw new Error(`job '${name}' not found in ${WORKFLOW}`);
  return m[1];
}

const MAIN_GATE = "if: github.ref == 'refs/heads/main'";

// Strip line and block comments so import-specifier matching never trips on a
// path mentioned in prose (a doc comment referencing `from './x.ts'` is not an
// edge). String literals are left intact — real import specifiers live in them.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// Resolve a relative import specifier against the importing file to a real
// source file, mirroring node/tsc resolution: exact, then .ts/.js, then a
// directory index, then the TS-source-with-.js-specifier convention.
function resolveRelativeImport(fromFile: string, spec: string): string | null {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, `${base}.ts`, `${base}.js`, path.join(base, 'index.ts')];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  if (spec.endsWith('.js')) {
    const tsAlt = base.replace(/\.js$/, '.ts');
    if (fs.existsSync(tsAlt)) return tsAlt;
  }
  return null;
}

// The transitive closure of relative imports/re-exports reachable from an entry
// file, as repo-relative POSIX paths. Static imports, dynamic import() and
// re-exports are all followed; bare package specifiers are inputs to no cache key
// here (they enter the hash via package-lock.json) so are ignored.
function importClosure(entryFile: string): string[] {
  const specRe =
    /(?:import|export)\b[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  const seen = new Set<string>();
  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    for (const m of src.matchAll(specRe)) {
      const spec = m[1] ?? m[2];
      if (spec === undefined) continue;
      const resolved = resolveRelativeImport(file, spec);
      if (resolved !== null) walk(resolved);
    }
  };
  walk(entryFile);
  return [...seen].map(f => path.relative(process.cwd(), f).split(path.sep).join('/')).sort();
}

// The space-separated closure-hash `paths:` list declared inside a job block.
function closurePathsIn(block: string): string[] {
  const m = block.match(/uses: \.\/\.github\/actions\/closure-hash\n\s+with:\n\s+paths: ([^\n]+)/);
  if (m === null) throw new Error('no closure-hash step with a paths: input found in the given job block');
  return m[1].trim().split(/\s+/);
}

// A reached file is covered when a declared path names it exactly or is a
// directory that contains it. Over-declaring is safe (a false miss); a reached
// file NOT covered is the danger (a stale cache hit), which the guard forbids.
function isCovered(file: string, declaredPaths: readonly string[]): boolean {
  return declaredPaths.some(p => file === p || file.startsWith(`${p}/`));
}

describe('cicd.yaml structure', { tags: ['unit'] }, () => {
  it('EveryWorkflowFile_WhenParsedAsYaml_IsStructurallyValid', () => {
    // The line-matching assertions below pass over a file GitHub cannot parse
    // (observed: an upload step spliced mid-way through a run block killed the
    // whole workflow before any job - including the actionlint audit that
    // would have caught it - could start). A real parse is the floor: every
    // workflow must load as YAML and declare jobs that are maps with steps or
    // a `uses` reference.
    const dir = path.join(process.cwd(), '.github', 'workflows');
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))) {
      const doc = yaml.load(fs.readFileSync(path.join(dir, file), 'utf8')) as { jobs?: Record<string, { steps?: unknown[]; uses?: string }> };
      expect(doc, `${file} did not parse to a mapping`).toBeTypeOf('object');
      expect(doc.jobs, `${file} has no jobs mapping`).toBeTypeOf('object');
      for (const [name, job] of Object.entries(doc.jobs ?? {})) {
        const hasSteps = Array.isArray(job.steps) && job.steps.length > 0;
        const isReusable = typeof job.uses === 'string';
        expect(hasSteps || isReusable, `${file} job ${name} has neither steps nor uses`).toBe(true);
      }
    }
  });

  it('RequiredChecks_JobNames_ArePreserved', () => {
    // The main ruleset requires these two checks BY NAME; renaming either job
    // here without updating the ruleset blocks all merges. Guard the names.
    const wf = workflow();
    expect(wf, 'the required check job `tests` is missing/renamed').toMatch(/\n {2}tests:\n/);
    expect(wf, 'the required check job `data-validation` is missing/renamed').toMatch(/\n {2}data-validation:\n/);
    expect(wf, 'the required check job `workflow-audit` is missing/renamed').toMatch(/\n {2}workflow-audit:\n/);
  });

  it('GoldenMaster_ReportsAStable_NonMatrixContext', () => {
    // golden-master is the pending required-check candidate (#588 part 2): a
    // ruleset matches a required status check on its EXACT reported context
    // string. A bare job (no `strategy:`) reports that context as its job
    // name alone - stable across runs. Guard both the name and the absence of
    // a matrix, since a matrix strategy suffixes the reported context per leg
    // (e.g. "golden-master (ubuntu-latest)") and would silently break any
    // ruleset entry keyed on the bare name.
    const wf = workflow();
    expect(wf, 'the golden-master job is missing/renamed').toMatch(/\n {2}golden-master:\n {4}name: golden-master\n/);
    const block = jobBlock(wf, 'golden-master');
    expect(block, 'golden-master gained a matrix strategy - its reported check context would no longer be a single stable string').not.toMatch(/\n\s+strategy:\n/);
  });

  it('Deploy_IsGatedToMain_AndHoldsTheOnlyWritePermissions', () => {
    const wf = workflow();
    const deploy = jobBlock(wf, 'deploy');
    expect(deploy, 'the deploy job is not gated to main — it could publish from a PR').toContain(MAIN_GATE);
    expect(deploy, 'the deploy job lost its pages:write permission').toMatch(/pages: write/);
    expect(deploy, 'the deploy job lost its id-token:write permission').toMatch(/id-token: write/);
    // The write scopes must live ONLY on the deploy job — every other job stays
    // read-only (ADR 0012). If either scope appears more than once, a verify job
    // has gained write access.
    expect((wf.match(/pages: write/g) ?? []).length, 'pages:write appears outside the deploy job').toBe(1);
    expect((wf.match(/id-token: write/g) ?? []).length, 'id-token:write appears outside the deploy job').toBe(1);
  });

  it('WorkflowDefault_IsReadOnly', () => {
    // Top-level (column-0) permissions default to contents:read; job-level
    // permissions are indented, so this matches only the workflow default.
    expect(workflow(), 'the workflow default permission is not contents:read').toMatch(/\npermissions:\n {2}contents: read\n/);
  });

  it('PostDeployChecks_AreGatedToMain', () => {
    // smoke/console-check/functionality-check run against the LIVE deployment, so
    // they must only run on main (there is no deployment to check on a PR).
    const wf = workflow();
    for (const job of ['smoke', 'console-check', 'functionality-check']) {
      expect(jobBlock(wf, job), `${job} is not gated to main`).toContain(MAIN_GATE);
    }
  });

  it('BuildSiteDatabases_RunsOnAllTriggers_ForPreMergeCoverage', () => {
    // The database build must NOT be gated to main: running it on PRs is what
    // gives the deploy build pre-merge coverage (ADR 0019). Only its Pages
    // upload/configure steps are gated. So the job's own scope (before its first
    // step) must not carry the main gate.
    const block = jobBlock(workflow(), 'build-site-databases');
    const beforeSteps = block.slice(0, block.indexOf('steps:'));
    expect(beforeSteps, 'build-site-databases is gated to main — it would lose PR coverage').not.toContain(MAIN_GATE);
  });

  it('BuilderProjection_IsBuiltFromTheSharedEmit_BeforeTheEmitIsDropped', () => {
    // Issue #629 phase 2: the builder projection reuses the deploy's one
    // corpus emit (--ledger-dir), and the #646 rm -rf of that emit must come
    // AFTER it - the projection build is the emit's last consumer. A reorder
    // (or dropping the reuse flag) would either re-emit the corpus or fold
    // from an already-deleted directory.
    const block = jobBlock(workflow(), 'build-site-databases');
    const projectionBuild = block.indexOf('node src/v2/build-builder-projection.ts .builder-projection --ledger-dir="$RUNNER_TEMP/v2-ledger-emit"');
    const emitRemoval = block.indexOf('rm -rf "$RUNNER_TEMP/v2-ledger-emit"');
    expect(projectionBuild, 'the builder-projection build (with --ledger-dir reuse) is missing from build-site-databases').toBeGreaterThan(-1);
    expect(emitRemoval, 'the #646 shared-emit removal is missing').toBeGreaterThan(-1);
    expect(emitRemoval, 'the shared emit is removed BEFORE the builder projection folds it').toBeGreaterThan(projectionBuild);
  });

  it('DownloadTiers_BuildAfterTheProjection_WithTheSwitchSet', () => {
    // Issue #629 phase 3: the download-tier build (build-sqlite.ts) resolves
    // its derived-file inputs through the archive/projection switch, so it
    // must run AFTER the builder projection exists and must carry the switch.
    // Losing the env would silently fall back to the committed archive - the
    // tiers would then miss any publication newer than the frozen committed
    // baseline; running it before the projection build would fail loudly.
    const block = jobBlock(workflow(), 'build-site-databases');
    const tiersBuild = block.indexOf('BUILDER_PROJECTION_DIR="$GITHUB_WORKSPACE/.builder-projection" node src/ci/build-sqlite.ts .dbstage');
    const projectionBuild = block.indexOf('node src/v2/build-builder-projection.ts .builder-projection');
    expect(tiersBuild, 'the download-tier build lost its BUILDER_PROJECTION_DIR switch').toBeGreaterThan(-1);
    expect(projectionBuild, 'the builder-projection build is missing from build-site-databases').toBeGreaterThan(-1);
    expect(tiersBuild, 'the download tiers build BEFORE the projection they read from exists').toBeGreaterThan(projectionBuild);
  });

  it('AssembleStep_ReadsDerivedFilesFromTheProjection_AndTheCacheCarriesIt', () => {
    // The assemble step's builders resolve derived entry files through
    // BUILDER_PROJECTION_DIR (issue #629 phase 2). The projection must also be
    // part of the db-cache path: on a cache hit the build step is skipped
    // entirely, so an uncached projection would be absent and the assemble
    // step would (loudly) fail every cache-hit deploy.
    const block = jobBlock(workflow(), 'build-site-databases');
    expect(block, 'the assemble step lost its BUILDER_PROJECTION_DIR wiring').toContain('BUILDER_PROJECTION_DIR: ${{ github.workspace }}/.builder-projection');
    expect(block, 'the db cache no longer carries .builder-projection - cache-hit deploys would have no projection').toMatch(/path: \|\n\s+\.dbstage\n\s+\.builder-projection\n/);
    // The projection must never ride the published data directory: .dbstage is
    // hardlinked wholesale into _site/data, so the projection lives beside it.
    expect(block, 'the builder projection is built INSIDE .dbstage - it would be published under _site/data').not.toContain('build-builder-projection.ts .dbstage');
  });

  it('GoldenMaster_RegeneratesReportsFromTheProjection_OnACacheMiss', () => {
    // The golden-flow decision (issue #629): report regeneration reads its
    // derived entry files from the ledger projection - the same input path
    // the scheduled report sweep runs, and the only complete one once a
    // publication newer than the frozen committed baseline exists.
    const block = jobBlock(workflow(), 'golden-master');
    const projectionBuild = block.indexOf('node src/v2/build-builder-projection.ts "$RUNNER_TEMP/builder-projection"');
    const sweep = block.indexOf('BUILDER_PROJECTION_DIR="$RUNNER_TEMP/builder-projection" npm run reports:sweep');
    expect(projectionBuild, 'golden-master no longer builds the projection before the report sweep').toBeGreaterThan(-1);
    expect(sweep, 'golden-master runs the report sweep without BUILDER_PROJECTION_DIR - reports would regenerate from the frozen committed derivatives only').toBeGreaterThan(projectionBuild);
  });

  it('DataValidation_StaysOnTheCommittedArchive_NoProjectionSwitch', () => {
    // validate-data gates what a data PR COMMITS - the raw/meta record and
    // the frozen committed derivatives - so its derived-file reads stay
    // archive reads (#448 owns any re-home): the job must not export the
    // projection switch.
    const block = jobBlock(workflow(), 'data-validation');
    expect(block, 'data-validation gained BUILDER_PROJECTION_DIR - it would validate the projection instead of the committed record').not.toContain('BUILDER_PROJECTION_DIR:');
  });

  it('SiteAssembly_TargetsTheV0Reroot_NotTheBareDeployRoot', () => {
    // Issue #921: the whole generated site now assembles under _site/v0 so a
    // bare-bones v1 can own the deploy root. Every builder invocation and copy
    // in the assemble step must target _site/v0, and the dataset-pages sitemap
    // must carry the /v0 baseUrl (its URLs move too). A builder left writing to
    // the bare root would publish half the tree at the root and collide with
    // the redirect stubs that now own those paths.
    const block = jobBlock(workflow(), 'build-site-databases');
    expect(block, 'dataset-pages must build into _site/v0 with the /v0 baseUrl').toContain(
      'node src/ci/build-dataset-pages.ts _site/v0 https://mysteraitch.github.io/amateur-callsigns-file-watch/v0',
    );
    expect(block).toContain('cp -al .dbstage/. _site/v0/data/');
    expect(block).toContain('> _site/v0/data/version.txt');
    expect(block).toMatch(/cp site\/\*\.html[^\n]*\s_site\/v0\//);
    expect(block).toContain('node src/ci/build-callsign-shards.ts _site/v0/callsign/data');
    expect(block).toContain('node src/ci/build-event-time-surfaces.ts _site/v0');
    expect(block).toContain('node src/ci/build-nav.ts _site/v0/index.html');
    expect(block).toContain('node src/ci/build-sw-precache.ts _site/v0/sw.js');
    // No page builder may still write to the bare deploy root.
    expect(block, 'a page builder still targets the bare _site root').not.toMatch(
      /node src\/ci\/build-[a-z-]+\.ts _site\/(?!v0)/,
    );
  });

  it('V1Shell_IsCopiedToTheBareDeployRoot_AfterAssembly', () => {
    // Issue #921: the v1 pages copy flat into the bare _site root, AFTER the v0
    // assembly (before which the tree they sit beside does not exist). It must
    // target the bare root, not the /v0/ re-root.
    const block = jobBlock(workflow(), 'build-site-databases');
    const v1Copy = block.indexOf('cp site/v1/*.html');
    const assembleEnd = block.indexOf('node src/ci/build-sw-precache.ts _site/v0/sw.js');
    expect(v1Copy, 'the v1-shell copy step is missing from build-site-databases').toBeGreaterThan(-1);
    expect(assembleEnd, 'the assemble step is missing').toBeGreaterThan(-1);
    expect(v1Copy, 'the v1 shell is copied before the v0 assembly completes').toBeGreaterThan(assembleEnd);
    expect(block).toMatch(/cp site\/v1\/\*\.html[^\n]*\s_site\/\s*$/m);
  });

  it('NoRedirectStubMachinery_RemainsInTheWorkflow', () => {
    // Issue #921 v0-isolation: the redirect-stub approach is removed entirely.
    // Old pre-move URLs 404 to the honest static page instead.
    expect(workflow(), 'a redirect-stub step lingers in the workflow').not.toContain('build-v0-redirect-stubs');
  });

  it('V1SharedModulesAndData_AreDeployedAtTheRoot_ForSelfContainment', () => {
    // Issue #921 v0-isolation: the v1 callsign page must resolve entirely from
    // the root, so the shared modules and the prefix-sharded data are deployed
    // beside the v1 pages rather than reached for under _site/v0.
    const block = jobBlock(workflow(), 'build-site-databases');
    expect(block, 'the shared-module deploy step is missing').toContain('node src/ci/build-v1-shared-modules.ts site _site');
    expect(block, 'the callsign data is not hard-linked to the root').toContain('cp -al _site/v0/callsign/data/. _site/callsign/data/');
  });

  it('HomeHoldingsManifest_IsBuiltAtTheRoot_AfterTheCallsignData', () => {
    // Issue #921 span dial: the home holdings manifest (per-publication marks +
    // cited milestones) is derived from the root callsign manifest, so it must be
    // built into the bare root AFTER the callsign data is hard-linked there.
    const block = jobBlock(workflow(), 'build-site-databases');
    expect(block, 'the home holdings build step is missing').toContain('node src/ci/build-home-holdings.ts _site');
    const dataAtRoot = block.indexOf('cp -al _site/v0/callsign/data/. _site/callsign/data/');
    const holdings = block.indexOf('node src/ci/build-home-holdings.ts _site');
    expect(dataAtRoot).toBeGreaterThan(-1);
    expect(holdings, 'the holdings manifest is built before the callsign data reaches the root').toBeGreaterThan(dataAtRoot);
  });

  it('RootDiscoveryFiles_AreBuilt_AtTheDeployRoot', () => {
    // Issue #921: the slim root sitemap + robots.txt for the v1 launch, built
    // into the bare _site root.
    const block = jobBlock(workflow(), 'build-site-databases');
    expect(block, 'the root discovery build step is missing').toContain(
      'node src/ci/build-root-discovery.ts _site https://mysteraitch.github.io/amateur-callsigns-file-watch',
    );
  });

  it('BuildCaches_UseTheTestExcludingClosureHash_NotBareHashFiles', () => {
    // #517: build-cache keys are the test-excluding closure hash, so a test-only
    // change no longer rebuilds the corpus. A regression to `hashFiles(...)` would
    // pull the co-located *.test.ts back into the key. Guard both directions.
    const wf = workflow();
    expect(wf, 'a cache key regressed to hashFiles(...) — test edits will rebuild the corpus').not.toMatch(/hashFiles\(/);
    expect(wf, 'the closure-hash action is no longer used for the build caches').toMatch(/uses: \.\/\.github\/actions\/closure-hash/);
    // The composite action the keys depend on must exist.
    expect(fs.existsSync(CLOSURE_ACTION), `${CLOSURE_ACTION} is missing`).toBe(true);
  });

  it('UploadArtifactSteps_WithADotDirectoryPath_DeclareIncludeHiddenFiles', () => {
    // upload-artifact excludes hidden (dot-prefixed) files by default, so an
    // artifact whose path is a dot-directory silently uploads nothing — the
    // #354 perf-report record never once reached an artifact across a 30-run
    // sample (#929). Every upload step whose path begins with a dot must set
    // include-hidden-files, so the next dot-directory artifact cannot regress.
    const doc = yaml.load(fs.readFileSync(WORKFLOW, 'utf8')) as {
      jobs?: Record<string, { steps?: { uses?: string; with?: Record<string, unknown> }[] }>;
    };
    const offenders: string[] = [];
    for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        if (typeof step.uses !== 'string' || !step.uses.includes('actions/upload-artifact')) continue;
        const withBlock = step.with ?? {};
        const rawPath = withBlock.path;
        // A path may be a single string or a multi-line block of several paths;
        // a dot-prefix on ANY line makes hidden files reachable under it.
        const pathLines = typeof rawPath === 'string' ? rawPath.split('\n') : [];
        const hasDotPath = pathLines.some(line => line.trim().startsWith('.'));
        if (hasDotPath && withBlock['include-hidden-files'] !== true) {
          const artifactName = typeof withBlock.name === 'string' ? withBlock.name : '(unnamed)';
          offenders.push(`${jobName}: ${artifactName} -> ${String(rawPath).replace(/\n/g, ',')}`);
        }
      }
    }
    expect(
      offenders,
      'these upload-artifact steps have a dot-directory path but no include-hidden-files: true — they upload nothing',
    ).toEqual([]);
  });

  it('GoldenMasterClosurePaths_CoverTheReportSweepImportGraph_SoNarrowingCannotSilentlyOvercache', () => {
    // The golden cache key hashes the report sweep's DECLARED input closure. That
    // closure was narrowed off the whole src/ci directory to report-sweep.ts's
    // actual import graph (#929), because src/ci mixes the sweep's dependencies
    // with unrelated site/page builders. A narrow declared set is only safe while
    // it still covers every real input: an import that escaped it would let the
    // key ignore a genuine input and serve a STALE hit. Recompute the sweep's
    // transitive import graph from source and assert every reached file is covered
    // by a declared path — so the list can be narrow yet cannot silently rot.
    const declared = closurePathsIn(jobBlock(workflow(), 'golden-master'));
    const closure = importClosure(path.join(process.cwd(), 'src', 'ci', 'report-sweep.ts'));
    const uncovered = closure.filter(file => !isCovered(file, declared));
    expect(
      uncovered,
      'these report-sweep imports are NOT under the golden-master closure paths — the cache could serve a stale report; add each to the paths: list',
    ).toEqual([]);
    // And the narrowing itself must not silently regress: hashing the whole
    // mixed-concern src/ci directory again would re-cover everything (passing the
    // check above) while reinstating the false-miss churn the narrowing removed.
    expect(
      declared,
      'the golden-master closure hashes the whole src/ci directory again — the #929 narrowing to the sweep import graph was reverted',
    ).not.toContain('src/ci');
  });
});
