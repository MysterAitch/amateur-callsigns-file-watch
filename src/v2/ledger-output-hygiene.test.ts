import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'node:child_process';

// Repository hygiene contract for the ledger build output.
//
// The full ledger is ~12.7 GiB across 71 files, 33 of which exceed GitHub's
// 100 MB hard limit. Running `node src/v2/build-ledger.ts` with no path argument
// writes it INSIDE the working tree, so without an ignore rule a routine
// `git add -A` after a local build stages an unpushable commit.
//
// Nothing enforced this until #994: no `*.jsonl` rule exists, and the ledger
// stayed out of the repository only because the paths actually exercised happen
// to fall outside it (CI writes to $RUNNER_TEMP, benchmarks to an OS temp dir).
// The local default was the one path that did not, and it was unguarded.
//
// The rule must be BROAD enough to catch that accident and NARROW enough not to
// pre-empt the open question of whether a ledger is ever committed deliberately
// (ADR 0024) — a committed ledger would live at a chosen path, not in build
// output. Both directions are asserted below.

const BUILD_LEDGER = path.join('src', 'v2', 'build-ledger.ts');

// The default is READ from the CLI rather than restated here. A test that
// hardcoded the directory would keep passing if the default moved to somewhere
// unignored, which is precisely the drift it exists to catch.
function defaultLedgerOutputDir(): string {
  const src = fs.readFileSync(BUILD_LEDGER, 'utf8');
  const match = src.match(/args\[0\] \?\? path\.join\(([^)]*)\)/);
  if (match === null) {
    throw new Error(
      `could not locate the default output directory in ${BUILD_LEDGER}. If the CLI `
      + 'entrypoint was restructured, update this helper — do not delete the assertion, '
      + 'which guards ~12.7 GiB from being staged.',
    );
  }
  const segments = [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  if (segments.length === 0) throw new Error(`no path segments parsed from: ${match[1]}`);
  return segments.join('/');
}

// `git check-ignore` exits 0 when a path is ignored and 1 when it is not, so the
// exit code IS the answer and a non-zero exit is not an error here. Any other
// failure mode (git absent, not a repository) must surface rather than be read
// as "not ignored", so only status 1 is translated.
function gitIgnores(repoRelativePath: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', repoRelativePath], { stdio: 'pipe' });
    return true;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 1) return false;
    throw err;
  }
}

describe('ledger build output hygiene', { tags: ['unit'] }, () => {
  it('LedgerBuildOutput_WhenWrittenToTheCliDefaultPath_IsIgnoredByGit', () => {
    const dir = defaultLedgerOutputDir();
    expect(gitIgnores(`${dir}/claims.jsonl`)).toBe(true);
  });

  it('LedgerBuildOutput_WhenTheDefaultPathIsInsideTheWorkingTree_TheIgnoreRuleCoversItsWholeDirectory', () => {
    const dir = defaultLedgerOutputDir();
    // A per-source emit produces one file per source, so the guard has to cover
    // arbitrary names beneath the directory rather than a single known filename.
    expect(gitIgnores(`${dir}/some-source-2026-06-23.jsonl`)).toBe(true);
    expect(gitIgnores(`${dir}/nested/deeper.jsonl`)).toBe(true);
  });

  it('LedgerFile_WhenPlacedOutsideTheBuildDirectory_IsNotIgnored', () => {
    // The counterpart scenario. Whether a ledger is ever committed is OPEN, so
    // the rule must not quietly block that decision by ignoring `.jsonl`
    // everywhere. If this fails, someone has broadened the guard into a veto on
    // a choice that has not been made.
    expect(gitIgnores('ledger/claims.jsonl')).toBe(false);
    expect(gitIgnores('archive/claims.jsonl')).toBe(false);
  });

  it('LedgerOutputDirectory_WhenResolvedFromTheCli_IsRepositoryRelativeRatherThanTemporary', () => {
    // Documents WHY the ignore rule is needed at all: the default is inside the
    // working tree. Were it moved to an OS temp directory the rule would become
    // belt-and-braces rather than load-bearing — a change worth noticing, since
    // this whole file's rationale would shift with it.
    const dir = defaultLedgerOutputDir();
    expect(path.isAbsolute(dir)).toBe(false);
  });
});
