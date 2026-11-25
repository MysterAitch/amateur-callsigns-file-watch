import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FOREIGN_PR_URL, GhStandIn, PR_URL, RUNS_HERE, git, requireBashAndJq, stepScript } from './sweep-step-harness.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The Special Contest Calls sweep's writeback step, EXECUTED against real
// temporary git repositories and the stand-in `gh` (sweep-step-harness.ts).
// The step opens one review pull request for a changed table and assigns it;
// what is pinned here is that a pull request it opened is never left without
// an assignee, and that only this repository's own pull request can hold a
// later refresh back.

const WORKFLOW = path.join('.github', 'workflows', 'scc-sweep.yml');
const STEP_NAME = 'Open a review PR when the table changed';
const TABLE = path.join('reference-data', 'rsgb-special-contest-calls.csv');
const EARLIER_BRANCH = 'data/scc-2026-01-01';

describe.skipIf(!RUNS_HERE)('Special Contest Calls sweep step, executed', { tags: ['unit'] }, () => {
  let root: string;
  let origin: string;
  let runner: string; // plays the workflow's checkout of main
  let gh: GhStandIn;

  beforeAll(requireBashAndJq);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'callsigns-scc-sweep-'));
    origin = path.join(root, 'origin.git');
    runner = path.join(root, 'runner');
    const seed = path.join(root, 'seed');

    execFileSync('git', ['init', '--bare', '--initial-branch=main', origin], { stdio: 'pipe' });
    execFileSync('git', ['clone', origin, seed], { stdio: 'pipe' });
    git(seed, 'config', 'user.name', 'Seed');
    git(seed, 'config', 'user.email', 'seed@test.invalid');
    fs.mkdirSync(path.join(seed, 'reference-data'));
    fs.writeFileSync(path.join(seed, TABLE), 'callsign,holder,status\nG1A,Someone,current\n');
    fs.writeFileSync(path.join(seed, 'reference-data', 'rsgb-special-contest-calls.meta.json'), '{"fetched":"2026-01-01"}\n');
    git(seed, 'add', '-A');
    git(seed, 'commit', '-m', 'seed');
    git(seed, 'push', 'origin', 'HEAD:refs/heads/main');
    execFileSync('git', ['clone', origin, runner], { stdio: 'pipe' });

    gh = new GhStandIn(root);
    fs.writeFileSync(path.join(root, 'step.sh'), stepScript(WORKFLOW, 'refresh', STEP_NAME));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  // What the fetch step leaves behind when the source page changed.
  function tableChanged(): void {
    fs.appendFileSync(path.join(runner, TABLE), 'G2B,Someone Else,current\n');
  }

  function runStep(): { status: number | null; output: string } {
    const result = spawnSync('bash', [path.join(root, 'step.sh')], {
      cwd: runner,
      encoding: 'utf8',
      env: { ...gh.env(), SUMMARY: 'added: G2B' },
    });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  }

  function refreshBranchesOnOrigin(): string[] {
    return git(origin, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/data/')
      .split('\n')
      .filter((name) => name.length > 0);
  }

  const ASSIGNING_CALLS = ['api repos/example/repo', 'pr edit'];

  it('SccSweep_WhenTheTableIsUnchanged_OpensNothing', () => {
    const run = runStep();

    expect(run.status, run.output).toBe(0);
    expect(gh.calls()).toEqual([]);
    expect(refreshBranchesOnOrigin()).toEqual([]);
  });

  it('SccSweep_WhenTheTableChanged_OpensAPullRequestAndAssignsIt', () => {
    tableChanged();

    const run = runStep();

    expect(run.status, run.output).toBe(0);
    expect(gh.calls()).toEqual(['pr list', 'pr create', ...ASSIGNING_CALLS]);
    expect(gh.callLines().find((l) => l.startsWith('pr edit'))).toBe(`pr edit ${PR_URL} --add-assignee the-owner`);
    expect(refreshBranchesOnOrigin()).toHaveLength(1);
    // The pushed branch carries the changed table and nothing else.
    const [branch] = refreshBranchesOnOrigin();
    expect(git(origin, 'diff', '--name-only', 'main', branch ?? '')).toBe('reference-data/rsgb-special-contest-calls.csv');
  });

  it('SccSweep_WhenCreateReportsFailureButThePullRequestExists_IsStillAssigned', () => {
    // The create call can answer with an error after creating the pull
    // request; the incident is recorded in data-sweep.yml.
    tableChanged();
    gh.flag('create-fails-after-creating');

    const run = runStep();

    expect(run.status, run.output).toBe(0);
    expect(gh.calls()).toEqual(['pr list', 'pr create', 'pr list', ...ASSIGNING_CALLS]);
    expect(gh.callLines().find((l) => l.startsWith('pr edit'))).toBe(`pr edit ${PR_URL} --add-assignee the-owner`);
  });

  it('SccSweep_WhenCreateFailsAndNoPullRequestExists_FailsTheJobWithoutAssigning', () => {
    tableChanged();
    gh.flag('create-fails');

    const run = runStep();

    expect(run.status, run.output).not.toBe(0);
    expect(gh.calls()).not.toContain('pr edit');
  });

  it('SccSweep_WhenAnEarlierRefreshIsOpenAndAssigned_LeavesItForReviewWithoutStacking', () => {
    tableChanged();
    gh.openPullRequest({ headName: EARLIER_BRANCH, head: 'a'.repeat(40), assignees: ['the-owner'] });

    const run = runStep();

    expect(run.status, run.output).toBe(0);
    expect(gh.calls()).toEqual(['pr list']);
    expect(refreshBranchesOnOrigin()).toEqual([]);
  });

  it('SccSweep_WhenAnEarlierRefreshIsOpenButUnassigned_AssignsItWithoutStacking', () => {
    // What a later month's run finds after a run that stopped between
    // creating the pull request and assigning it.
    tableChanged();
    gh.openPullRequest({ headName: EARLIER_BRANCH, head: 'a'.repeat(40) });

    const run = runStep();

    expect(run.status, run.output).toBe(0);
    expect(gh.calls()).toEqual(['pr list', ...ASSIGNING_CALLS]);
    expect(gh.callLines().find((l) => l.startsWith('pr edit'))).toBe(`pr edit ${PR_URL} --add-assignee the-owner`);
    expect(refreshBranchesOnOrigin()).toEqual([]);
  });

  it('SccSweep_WhenAnotherKindOfPullRequestIsOpen_StillOpensTheRefresh', () => {
    tableChanged();
    gh.openPullRequest({ headName: 'data/2026-09-22', head: 'a'.repeat(40) });

    const run = runStep();

    expect(run.status, run.output).toBe(0);
    expect(gh.calls()).toEqual(['pr list', 'pr create', ...ASSIGNING_CALLS]);
  });

  // Anyone can open a pull request from a fork whose branch carries a refresh
  // branch's name. It is not a refresh awaiting review, so it neither holds
  // the real one back nor gets assigned.
  it('SccSweep_WhenAForkHoldsAPullRequestOfTheSameName_OpensItsOwnAndLeavesTheForksAlone', () => {
    tableChanged();
    gh.openPullRequest({ headName: EARLIER_BRANCH, head: 'a'.repeat(40), fromAFork: true });

    const run = runStep();

    expect(run.status, run.output).toBe(0);
    expect(gh.calls()).toEqual(['pr list', 'pr create', ...ASSIGNING_CALLS]);
    expect(gh.callsNaming(FOREIGN_PR_URL)).toEqual([]);
    // The same search does find the sweep's own pull request, so the empty
    // result above is not a search that can find nothing.
    expect(gh.callsNaming(PR_URL).length).toBeGreaterThan(0);
  });

  it('SccSweep_WhenOnlyAForksPullRequestExistsAndCreateFails_FailsTheJobWithoutTouchingTheForks', () => {
    // The fork's branch carries the very name this run pushes, so nothing
    // but its being a fork's tells it apart in the lookup after the create.
    tableChanged();
    const todaysBranch = `data/scc-${new Date().toISOString().slice(0, 10)}`;
    gh.openPullRequest({ headName: todaysBranch, head: 'a'.repeat(40), fromAFork: true });
    gh.flag('create-fails');

    const run = runStep();

    expect(run.status, run.output).not.toBe(0);
    expect(gh.calls()).toEqual(['pr list', 'pr create', 'pr list']);
    expect(gh.callsNaming(FOREIGN_PR_URL)).toEqual([]);
  });
});
