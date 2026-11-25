import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The data sweep's shell step, EXECUTED: the step's script is lifted out of
// the workflow file and run by bash against real temporary git repositories,
// with a stand-in `gh` that answers from a state directory and records every
// call. The sibling structure test pins the script's text; this pins what the
// script does, which is the only way to see a fault in its control flow.
//
// It exists because of the 22 September 2026 publication. `gh pr create`
// answered HTTP 502 after the pull request had been created, the step stopped
// there, and every later sweep saw an open pull request and moved on - so the
// pull request never had auto-merge enabled, an assignee, or a digest entry.
//
// The stand-in `gh` evaluates `--jq` with the real jq, and the script is bash,
// so this runs on Linux (CI) and is skipped on Windows, where neither is a
// given. On Linux a missing bash or jq is a failure, not a skip.

const WORKFLOW = path.join('.github', 'workflows', 'data-sweep.yml');
const STEP_NAME = 'Open PRs for data branches';
const PR_URL = 'https://github.test/example/repo/pull/7';
const RUNS_HERE = process.platform !== 'win32';

interface WorkflowShape {
  jobs: { sweep: { steps: Array<{ name?: string; run?: string }> } };
}

function sweepScript(): string {
  const wf = yaml.load(fs.readFileSync(WORKFLOW, 'utf8')) as WorkflowShape;
  const step = wf.jobs.sweep.steps.find((s) => s.name === STEP_NAME);
  if (step?.run === undefined) throw new Error(`step "${STEP_NAME}" not found in ${WORKFLOW}`);
  return step.run;
}

// Answers from files in $GH_STUB_DIR and appends each call to calls.log.
//   pr.json                      what `gh pr list` returns (a JSON array)
//   create-fails-after-creating  `pr create` creates the pull request, then exits 1
//   create-fails                 `pr create` exits 1 and creates nothing
//   merge-fails                  `pr merge` exits 1
const GH_STUB = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$GH_STUB_DIR/calls.log"
jq_expr=""
args=("$@")
for ((i = 0; i < \${#args[@]}; i++)); do
  if [ "\${args[i]}" = "--jq" ]; then jq_expr="\${args[i + 1]}"; fi
done
emit() { if [ -n "$jq_expr" ]; then jq -r "$jq_expr"; else cat; fi; }
created='[{"number":7,"url":"${PR_URL}","autoMergeRequest":null,"assignees":[],"comments":[]}]'
case "$1 $2" in
  "pr list") emit < "$GH_STUB_DIR/pr.json" ;;
  "pr create")
    if [ -f "$GH_STUB_DIR/create-fails" ]; then echo "pull request create failed" >&2; exit 1; fi
    echo "$created" > "$GH_STUB_DIR/pr.json"
    if [ -f "$GH_STUB_DIR/create-fails-after-creating" ]; then
      echo "pull request create failed: HTTP 502: 502 Bad Gateway" >&2
      exit 1
    fi
    echo "${PR_URL}"
    ;;
  "pr merge") if [ -f "$GH_STUB_DIR/merge-fails" ]; then exit 1; fi ;;
  "pr edit" | "pr comment" | "issue comment") ;;
  "issue list") echo '[{"number":5,"title":"Data landings (rolling digest)"}]' | emit ;;
  "issue create") echo "https://github.test/example/repo/issues/5" ;;
  "api repos/example/repo") echo '{"owner":{"login":"the-owner"}}' | emit ;;
  *) echo "gh stand-in: unexpected call: $*" >&2; exit 97 ;;
esac
`;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

describe.skipIf(!RUNS_HERE)('data sweep step, executed', { tags: ['unit'] }, () => {
  let root: string;
  let origin: string;
  let runner: string; // plays the workflow's checkout of main
  let host: string; // plays the fetch host pushing data/* branches
  let stubDir: string;

  beforeAll(() => {
    for (const tool of ['bash', 'jq']) {
      const probe = spawnSync(tool, ['--version'], { encoding: 'utf8' });
      if (probe.status !== 0) throw new Error(`${tool} is required to execute the sweep step and was not found`);
    }
  });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'callsigns-sweep-'));
    origin = path.join(root, 'origin.git');
    runner = path.join(root, 'runner');
    host = path.join(root, 'host');
    stubDir = path.join(root, 'gh-state');
    const binDir = path.join(root, 'bin');

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

    fs.mkdirSync(stubDir);
    fs.writeFileSync(path.join(stubDir, 'pr.json'), '[]\n');
    fs.writeFileSync(path.join(stubDir, 'calls.log'), '');
    fs.mkdirSync(binDir);
    fs.writeFileSync(path.join(binDir, 'gh'), GH_STUB, { mode: 0o755 });
    fs.writeFileSync(path.join(root, 'sweep.sh'), sweepScript());
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
  }

  function openPullRequest(fields: { autoMerge?: boolean; assignees?: string[]; comments?: string[] }): void {
    const pr = {
      number: 7,
      url: PR_URL,
      autoMergeRequest: fields.autoMerge === true ? { mergeMethod: 'MERGE' } : null,
      assignees: (fields.assignees ?? []).map((login) => ({ login })),
      comments: (fields.comments ?? []).map((body) => ({ body })),
    };
    fs.writeFileSync(path.join(stubDir, 'pr.json'), `${JSON.stringify([pr])}\n`);
  }

  function flag(name: string): void {
    fs.writeFileSync(path.join(stubDir, name), '');
  }

  function runSweep(): { status: number | null; output: string } {
    // A real run checks main out as the job starts, so its view of main is
    // current; the step itself fetches only data/*.
    git(runner, 'pull', '--quiet', '--ff-only');
    const result = spawnSync('bash', [path.join(root, 'sweep.sh')], {
      cwd: runner,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
        GH_STUB_DIR: stubDir,
        GITHUB_REPOSITORY: 'example/repo',
      },
    });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  }

  // The first two words of each recorded call, in order: what the step did.
  function calls(): string[] {
    return fs
      .readFileSync(path.join(stubDir, 'calls.log'), 'utf8')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => line.split(' ').slice(0, 2).join(' '));
  }

  function callLines(): string[] {
    return fs.readFileSync(path.join(stubDir, 'calls.log'), 'utf8').split('\n').filter((line) => line.length > 0);
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
