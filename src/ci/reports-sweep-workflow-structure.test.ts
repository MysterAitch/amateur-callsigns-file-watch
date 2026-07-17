import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Report-sweep structure contract (#446). The scheduled lane is what keeps
// the committed reports current for NEW publications now that the derivation
// half is retired: the workflow must build the ledger projection, run the
// report sweep against it, and write back reports/ ONLY - the committed
// archive derivatives are a frozen baseline this lane must never touch.
// Pinned here (like the data-sweep contract) rather than left to be caught
// by a live cron run.

const WORKFLOW = path.join('.github', 'workflows', 'reports-sweep.yml');

// Normalise to LF so line-anchored patterns are line-ending agnostic (a
// Windows checkout carries CRLF; the Linux CI runner carries LF).
function workflow(): string {
  return fs.readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
}

describe('reports-sweep.yml structure', { tags: ['unit'] }, () => {
  it('ReportSweep_RunsProjectionFed_SoANewPublicationContributes', () => {
    // The new-publication lane: the projection is built before the sweep and
    // the sweep reads it through the switch. Without this, a publication
    // newer than the frozen committed baseline would silently vanish from
    // every regenerated report until someone noticed.
    const wf = workflow();
    const projectionBuild = wf.indexOf('node src/v2/build-builder-projection.ts "$RUNNER_TEMP/builder-projection"');
    const sweepEnv = wf.indexOf('BUILDER_PROJECTION_DIR: ${{ runner.temp }}/builder-projection');
    const sweepRun = wf.indexOf('npm run reports:sweep');
    expect(projectionBuild, 'the projection build step is missing').toBeGreaterThan(-1);
    expect(sweepEnv, 'the report sweep lost its BUILDER_PROJECTION_DIR switch').toBeGreaterThan(-1);
    expect(sweepRun, 'the report sweep step is missing').toBeGreaterThan(projectionBuild);
  });

  it('ReportSweep_FoldsReadTheSharedParquet_BuiltOncePerRun', () => {
    // One corpus materialisation per run (#403): the folds read CLAIMS_PARQUET
    // instead of each re-materialising the multi-GB ledger.
    const wf = workflow();
    expect(wf, 'the shared Parquet build step is missing').toContain('node src/v2/build-ledger-db.ts "$RUNNER_TEMP/claims.parquet" --parquet-only');
    expect(wf, 'the sweep no longer reads the shared Parquet').toContain('CLAIMS_PARQUET: ${{ runner.temp }}/claims.parquet');
  });

  it('ReportSweep_WritebackScope_IsReportsOnly', () => {
    // The frozen-baseline guarantee: this lane stages and status-checks
    // reports/ alone. Staging archive/ or the latest-* pointers would mean
    // the derivation half has crept back in.
    const wf = workflow();
    expect(wf, 'the change check no longer scopes to reports/').toContain('git status --porcelain reports/');
    expect(wf, 'the commit no longer stages reports/ alone').toMatch(/\n\s+git add reports\/\n/);
    expect(wf, 'the workflow stages archive/ - the frozen committed derivatives must never be rewritten by this lane').not.toMatch(/git add [^\n]*archive\//);
    expect(wf, 'the workflow stages latest-meta.json - the pointer mirror is the fetch lane’s, not this one’s').not.toMatch(/git add [^\n]*latest-meta\.json/);
  });

  it('ReportSweep_FailureGate_TurnsTheRunRedOnAnyEntryFailure', () => {
    // The sweep's exit code is captured with set +e (so the PR/dashboard
    // steps still publish the honest state) and the FINAL step re-raises it;
    // losing that gate would let per-entry failures pass silently green. The
    // FOI lane deliberately has no step here (#447): its verification runs
    // per-PR as foi-verification.test.ts.
    const wf = workflow();
    expect(wf, 'the sweep exit-code capture is missing').toContain('echo "exitcode=$?" >> "$GITHUB_OUTPUT"');
    expect(wf, 'the run no longer fails when an entry failed').toContain('if [ "$SWEEP_EXITCODE" != "0" ]; then');
    expect(wf, 'a scheduled FOI sweep step has reappeared - that lane is verified per-PR (foi-verification.test.ts), not on this schedule').not.toContain('foi:sweep');
  });

  it('ReportSweep_CheckoutWithoutPersistedCredentials_TokenOnlyAtPush', () => {
    // ADR 0001 security shape: third-party code (npm ci, the folds) never
    // runs with a write-capable token in .git/config; the push injects it
    // explicitly.
    const wf = workflow();
    expect(wf, 'checkout persists credentials - third-party code would run with a write token').toContain('persist-credentials: false');
    expect(wf, 'the push no longer injects the token explicitly').toContain('git push "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"');
  });

  it('ReportSweep_PrLane_IsHumanReviewedNeverAutoMerged', () => {
    // Report PRs are always human-reviewed: the workflow opens the PR and
    // dispatches CI, but must never enable auto-merge on it.
    const wf = workflow();
    expect(wf, 'the PR step is missing').toContain('gh pr create --head "$branch" --base main');
    expect(wf, 'the workflow auto-merges its own PR - report changes must be human-reviewed').not.toContain('gh pr merge');
    expect(wf, 'the CI dispatch onto the branch is missing (bot PRs park in action_required otherwise)').toContain('gh workflow run cicd.yaml --ref "$branch"');
  });
});
