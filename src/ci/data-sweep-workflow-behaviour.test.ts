import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FOREIGN_PR_URL, GhStandIn, PR_URL, RUNS_HERE, git, requireBashAndJq, stepScript } from './sweep-step-harness.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The data sweep's shell step, EXECUTED: the step's script is lifted out of
// the workflow file and run by bash against real temporary git repositories,
// with a stand-in `gh` that answers from a state directory and records every
// call (sweep-step-harness.ts). The sibling structure test pins the script's
// text; this pins what the script does, which is the only way to see a fault
// in its control flow.
//
// It exists because of the 22 September 2026 publication. `gh pr create`
// answered HTTP 502 after the pull request had been created, the step stopped
// there, and every later sweep saw an open pull request and moved on - so the
// pull request never had auto-merge enabled, an assignee, or a digest entry.

const WORKFLOW = path.join('.github', 'workflows', 'data-sweep.yml');
const STEP_NAME = 'Open PRs for data branches';

describe.skipIf(!RUNS_HERE)('data sweep step, executed', { tags: ['unit'] }, () => {
  let root: string;
  let origin: string;
  let runner: string; // plays the workflow's checkout of main
  let host: string; // plays the fetch host pushing data/* branches
  let gh: GhStandIn;

  beforeAll(requireBashAndJq);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'callsigns-sweep-'));
    origin = path.join(root, 'origin.git');
    runner = path.join(root, 'runner');
    host = path.join(root, 'host');

    execFileSync('git', ['init', '--bare', '--initial-branch=main', origin], { stdio: 'pipe' });
    execFileSync('git', ['clone', origin, host], { stdio: 'pipe' });
    git(host, 'config', 'user.name', 'Fetch Host');
    git(host, 'config', 'user.email', 'host@test.invalid');
    fs.mkdirSync(path.join(host, 'archive', '2026-01-01'), { recursive: true });
    fs.writeFileSync(path.join(host, 'archive', '2026-01-01', 'raw.csv'), 'seed\n');
    git(host, 'add', '-A');
    git(host, 'commit', '-m', 'seed');
    git(host, 'push', 'origin', 'main');
    execFileSync('git', ['clone', origin, runner], { stdio: 'pipe' });

    gh = new GhStandIn(root);
    fs.writeFileSync(path.join(root, 'sweep.sh'), stepScript(WORKFLOW, 'sweep', STEP_NAME));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function pushDataBranch(archiveKey: string, extraPath?: string): void {
    const entry = path.join(host, 'archive', archiveKey);
    fs.mkdirSync(entry, { recursive: true });
    fs.writeFileSync(path.join(entry, 'raw.csv'), `data-for-${archiveKey}\n`);
    if (extraPath !== undefined) {
      fs.mkdirSync(path.dirname(path.join(host, extraPath)), { recursive: true });
      fs.writeFileSync(path.join(host, extraPath), 'not data\n');
    }
    git(host, 'add', '-A');
    git(host, 'commit', '-m', `Update amateur callsigns CSV (${archiveKey})`);
    git(host, 'push', 'origin', `HEAD:refs/heads/data/${archiveKey}`);
    gh.setTip(git(host, 'rev-parse', 'HEAD'));
  }

  // An open pull request whose head branch has the data branch's name. By
  // default it is the repository's own, at the branch tip. `fromAFork` makes
  // it someone else's branch of the same name, which a lookup by head name
  // also returns; `head` puts it at a commit other than the branch tip.
  function openPullRequest(fields: {
    autoMerge?: boolean;
    assignees?: string[];
    comments?: string[];
    fromAFork?: boolean;
    head?: string;
  }): void {
    gh.openPullRequest({ ...fields, head: fields.head ?? gh.tip() });
  }

  const flag = (name: string): void => gh.flag(name);
  const calls = (): string[] => gh.calls();
  const callLines = (): string[] => gh.callLines();
  const callsNaming = (prUrl: string): string[] => gh.callsNaming(prUrl);

  function runSweep(): { status: number | null; output: string } {
    // A real run checks main out as the job starts, so its view of main is
    // current; the step itself fetches only data/*.
    git(runner, 'pull', '--quiet', '--ff-only');
    const result = spawnSync('bash', [path.join(root, 'sweep.sh')], {
      cwd: runner,
      encoding: 'utf8',
      env: gh.env(),
    });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  }

  const FINISHING_CALLS = ['pr merge', 'api repos/example/repo', 'pr edit', 'issue list', 'issue comment'];

  it('DataBranch_WhenNewAndDataOnly_IsOpenedAutoMergedAssignedAndRecorded', () => {
    pushDataBranch('2026-07-06');

    const run = runSweep();

    expect(run.status, run.output).toBe(0);
    expect(calls()).toEqual(['pr list', 'pr create', ...FINISHING_CALLS]);
    expect(callLines().find((l) => l.startsWith('pr merge'))).toBe(`pr merge --auto --merge --delete-branch ${PR_URL}`);
    expect(callLines().find((l) => l.startsWith('pr edit'))).toBe(`pr edit ${PR_URL} --add-assignee the-owner`);
  });

  it('DataBranch_WhenCreateReportsFailureButThePullRequestExists_IsStillFinished', () => {
    // 22 September 2026, sweep run 35754290502: HTTP 502 from the create call,
    // and the pull request was there all the same.
    pushDataBranch('2026-07-06');
    flag('create-fails-after-creating');

    const run = runSweep();

    expect(run.status, run.output).toBe(0);
    expect(calls()).toEqual(['pr list', 'pr create', 'pr list', ...FINISHING_CALLS]);
  });

  it('DataBranch_WhenCreateFailsAndNoPullRequestExists_FailsTheJobWithoutMerging', () => {
    pushDataBranch('2026-07-06');
    flag('create-fails');

    const run = runSweep();

    expect(run.status, run.output).not.toBe(0);
    expect(calls()).not.toContain('pr merge');
    expect(calls()).not.toContain('issue comment');
  });

  it('DataBranch_WhenAnOpenPullRequestWasNeverSetUp_IsFinishedByTheNextSweep', () => {
    // What every sweep after the 502 found: an open pull request with no
    // auto-merge, no assignee, and no comment.
    pushDataBranch('2026-07-06');
    openPullRequest({});

    const run = runSweep();

    expect(run.status, run.output).toBe(0);
    expect(calls()).toEqual(['pr list', ...FINISHING_CALLS]);
    expect(calls()).not.toContain('pr create');
  });

  it('DataBranch_WhenItsPullRequestAlreadyHasAutoMerge_IsLeftAlone', () => {
    pushDataBranch('2026-07-06');
    openPullRequest({ autoMerge: true, assignees: ['the-owner'] });

    const run = runSweep();

    expect(run.status, run.output).toBe(0);
    expect(calls()).toEqual(['pr list']);
  });

  it('DataBranch_WhenAPersonTurnedAutoMergeOff_IsNotTurnedBackOn', () => {
    // The assignee marks a pull request the sweep finished once. Someone who
    // then holds it by disabling auto-merge must not be overridden.
    pushDataBranch('2026-07-06');
    openPullRequest({ autoMerge: false, assignees: ['the-owner'] });

    const run = runSweep();

    expect(run.status, run.output).toBe(0);
    expect(calls()).toEqual(['pr list']);
  });

  it('DataBranch_WhenItsPullRequestWasParkedWithAComment_IsNotCommentedOnAgain', () => {
    pushDataBranch('2026-07-06');
    openPullRequest({ comments: ['Auto-merge could not be enabled - this data PR is parked for attention.'] });

    const run = runSweep();

    expect(run.status, run.output).toBe(0);
    expect(calls()).toEqual(['pr list']);
  });

  it('DataBranch_WhenAutoMergeCannotBeEnabled_IsParkedAndTheJobFails', () => {
    pushDataBranch('2026-07-06');
    flag('merge-fails');

    const run = runSweep();

    expect(run.status, run.output).not.toBe(0);
    expect(calls()).toEqual(['pr list', 'pr create', 'pr merge', 'pr comment']);
  });

  it('DataBranch_WhenItTouchesANonDataPath_IsOpenedForReviewAndNeverAutoMerged', () => {
    pushDataBranch('2026-07-06', 'src/smuggled.ts');

    const run = runSweep();

    expect(run.status, run.output).toBe(0);
    expect(calls()).toEqual(['pr list', 'pr create', 'pr comment']);
    expect(callLines().find((l) => l.startsWith('pr comment'))).toContain('needs human review');
  });

  it('DataBranch_WhenANonDataPullRequestWasNeverSetUp_GetsItsReviewCommentAndNoAutoMerge', () => {
    pushDataBranch('2026-07-06', 'src/smuggled.ts');
    openPullRequest({});

    const run = runSweep();

    expect(run.status, run.output).toBe(0);
    expect(calls()).toEqual(['pr list', 'pr comment']);
  });

  // The allowlist is judged on the repository's own data branch, so the sweep
  // may only ever act on a pull request that is that branch at that commit.
  // Anyone can open a pull request from a fork whose branch carries a data
  // branch's name, and a lookup by head name returns it.
  it('DataBranch_WhenAForkHoldsAPullRequestOfTheSameName_OpensItsOwnAndNeverMergesTheForks', () => {
    pushDataBranch('2026-07-06');
    openPullRequest({ fromAFork: true });

    const run = runSweep();

    expect(run.status, run.output).toBe(0);
    expect(calls()).toEqual(['pr list', 'pr create', ...FINISHING_CALLS]);
    expect(callsNaming(FOREIGN_PR_URL)).toEqual([]);
    // The same search does find the sweep's own pull request, so the empty
    // result above is not a search that can find nothing.
    expect(callsNaming(PR_URL).length).toBeGreaterThan(0);
    expect(callLines().find((l) => l.startsWith('pr merge'))).toBe(`pr merge --auto --merge --delete-branch ${PR_URL}`);
  });

  it('DataBranch_WhenOnlyAForksPullRequestExistsAndCreateFails_FailsTheJobWithoutMerging', () => {
    pushDataBranch('2026-07-06');
    openPullRequest({ fromAFork: true });
    flag('create-fails');

    const run = runSweep();

    expect(run.status, run.output).not.toBe(0);
    expect(calls()).toEqual(['pr list', 'pr create', 'pr list']);
    expect(callsNaming(FOREIGN_PR_URL)).toEqual([]);
  });

  it('DataBranch_WhenAnOpenPullRequestIsNotAtTheBranchTip_IsNotActedOn', () => {
    // What was judged against the allowlist is the tip; a pull request at any
    // other commit is not the thing that was judged.
    pushDataBranch('2026-07-06');
    openPullRequest({ head: '0000000000000000000000000000000000000000' });
    flag('create-fails');

    const run = runSweep();

    expect(run.status, run.output).not.toBe(0);
    expect(calls()).not.toContain('pr merge');
    expect(calls()).not.toContain('pr edit');
  });

  it('DataBranch_WhenAlreadyMergedIntoMain_IsDeletedWithoutTouchingPullRequests', () => {
    pushDataBranch('2026-07-06');
    git(host, 'push', 'origin', 'HEAD:refs/heads/main');

    const run = runSweep();

    expect(run.status, run.output).toBe(0);
    expect(calls()).toEqual([]);
    expect(() => git(origin, 'rev-parse', '--verify', 'refs/heads/data/2026-07-06')).toThrow();
  });

  it('Sweep_WhenThereAreNoDataBranches_DoesNothing', () => {
    const run = runSweep();

    expect(run.status, run.output).toBe(0);
    expect(calls()).toEqual([]);
  });
});
