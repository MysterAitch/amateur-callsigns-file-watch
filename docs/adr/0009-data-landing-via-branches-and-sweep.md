# ADR 0009 — Raw data lands on `main` via `data/*` branches and a scheduled sweep

- Status: accepted
- Date: 2026-07-10
- Related: ADR 0001 (processing location), ADR 0002 (the GitHub settings this relies on), issue #14 (the decision), PR #28 (implementation), PR #29 (first end-to-end data PR)

## Context

The fetch host runs on a residential connection (ADR 0011) and holds a single
write-scoped SSH deploy key. The publishing path has to satisfy two constraints
at once: new raw entries must reach `main` unattended, and no credential the
fetch host holds may be able to write to `main` directly. A compromised host
must, at worst, be able to push branches that a reviewed process refuses to
land unless the diff is data-only.

ADR 0001 settled *where* post-fetch processing runs (in this repository, via
scheduled PR-gated workflows); ADR 0002 records the GitHub repository settings
that enforce the write posture. What has never been written up as a decision in
its own right — its canonical description lives only in ADR 0002's settings
section and in code comments in `src/scheduled-run.ts` — is the end-to-end
landing flow itself, and in particular the merge-commit convergence property
that makes it safe for a long-lived, unattended host. This ADR records that
flow.

## Decision

1. **The fetch host pushes to `data/{archiveKey}` branches, never to `main`.**
   Each new archive entry is committed locally and pushed to its own branch
   (`dataBranchName()` → `data/2026-07-06`). The deploy key is SSH-only: it can
   push git objects but cannot call the REST/GraphQL APIs, and the `main`
   ruleset excludes it. Branch-push is therefore the entire write surface the
   host needs.

2. **A scheduled sweep opens and gates the pull request.** A cron-scheduled
   GitHub Actions workflow (running reviewed code from `main`) discovers pushed
   `data/*` branches, opens one pull request per branch, and enables
   auto-merge. Because it is schedule-triggered it never executes pushed
   content — only code already reviewed onto `main`.

3. **Auto-merge is gated by a data-path allowlist.** Auto-merge is enabled only
   when a branch's diff is confined to data paths (`archive/`, the `latest-*`
   pointer set, the root raw copy `amateur-callsigns-raw.csv`, and the
   `metadata-download-info.json` sidecar — the allowlist in
   `.github/workflows/data-sweep.yml` mirrors exactly the paths the fetch
   host's commit step stages). A branch that touches `src/**`,
   `.github/**`, or any other code path falls to ordinary human review — the
   allowlist is what lets data land unattended while code cannot.

4. **Merge-commit only; data PRs are never squashed or rebased.** The pushed
   data commit stays on the fetch host's local `main`. When the PR lands as a
   *merge commit*, that commit becomes one of the merge's parents, so the host's
   local `main` is a strict ancestor of `origin/main` and the tick-start
   `git pull --ff-only` converges with no divergence handling. Squash and rebase
   rewrite the commit SHA, which would diverge the host's local `main` from
   `origin/main` and wedge its next `git pull --ff-only` until manual
   intervention. This convergence property is the reason the rule exists. It was
   previously convention-only and is now a structural guarantee: merge commit is
   the only method the repository offers for these PRs
   (`allow_squash_merge=false`, `allow_rebase_merge=false`), so a mis-click
   cannot break it.

5. **Required status checks make the gate real.** Auto-merge completes only when
   every required status check is green. The authoritative set is recorded in
   ADR 0002 and has grown since this record was written — at the 2026-07-17
   update it is `tests`, `data-validation`, `golden-master` and
   `workflow-audit`, and all of them gate every pull request, data PRs
   included. A red check
   holds the PR open, and the branch then *is* the preserved record of the
   anomalous bytes; landing past a red check remains possible as a deliberate,
   logged admin-bypass act.

## Consequences

- The host's failure mode is bounded: the worst a compromised fetch host can do
  is push `data/*` branches, and the sweep will not auto-merge any branch whose
  diff strays outside the allowlist.
- The merge-commit requirement is load-bearing infrastructure, not stylistic
  preference. `require linear history` must stay off in the ruleset (ADR 0002)
  precisely because it would forbid merge commits and break convergence.
- The fetch host recovers from an unattended gap of hours or days by
  fast-forwarding over however many merge commits landed while it was quiet; no
  divergence-resolution logic runs on the host.
- The flow generalises to any producer: manually-added datasets pushed to a
  `data/*` branch travel the same gated path, and the scheduled sweep picks them
  up uniformly.
