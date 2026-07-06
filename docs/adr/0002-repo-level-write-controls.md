# ADR 0002 — Repository-level write controls live in GitHub settings; this records them

- Status: accepted
- Date: 2026-07-06
- Related: ADR 0001, issues #14, #15; PR #28 (implementation); PR #29 (first end-to-end data PR)

## Context

ADR 0001 and issue #14 established the write posture: nothing lands on `main` except
through pull requests; the fetch host holds an SSH-only deploy key and pushes `data/*`
branches; a scheduled sweep workflow (reviewed code from `main`) opens and auto-merges
data-only PRs. The code half of that design is in the repository and reviewable
(`.github/workflows/data-sweep.yml`, `.github/CODEOWNERS`, `src/scheduled-run.ts`).

The other half lives in GitHub repository settings, which are invisible to a repo
checkout, easy to forget, and load-bearing. This ADR records what they are, why each is
set the way it is, and how to recreate them.

## Decision: the settings and their rationales

### 1. Ruleset "main: pull requests only" (branch ruleset, active)

- **Target**: default branch.
- **Rules**: require a pull request before merging (0 required approvals); block force
  pushes; block deletion. Allowed merge methods: merge / squash / rebase.
- **Bypass**: repository **admin** role only, mode "always".

Rationale:

- *Require PR* is the checkpoint that makes every write to `main` visible, checkable,
  and rejectable before it lands — the core of #14.
- *0 required approvals* because a solo maintainer cannot approve their own PRs; a
  required-review rule would deadlock every code change. The review pressure comes from
  the sweep's data-path allowlist (automated PRs) and from the maintainer being the only
  human (manual PRs).
- *Admin bypass* keeps the maintainer's direct-push workflow available for docs and
  small changes. Crucially, the automated credentials get no bypass: the deploy key and
  workflow tokens cannot write to `main` outside a PR, which is the actual threat model.
  A bypassed push is loudly labelled in the push output ("Bypassed rule violations"), so
  it is a deliberate act, never an accident.
- *Force-push / deletion blocks* protect the authoritative archive history — recovery
  properties depend on `main`'s history being append-only. (An admin can still bypass
  deliberately, e.g. resetting after a synthetic pipeline test.)

### 2. Actions workflow policy

- `default_workflow_permissions = read`
- `can_approve_pull_request_reviews = true` (the API name for the repo setting "Allow
  GitHub Actions to create and approve pull requests")

Rationale:

- The sweep must *create* PRs; GitHub blocks PR creation/approval for all workflow
  tokens by default (a supply-chain interlock against workflows laundering unreviewed
  code by opening and self-approving PRs). Enabling it is required for the sweep design
  and is low-risk here: the ruleset requires zero approvals anyway, so self-approval
  gains an attacker nothing, and workflows only run reviewed code from `main` on
  schedule/dispatch triggers — never in response to pushed content.
- Setting the *default* token permission to read-only at the same time is a posture
  improvement: any future workflow that forgets to declare a `permissions:` block gets a
  read-only token. The sweep declares its own scoped block (`contents: write`,
  `pull-requests: write`).

### 3. Merge behaviour

- `allow_auto_merge = true` — the sweep enables auto-merge on data-only PRs; they merge
  the moment checks are green (trivially green until #15 lands read-only CI, which then
  makes the gate real).
- `allow_merge_commit = true` (and merge-commit is what the sweep uses) — the merge
  commit keeps the fetcher's descriptive per-publication commit as a parent, preserving
  provenance in `main`'s history, and makes the fetch host's local `main` a strict
  ancestor of `origin/main` after merge, so its tick-start `git pull --ff-only`
  converges without divergence handling. Squash or rebase merges would break that
  convergence property (new SHAs), so data PRs must never be squashed.
- `delete_branch_on_merge = true` — merged `data/*` branches are litter; the sweep also
  deletes fully-merged leftovers defensively.

### 4. Deploy key (fetch host)

Write-scoped SSH deploy key. It can push git objects (the `data/*` branches) but cannot
call the REST/GraphQL APIs, and the ruleset excludes it from `main`. This is the
narrowest credential shape that still lets the fetch host publish: compromising the
host yields the ability to push branches that a reviewed workflow will refuse to
auto-merge unless the diff is data-only.

## Recreation (disaster recovery / new repo)

```bash
# Ruleset
gh api -X POST repos/{owner}/{repo}/rulesets --input ruleset.json
#   ruleset.json: target=branch, include=~DEFAULT_BRANCH,
#   rules: pull_request (0 approvals, allowed_merge_methods merge/squash/rebase),
#          non_fast_forward, deletion
#   bypass_actors: RepositoryRole admin (actor_id 5), mode always

# Actions workflow policy
gh api -X PUT repos/{owner}/{repo}/actions/permissions/workflow \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true

# Merge behaviour
gh api -X PATCH repos/{owner}/{repo} -F allow_auto_merge=true
# (allow_merge_commit and delete_branch_on_merge were already enabled)
```

## Consequences

- The settings above are not version-controlled by GitHub; treat this ADR as their
  source of truth and update it when they change.
- Verified end-to-end 2026-07-06 with a synthetic publication test: fetcher pushed
  `data/2026-06-23`, the sweep opened PR #29, the allowlist passed, auto-merge landed it
  with a merge commit, and the pushing checkout fast-forwarded cleanly over the merge.
- When #15 (read-only CI) lands, its checks should be added to the ruleset as required
  status checks so auto-merge becomes genuinely gated rather than trivially green.
