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
});
