import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { dataBranchName, gitCommitAndPush, tryFastForwardPull } from './scheduled-run.ts';
import { CONSTANTS } from './shared/utils.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// These are scenario tests against real (local, temporary) git repositories:
// a bare "origin" plays GitHub, a clone plays the fetch host. They verify the
// PR-based landing contract from issue #14: publications are pushed to data/*
// branches, never directly to origin's main, and the fetch host's checkout
// converges cleanly once a data PR is merged with a merge commit.

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

// Every path that gitCommitAndPush stages must exist in the seed commit,
// because `git add` fails on pathspecs that match nothing.
function seedTrackedFiles(repo: string): void {
  const F = CONSTANTS.FILES;
  for (const f of [
    F.originalRawCsvFile,
    F.latestRawCsv,
    F.latestRawSortedCsv,
    F.latestJson,
    F.latestRawSortedJson,
    F.latestMeta,
    F.downloadMetadataFile,
  ]) {
    fs.writeFileSync(path.join(repo, f), '');
  }
  fs.mkdirSync(path.join(repo, CONSTANTS.DIRS.archive, '2026-01-01'), { recursive: true });
  fs.writeFileSync(path.join(repo, CONSTANTS.DIRS.archive, '2026-01-01', 'raw.csv'), 'seed\n');
}

// Simulate one Ofcom publication landing in the working tree: a new archive
// entry plus refreshed latest-* pointers.
function simulatePublication(repo: string, archiveKey: string): void {
  const entry = path.join(repo, CONSTANTS.DIRS.archive, archiveKey);
  fs.mkdirSync(entry, { recursive: true });
  fs.writeFileSync(path.join(entry, 'raw.csv'), `data-for-${archiveKey}\n`);
  fs.writeFileSync(path.join(entry, 'meta.json'), '{}\n');
  fs.writeFileSync(path.join(repo, CONSTANTS.FILES.latestRawCsv), `data-for-${archiveKey}\n`);
}

// A pristine origin+clone pair, seeded once. The seed is process-spawn heavy
// (init, clone, config, add, commit, push), so it runs a single time; each
// test gets its own isolated pair by cheaply copying this template.
let templateRoot: string;
let templateOrigin: string;
let templateClone: string;

let tmpRoot: string;
let origin: string; // bare repo standing in for GitHub
let clone: string; // checkout standing in for the fetch host
let originalCwd: string;
let originalSkipPush: string | undefined;

beforeAll(() => {
  templateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'callsigns-git-template-'));
  templateOrigin = path.join(templateRoot, 'origin.git');
  templateClone = path.join(templateRoot, 'clone');

  execFileSync('git', ['init', '--bare', '--initial-branch=main', templateOrigin], { stdio: 'pipe' });
  execFileSync('git', ['clone', templateOrigin, templateClone], { stdio: 'pipe' });
  git(templateClone, 'config', 'user.name', 'Test Fetcher');
  git(templateClone, 'config', 'user.email', 'fetcher@test.invalid');
  seedTrackedFiles(templateClone);
  git(templateClone, 'add', '-A');
  git(templateClone, 'commit', '-m', 'seed');
  git(templateClone, 'push', 'origin', 'main');
});

afterAll(() => {
  fs.rmSync(templateRoot, { recursive: true, force: true });
});

beforeEach(() => {
  originalCwd = process.cwd();
  originalSkipPush = process.env.SKIP_PUSH;
  delete process.env.SKIP_PUSH;

  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'callsigns-git-test-'));
  origin = path.join(tmpRoot, 'origin.git');
  clone = path.join(tmpRoot, 'clone');

  // Copy the once-seeded pair rather than re-running the full init/clone/
  // commit/push sequence per test: a filesystem copy avoids ~7 git
  // subprocesses each time, while every test still gets a fully isolated,
  // pristine origin and checkout (so origin-mutating tests never leak into
  // the next test).
  fs.cpSync(templateOrigin, origin, { recursive: true });
  fs.cpSync(templateClone, clone, { recursive: true });
  // The copied checkout still names the template as its origin remote; retarget
  // it at this test's own origin so pushes and pulls stay isolated.
  git(clone, 'remote', 'set-url', 'origin', origin);

  process.chdir(clone);
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalSkipPush === undefined) delete process.env.SKIP_PUSH;
  else process.env.SKIP_PUSH = originalSkipPush;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('dataBranchName', { tags: ['unit'] }, () => {
  it('DataBranchName_WhenArchiveKeyGiven_ReturnsDataPrefixedBranch', () => {
    expect(dataBranchName('2026-07-06')).toBe('data/2026-07-06');
  });
});

describe('gitCommitAndPush (PR-based landing, issue #14)', { tags: ['unit'] }, () => {
  it('Publication_WhenNewArchiveEntryCommitted_LandsOnDataBranchNotMain', () => {
    simulatePublication(clone, '2026-07-06');
    const mainBefore = git(origin, 'rev-parse', 'refs/heads/main');

    const result = gitCommitAndPush('Update amateur callsigns CSV', '2026-07-06');

    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(true);
    // Origin gained the data branch, carrying the publication commit...
    const branchTip = git(origin, 'rev-parse', 'refs/heads/data/2026-07-06');
    expect(git(origin, 'log', '-1', '--format=%s', branchTip)).toBe('Update amateur callsigns CSV');
    // ...while origin's main is untouched (nothing lands without a PR).
    expect(git(origin, 'rev-parse', 'refs/heads/main')).toBe(mainBefore);
    // The fetch host's local checkout keeps the commit, so the next tick sees
    // the entry as already archived (no duplicate publication).
    expect(git(clone, 'log', '-1', '--format=%s')).toBe('Update amateur callsigns CSV');
    expect(git(clone, 'status', '--porcelain')).toBe('');
  });

  it('Publication_WhenWorkingTreeClean_NoCommitAndNoBranchPushed', () => {
    const result = gitCommitAndPush('should not be used', '2026-07-06');

    expect(result.committed).toBe(false);
    expect(result.pushed).toBe(false);
    expect(() => git(origin, 'rev-parse', 'refs/heads/data/2026-07-06')).toThrow();
  });

  it('Publication_WhenSkipPushEnvSet_CommitsLocallyWithoutPushing', () => {
    process.env.SKIP_PUSH = 'true';
    simulatePublication(clone, '2026-07-06');

    const result = gitCommitAndPush('local-only commit', '2026-07-06');

    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(false);
    expect(() => git(origin, 'rev-parse', 'refs/heads/data/2026-07-06')).toThrow();
  });

  it('Publication_WhenPushFails_ReportsPushErrorAndKeepsLocalCommit', () => {
    simulatePublication(clone, '2026-07-06');
    // Point origin at a path that doesn't exist so the push (and pre-push
    // rebase fetch) cannot succeed.
    git(clone, 'remote', 'set-url', 'origin', path.join(tmpRoot, 'no-such-remote.git'));

    const result = gitCommitAndPush('publication with broken remote', '2026-07-06');

    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(false);
    expect(result.pushError).toBeTruthy();
    expect(git(clone, 'log', '-1', '--format=%s')).toBe('publication with broken remote');
  });

  it('Publication_WhenSecondPublicationBeforeFirstMerged_SecondBranchCarriesBoth', () => {
    // Two publications in successive ticks with no PR merge in between: the
    // second data branch stacks on the first. Its PR diff shrinks to just the
    // second publication once the first PR merges; merging both is safe
    // because the trees are supersets, never conflicting.
    simulatePublication(clone, '2026-07-06');
    gitCommitAndPush('first publication', '2026-07-06');
    simulatePublication(clone, '2026-07-07');
    const result = gitCommitAndPush('second publication', '2026-07-07');

    expect(result.pushed).toBe(true);
    const subjects = git(origin, 'log', '--format=%s', 'refs/heads/data/2026-07-07');
    expect(subjects).toContain('second publication');
    expect(subjects).toContain('first publication');
  });
});

describe('fetch-host convergence after PR merge', { tags: ['unit'] }, () => {
  it('FetchHost_WhenDataBranchMergedViaMergeCommit_FastForwardPullConverges', () => {
    // The whole point of the merge-commit method: the pushed data commit
    // becomes a parent of the merge commit, so the fetch host's local main
    // (already containing that commit) fast-forwards cleanly - no divergence,
    // no rebase, no notification noise.
    simulatePublication(clone, '2026-07-06');
    gitCommitAndPush('publication to be merged', '2026-07-06');

    // Simulate GitHub merging the PR with a merge commit.
    const merger = path.join(tmpRoot, 'merger');
    execFileSync('git', ['clone', origin, merger], { stdio: 'pipe' });
    git(merger, 'config', 'user.name', 'GitHub');
    git(merger, 'config', 'user.email', 'noreply@github.test');
    git(merger, 'merge', '--no-ff', '-m', 'Merge pull request #99 from data/2026-07-06', 'origin/data/2026-07-06');
    git(merger, 'push', 'origin', 'main');

    const pull = tryFastForwardPull();

    expect(pull.success).toBe(true);
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(git(origin, 'rev-parse', 'refs/heads/main'));
  });
});
