# ADR 0002 — Repository-level write controls live in GitHub settings; this records them

- Status: accepted
- Date: 2026-07-06
- Related: ADR 0001, ADR 0019 (the unified CI/CD pipeline these checks now live in); issues #14, #15, #243, #588; PR #28 (implementation); PR #29 (first end-to-end data PR)

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
- **Rules**: require a pull request before merging (0 required approvals); require the
  status checks `tests`, `data-validation`, `golden-master` and `workflow-audit` (the job names in
  `.github/workflows/cicd.yaml`, the unified CI/CD pipeline — renaming those jobs
  without updating the ruleset blocks all merges; that same workflow also holds the
  Pages `deploy` job, gated to `main`, so a single file now carries both the required
  checks and the deploy, ADR 0019); block force pushes; block deletion. Allowed merge
  methods: merge / squash / rebase.
- **Bypass**: repository **admin** role only, mode "always".

Rationale:

- *Require PR* is the checkpoint that makes every write to `main` visible, checkable,
  and rejectable before it lands — the core of #14.
- *Required status checks* make auto-merge genuinely conditional (#15): `tests` gates
  code correctness; `data-validation` gates data integrity (entry completeness,
  meta.json shape, size + sha256 of every declared file, CSV parseability of changed
  entries, latest-pointer consistency); `golden-master` gates report-generation drift
  (issue #243, #588 part 2) — a PR that changes generation logic or hand-edits a
  committed report under `reports/` now fails the same freshness check the scheduled
  sweep runs, rather than only on the next scheduled round. A red check holds the PR
  open — the branch then IS the preserved record of the anomalous bytes, and merging
  past a red check remains possible as a deliberate, logged admin-bypass act (the "raw
  record worth keeping despite failing checks" escape hatch). `workflow-audit`
  (required since 2026-07-17) gates the workflow files themselves - actionlint
  (syntax + shellcheck over embedded scripts) and zizmor (security patterns:
  pwn-requests, credential handling, unpinned actions) - because the workflows
  ARE the security-critical orchestration: a defect there previously reached
  `main` silently (red audit runs blocked nothing) and, in one observed case, a
  workflow-file parse error stopped every check from even registering. Any
  suppression of an audit finding must carry its rationale inline where the
  trade-off is visible.
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

Rules **deliberately not enabled** — these are decisions, not omissions:

- *Require linear history* must stay **off**: it forbids merge commits, and the entire
  data-landing design depends on them (fetch-host convergence, ADR section 3). Enabling
  it would break every data PR.
- *Require signed commits* stays **off**: the fetch host's deploy-key commits are
  unsigned; enabling would block every publication. Revisit only alongside a signing
  setup on the fetch host.
- *Require branches to be up to date before merging* (strict status checks) stays
  **off**: data branches would queue behind every unrelated `main` commit for pointless
  re-runs; the checks validate the merge result well enough without it.
- *Require review from Code Owners* stays **off**: a solo maintainer cannot approve
  their own PRs (see the 0-approvals rationale above).
- *Restrict creations/updates* stay **off**: they would reduce all non-bypass activity
  to nothing, including PR merges.

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
- `allow_squash_merge = false`, `allow_rebase_merge = false` (hardened 2026-07-07) —
  the never-squash rule above was previously convention-only; a mis-click on any data
  PR would rewrite the commit SHA, diverge the fetch host's local `main` from
  `origin/main`, and wedge its next `git pull --ff-only` until manual intervention.
  Merge commit is now the only method the UI offers, turning the convention into a
  structural guarantee (at the cost of squash on code PRs, judged worth it).
- `delete_branch_on_merge = true` — merged `data/*` branches are litter; the sweep also
  deletes fully-merged leftovers defensively.

### 4. Deploy key (fetch host)

Write-scoped SSH deploy key. It can push git objects (the `data/*` branches) but cannot
call the REST/GraphQL APIs, and the ruleset excludes it from `main`. This is the
narrowest credential shape that still lets the fetch host publish: compromising the
host yields the ability to push branches that a reviewed workflow will refuse to
auto-merge unless the diff is data-only.

### 5. Advanced Security (all read-only analysis; enabled 2026-07-06)

None of these grant write access to anything, so the supply-chain posture is
unaffected; they only add detection.

- **Dependency graph**: enabled (Dependabot requires it). Side benefit: automatic SPDX
  SBOM export via `GET repos/{owner}/{repo}/dependency-graph/sbom`.
- **Dependabot alerts + security updates**: enabled. Alerts surface CVEs in
  dependencies immediately (rather than waiting for the weekly version-update sweep);
  security updates open fix PRs, which arrive through the same gated door as all code
  PRs (ruleset + required checks, never auto-merged). Enabling alerts also switched on
  **malware alerts** and GitHub's default auto-triage rule ("dismiss low impact issues
  for development-scoped dependencies") — both left as they arrived.
- **CodeQL code scanning, default setup**: enabled for JavaScript/TypeScript **and
  GitHub Actions workflows** — the latter catches workflow-injection patterns
  (untrusted input interpolated into `run:` blocks), directly relevant to the sweep and
  any future comment-triggered workflows. Scans on PR + weekly. Its check run is
  deliberately NOT a required status check: a new-query false positive must not block a
  data publication; alerts and PR annotations are the right pressure. Failure
  thresholds left at defaults (security: high-or-higher; standard: errors).
- **Copilot Autofix**: on (suggests fixes on CodeQL alerts; suggestions only, never
  commits).
- **Private vulnerability reporting**: enabled — a private disclosure channel instead
  of a public issue.
- **Secret scanning + push protection**: enabled (pre-existing). Non-provider patterns
  and validity checks left off: the former is noisy generic heuristics; the latter
  sends candidate secrets to providers for live verification.
- **Automatic dependency submission**: left OFF deliberately — it exists for
  ecosystems whose build-time dependencies are invisible to manifest parsing; npm's
  lockfile already gives the graph everything, so this would only add a no-op Actions
  job.
- **Grouped security updates**: enabled (manually via the UI, 2026-07-06 — this setting
  has no public API). Groups alert-resolving updates into one PR per package manager,
  reducing PR noise when security updates arrive in clusters.

## Recreation (disaster recovery / new repo)

```bash
# Ruleset (this is the complete live definition)
gh api -X POST repos/{owner}/{repo}/rulesets --input - <<'JSON'
{
  "name": "main: pull requests only",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["merge", "squash", "rebase"]
      } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "tests" },
          { "context": "data-validation" },
          { "context": "golden-master" },
          { "context": "workflow-audit" }
        ]
      } },
    { "type": "non_fast_forward" },
    { "type": "deletion" }
  ],
  "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }
  ]
}
JSON

# Actions workflow policy
gh api -X PUT repos/{owner}/{repo}/actions/permissions/workflow \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true

# Merge behaviour
gh api -X PATCH repos/{owner}/{repo} -F allow_auto_merge=true
# (allow_merge_commit and delete_branch_on_merge were already enabled)

# Advanced Security
gh api -X PUT repos/{owner}/{repo}/vulnerability-alerts
gh api -X PUT repos/{owner}/{repo}/automated-security-fixes
gh api -X PUT repos/{owner}/{repo}/private-vulnerability-reporting
gh api -X PATCH repos/{owner}/{repo}/code-scanning/default-setup -f state=configured
# (dependency graph, secret scanning, and push protection are on by default
#  for public repos; grouped security updates is UI-only)
```

## Consequences

- The settings above are not version-controlled by GitHub; treat this ADR as their
  source of truth and update it when they change. Because it goes stale silently, a
  periodic re-check against the live API (`gh api repos/{owner}/{repo}/rules/branches/main`,
  `…/actions/permissions/workflow`, and the repository settings endpoint) is the
  only guard. Last verified in full 2026-07-29: the live ruleset, workflow policy
  and merge settings all matched this record, except that the recreation block had
  omitted `workflow-audit` from the required checks after the 2026-07-17 update
  amended only the prose — corrected the same day. When a required check is added
  or renamed, both the prose *and* the recreation block must change.
- Verified end-to-end 2026-07-06 with a synthetic publication test: fetcher pushed
  `data/2026-06-23`, the sweep opened PR #29, the allowlist passed, auto-merge landed it
  with a merge commit, and the pushing checkout fast-forwarded cleanly over the merge.
- ~~When #15 (read-only CI) lands, its checks should be added to the ruleset as required
  status checks so auto-merge becomes genuinely gated rather than trivially green.~~
  Done — `tests` and `data-validation` are required checks (see the ruleset section).
- **Update (2026-07-17)**: `golden-master` joined the required-status-checks set
  (#588 part 2, #583) alongside `tests` and `data-validation` — see the ruleset
  section and the job's own comment in `.github/workflows/cicd.yaml` for the
  activation step. Report-generation drift now holds open the PR that
  introduced it, rather than only surfacing on the next scheduled sweep.
- Dependency freshness: Dependabot (`.github/dependabot.yml`) keeps the SHA-pinned
  actions and npm dependencies updated via ordinary gated PRs. Chosen over hosted
  Renovate so no third-party service holds write access to the repository.
