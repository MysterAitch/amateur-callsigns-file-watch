import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GhStandIn, RUNS_HERE, git, requireBashAndJq, stepScript } from './sweep-step-harness.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The report sweep's pull request step, EXECUTED against real temporary git
// repositories and the stand-in `gh` (sweep-step-harness.ts). The sibling
// structure test pins the script's text; this pins what it does.
//
// A report pull request is opened by the Actions bot, so its ordinary checks
// park awaiting approval and the step dispatches them onto the branch itself.
// A pull request that exists without that dispatch can never go green, which
// is what is pinned here: once the pull request exists, the dispatch happens.

const WORKFLOW = path.join('.github', 'workflows', 'reports-sweep.yml');
const STEP_NAME = 'Open PR for changed reports';
const TOKEN = 'stand-in-token';
const PUSH_URL = `https://x-access-token:${TOKEN}@github.com/example/repo.git`;
const COVERAGE = '## Coverage\n\nAll 3 entries reported.\n';

describe.skipIf(!RUNS_HERE)('report sweep pull request step, executed', { tags: ['unit'] }, () => {
  let root: string;
  let origin: string;
  let runner: string; // plays the workflow's checkout of main
  let coverageFile: string;
  let runnerTemp: string;
  let gh: GhStandIn;

  beforeAll(requireBashAndJq);

  // A run's checkout: a fresh clone of main, as each attempt of a run gets.
  // The step pushes to a tokenised github.com address, which is pointed at
  // the temporary origin for this checkout only.
  function checkOutRunner(): void {
    fs.rmSync(runner, { recursive: true, force: true });
    execFileSync('git', ['clone', origin, runner], { stdio: 'pipe' });
    git(runner, 'config', `url.${origin}.insteadOf`, PUSH_URL);
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'callsigns-reports-sweep-'));
    origin = path.join(root, 'origin.git');
    runner = path.join(root, 'runner');
    coverageFile = path.join(root, 'coverage.md');
    runnerTemp = path.join(root, 'runner-temp');
    const seed = path.join(root, 'seed');

    execFileSync('git', ['init', '--bare', '--initial-branch=main', origin], { stdio: 'pipe' });
    execFileSync('git', ['clone', origin, seed], { stdio: 'pipe' });
    git(seed, 'config', 'user.name', 'Seed');
    git(seed, 'config', 'user.email', 'seed@test.invalid');
    fs.mkdirSync(path.join(seed, 'reports'));
    fs.writeFileSync(path.join(seed, 'reports', 'summary.md'), 'two publications\n');
    fs.writeFileSync(path.join(seed, 'unrelated.txt'), 'as committed\n');
    git(seed, 'add', '-A');
    git(seed, 'commit', '-m', 'seed');
    git(seed, 'push', 'origin', 'HEAD:refs/heads/main');
    checkOutRunner();

    fs.mkdirSync(runnerTemp);
    gh = new GhStandIn(root);
    fs.writeFileSync(path.join(root, 'step.sh'), stepScript(WORKFLOW, 'reports', STEP_NAME));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  // What the sweep step leaves behind: regenerated reports in the working
  // tree, and the coverage report that accounts for them.
  function sweepRegeneratedAReport(): void {
    fs.writeFileSync(path.join(runner, 'reports', 'summary.md'), 'three publications\n');
    fs.writeFileSync(coverageFile, COVERAGE);
  }

  function runStep(attempt = 1): { status: number | null; output: string } {
    const committedAt = `2026-01-01T00:00:0${attempt}Z`;
    const result = spawnSync('bash', [path.join(root, 'step.sh')], {
      cwd: runner,
      encoding: 'utf8',
      env: {
        ...gh.env(),
        GH_TOKEN: TOKEN,
        RUN_ID: '4242',
        RUN_ATTEMPT: String(attempt),
        COVERAGE_FILE: coverageFile,
        RUNNER_TEMP: runnerTemp,
        // Two attempts of one run commit the same content at different
        // times, so they are different commits.
        GIT_AUTHOR_DATE: committedAt,
        GIT_COMMITTER_DATE: committedAt,
      },
    });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  }

  function reportBranchesOnOrigin(): string[] {
    return git(origin, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/reports/')
      .split('\n')
      .filter((name) => name.length > 0);
  }

  it('ReportSweep_WhenNoReportChanged_OpensNothing', () => {
    fs.writeFileSync(coverageFile, COVERAGE);

    const run = runStep();

    expect(run.status, run.output).toBe(0);
    expect(gh.calls()).toEqual([]);
    expect(reportBranchesOnOrigin()).toEqual([]);
  });

  it('ReportSweep_WhenTheSweepLeftNoCoverageReport_PushesNothingFromTheUnaccountedTree', () => {
    fs.writeFileSync(path.join(runner, 'reports', 'summary.md'), 'half written\n');

    const run = runStep();

    expect(run.status, run.output).toBe(0);
    expect(gh.calls()).toEqual([]);
    expect(reportBranchesOnOrigin()).toEqual([]);
  });

  it('ReportSweep_WhenAReportChanged_OpensAPullRequestOfReportsOnlyAndDispatchesItsChecks', () => {
    sweepRegeneratedAReport();
    fs.writeFileSync(path.join(runner, 'unrelated.txt'), 'changed by something the sweep ran\n');

    const run = runStep();

    expect(run.status, run.output).toBe(0);
    expect(gh.calls()).toEqual(['pr create', 'workflow run']);
    expect(gh.callLines()[1]).toBe('workflow run cicd.yaml --ref reports/run-4242-1');
    expect(reportBranchesOnOrigin()).toEqual(['reports/run-4242-1']);
    expect(git(origin, 'diff', '--name-only', 'main', 'reports/run-4242-1')).toBe('reports/summary.md');
    expect(fs.readFileSync(path.join(runnerTemp, 'pr-body.md'), 'utf8')).toContain('All 3 entries reported.');
  });

  it('ReportSweep_WhenCreateReportsFailureButThePullRequestExists_StillDispatchesItsChecks', () => {
    // The create call can answer with an error after creating the pull
    // request; the incident is recorded in data-sweep.yml.
    sweepRegeneratedAReport();
    gh.flag('create-fails-after-creating');

    const run = runStep();

    expect(run.status, run.output).toBe(0);
    expect(gh.calls()).toEqual(['pr create', 'pr list', 'workflow run']);
    expect(gh.callLines()[2]).toBe('workflow run cicd.yaml --ref reports/run-4242-1');
  });

  it('ReportSweep_WhenCreateFailsAndNoPullRequestExists_FailsTheJobWithoutDispatching', () => {
    sweepRegeneratedAReport();
    gh.flag('create-fails');

    const run = runStep();

    expect(run.status, run.output).not.toBe(0);
    expect(gh.calls()).not.toContain('workflow run');
  });

  it('ReportSweep_WhenCreateFailsAndOnlyAForksPullRequestOfThatNameExists_FailsTheJobWithoutDispatching', () => {
    // A lookup by head name also returns a fork's pull request from a branch
    // of the same name. It is not the one this run tried to open.
    sweepRegeneratedAReport();
    gh.openPullRequest({ headName: 'reports/run-4242-1', head: 'a'.repeat(40), fromAFork: true });
    gh.flag('create-fails');

    const run = runStep();

    expect(run.status, run.output).not.toBe(0);
    expect(gh.calls()).toEqual(['pr create', 'pr list']);
  });

  it('ReportSweep_WhenAFailedRunIsRunAgain_OpensItsPullRequestFromAFreshBranch', () => {
    // Re-running a failed run keeps its run id. The first attempt's branch is
    // already on the remote, holding a different commit.
    sweepRegeneratedAReport();
    gh.flag('create-fails');
    expect(runStep(1).status).not.toBe(0);

    fs.rmSync(path.join(gh.stateDir, 'create-fails'));
    checkOutRunner();
    sweepRegeneratedAReport();
    const rerun = runStep(2);

    expect(rerun.status, rerun.output).toBe(0);
    expect(reportBranchesOnOrigin()).toEqual(['reports/run-4242-1', 'reports/run-4242-2']);
    expect(gh.callLines().at(-1)).toBe('workflow run cicd.yaml --ref reports/run-4242-2');
  });
});
