import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Data-sweep structure contract (#583/#588). The sweep is the one automated
// credential that can merge to `main`, so its fail-closed auto-merge fallback
// (#648) and its Option A "landing must never go unseen" notification are
// both pinned here rather than left to be caught by a live cron run.

const WORKFLOW = path.join('.github', 'workflows', 'data-sweep.yml');

// Normalise to LF so line-anchored patterns are line-ending agnostic (a
// Windows checkout carries CRLF; the Linux CI runner carries LF).
function workflow(): string {
  return fs.readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
}

// The data-only branch of the sweep's single run: block, from the auto-merge
// enable call to the matching `else` of the data-only/non-data-only split.
function dataOnlyBranch(wf: string): string {
  const m = wf.match(/if \[ "\$data_only" = true \]; then\n([\s\S]*?)\n\s*else\n/);
  if (m === null) throw new Error(`data-only branch not found in ${WORKFLOW}`);
  return m[1];
}

describe('data-sweep.yml structure', { tags: ['unit'] }, () => {
  it('IssuesWritePermission_IsDeclared_ForTheLandingsDigest', () => {
    // The digest comment (gh issue create/comment) needs issues: write; the
    // workflow default is otherwise contents + pull-requests only.
    expect(workflow(), 'issues: write is missing - the landings digest cannot be posted').toMatch(/\n {2}issues: write\n/);
  });

  it('DataOnlyLanding_AssignsThePR_BeforeMerging', () => {
    // Option A visibility: every auto-merged data-only PR gets an assignee,
    // resolved from the repository's own owner field rather than a
    // hardcoded login, so the mechanism survives an ownership change.
    const branch = dataOnlyBranch(workflow());
    expect(branch, 'the data-only branch no longer assigns the landed PR').toMatch(/gh pr edit "\$pr_url" --add-assignee/);
    expect(branch, 'the assignee is no longer resolved from the repo owner field').toMatch(/gh api "repos\/\$GITHUB_REPOSITORY" --jq \.owner\.login/);
  });

  it('DataOnlyLanding_AppendsTheRollingDigest', () => {
    // The digest is additive by design: search-title / create-if-missing,
    // then a comment per landing - never an overwrite of prior entries.
    const branch = dataOnlyBranch(workflow());
    expect(branch, 'the rolling digest issue title changed or is missing').toMatch(/Data landings \(rolling digest\)/);
    expect(branch, 'the digest no longer searches for an existing issue by title before creating one').toMatch(/gh issue list --state open --search/);
    expect(branch, 'the digest no longer appends a comment per landing').toMatch(/gh issue comment "\$digest_number"/);
  });

  it('FailClosedAutoMergeFallback_IsUnchanged', () => {
    // #648: enabling auto-merge failing must still park the PR and fail the
    // job, never fall back to a direct merge past pending checks. This must
    // hold regardless of the Option A additions layered after it.
    const branch = dataOnlyBranch(workflow());
    expect(branch, 'the fail-closed auto-merge fallback regressed').toMatch(/if ! gh pr merge --auto --merge --delete-branch "\$pr_url"; then/);
    expect(branch, 'auto-merge failure no longer fails the job').toMatch(/exit 1/);
    expect(workflow(), 'a direct-merge fallback (|| gh pr merge --merge) has reappeared - this fails OPEN').not.toMatch(/\|\|\s*gh pr merge --merge/);
  });

  it('NonDataOnlyLanding_NeverGetsTheDigestOrAssignee', () => {
    // The digest and assignee are additive ON TOP OF an auto-merge that
    // actually happened; a non-data-only PR is parked for human review
    // instead and must keep its existing, unchanged comment-only behaviour.
    const wf = workflow();
    const elseBranch = wf.slice(wf.indexOf('\n            else\n'));
    expect(elseBranch, 'the non-data-only branch gained the digest/assignee calls').not.toMatch(/add-assignee|Data landings/);
    expect(elseBranch, 'the non-data-only human-review comment regressed').toMatch(/needs human review/);
  });
});
