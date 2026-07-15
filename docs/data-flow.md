# Data flow and stage-gates

How data enters this repository and what checks stand between a new byte and
`main`. This is the single end-to-end map of the pipeline: for each stage it
names the **trigger**, the **gate** that must pass, the **ADR** that governs it,
and whether a **human is in the loop**.

It describes what the workflows in `.github/workflows/` actually do, which is
not always identical to what the ADRs intend — where the two differ, this page
says so. Contributors adding a dataset should read
[`adding-a-dataset.md`](adding-a-dataset.md) for the how-to; this page is the
why-and-where-it-is-gated companion.

## Two kinds of enforcement

The gates fall into two groups, and the distinction matters when reading this
page:

- **In-repo, code-verifiable.** The workflow YAML and the scripts it runs are in
  this repository and can be audited directly. Everything with a `.github/…`
  citation below is of this kind.
- **GitHub-settings-enforced.** Branch rulesets, required status checks,
  CODEOWNERS review requirements and merge-method restrictions live in the
  repository's GitHub settings, recorded in
  [ADR 0002](adr/0002-repo-level-write-controls.md) but **not present as files in
  this repository**. Statements here about "required checks", "no direct pushes"
  or "merge-commit only" describe that configuration as the ADRs record it; they
  cannot be confirmed from the tree alone. Where a workflow's safety depends on
  such a setting, this page flags it.

## The pipeline end to end

```mermaid
flowchart TD
    subgraph host["Fetch host (LXC, residential IP) — ADR 0011"]
      FETCH["Detect upstream change · download · sanity-gate · commit raw bytes"]
    end
    FETCH -->|"SSH deploy key<br/>push to data/* branch<br/>(cannot touch main)"| BRANCH["data/{key} branch on origin"]

    BRANCH -->|"cron */15 min"| SWEEP["data-sweep.yml<br/>open one PR per branch"]
    SWEEP -->|"diff is data-only?"| GATE{"Path allowlist"}
    GATE -->|"yes"| AUTOMERGE["Enable auto-merge<br/>(--auto --merge)"]
    GATE -->|"no (touches src/**, .github/**, …)"| REVIEW["Comment: needs human review<br/>— auto-merge NOT enabled"]

    AUTOMERGE -->|"waits on required checks"| CI["cicd.yaml verify jobs"]
    REVIEW -->|"waits on human + checks"| CI

    CI -->|"green + merge-commit"| MAIN["main"]

    MAIN -->|"cron 06:30 daily"| NORM["normalise.yml<br/>re-derive normalised.csv + reports/"]
    NORM -->|"any change?"| NORMPR["Open normalise/* PR<br/>ALWAYS human-reviewed"]
    NORMPR -->|"dispatch"| CI
    NORMPR --> MAIN

    MAIN -->|"push to main"| DEPLOY["cicd.yaml deploy job<br/>build + publish Pages site"]

    classDef host fill:#eef3f4,stroke:#c9d7dc;
    classDef gate fill:#fbeee2,stroke:#c98a3f;
    classDef merge fill:#dff5e1,stroke:#3f7d55;
    class FETCH host
    class GATE,SWEEP,NORM gate
    class MAIN,AUTOMERGE merge
```

Plain-text equivalent:

```
Ofcom / web-archive
      │  (fetch, sanity-gate, commit raw bytes)
      ▼
Fetch host (LXC)  ──push data/{key}──►  data/* branch on origin
      │                                        │
      │                        cron */15  ┌────▼──────────────┐
      │                                   │  data-sweep.yml   │  opens 1 PR/branch
      │                                   └────┬──────────────┘
      │                          data-only? ───┴─── no ──► comment "needs review"
      │                              │ yes
      │                              ▼
      │                       enable auto-merge
      │                              │
      │                    ┌─────────▼──────────┐
      └───────────────────►│   cicd.yaml verify │  tests · data-validation ·
                           │  (contents: read)  │  golden-master · reconstruction
                           └─────────┬──────────┘
                                     │ green + merge-commit
                                     ▼
                                   main ──push──► cicd.yaml deploy → GitHub Pages
                                     │
                          cron 06:30 │  normalise.yml re-derives goldens
                                     ▼
                        normalise/* PR (always human-reviewed) ──► main
```

## Stages

### 1. Fetch and sanity-gate (fetch host)

- **Trigger:** the fetch host's own loop detects an upstream change on Ofcom's
  open-data page.
- **What it does:** downloads, applies the sanity-gate (temp file → validate →
  atomic rename), commits the raw bytes locally, and pushes to a
  `data/{archiveKey}` branch.
- **Gate:** the sanity-gate on the host; the raw bytes are the authoritative
  record and enter the archive on provenance alone, not on processability
  ([ADR 0001](adr/0001-post-fetch-processing-in-repo.md) §5,
  [ADR 0010](adr/0010-archive-contract.md)).
- **Write surface:** an SSH-only, branch-scoped deploy key. It can push git
  objects to `data/*` but cannot call the GitHub API and cannot push to `main`
  ([ADR 0009](adr/0009-data-landing-via-branches-and-sweep.md) §1,
  [ADR 0011](adr/0011-two-tier-architecture.md)).
- **Human in the loop:** no — unattended by design.

Manually-added and web-archive-recovered datasets travel the same path: a
maintainer commits the entry and pushes it to a `data/*` branch (or lands it via
a reviewed `ingest/*` branch for bundles that also carry converter code — see
below).

### 2. Data sweep — open a PR and gate auto-merge (`data-sweep.yml`)

- **Trigger:** cron every 15 minutes, plus `workflow_dispatch`
  (`.github/workflows/data-sweep.yml:18-21`). Schedule-triggered, never
  push-triggered, so it only ever runs reviewed code from `main` and branch
  content can influence *what* merges but never *what executes*
  (`data-sweep.yml:10-15`).
- **Permissions:** `contents: write`, `pull-requests: write`
  (`data-sweep.yml:23-25`).
- **What it does** (`data-sweep.yml:39-93`): discovers `data/*` branches; deletes
  any that are already fully merged or empty; opens one merge-commit PR per
  remaining branch; classifies the branch's diff against a **path allowlist**
  (`archive/*`, the `latest-*` pointer set, `amateur-callsigns-raw.csv`,
  `metadata-download-info.json` — `data-sweep.yml:70-75`).
- **Gate — the allowlist decides the path:**
  - **Data-only diff:** enables auto-merge with `gh pr merge --auto --merge
    --delete-branch`, which waits for required checks; if `--auto` is refused it
    falls back to an immediate `gh pr merge --merge` (`data-sweep.yml:84-89`).
  - **Diff touches any non-data path:** posts a comment that auto-merge is **not**
    enabled and the PR needs human review (`data-sweep.yml:90-92`).
- **Governing ADR:** [ADR 0009](adr/0009-data-landing-via-branches-and-sweep.md)
  (the landing flow), [ADR 0001](adr/0001-post-fetch-processing-in-repo.md)
  (schedule-not-push, PR-only writeback).
- **Human in the loop:** **no** for data-only publications — they auto-merge on
  green checks with no reviewer assigned and no notification beyond the PR
  itself; **yes** for any diff that strays outside the allowlist.

> **Depends on GitHub settings.** Auto-merge only *waits* for a gate if required
> status checks are configured on `main`; the `|| gh pr merge --merge` fallback
> merges immediately when none are. [ADR 0009](adr/0009-data-landing-via-branches-and-sweep.md)
> §5 states the `tests` and `data-validation` checks are required and that this
> is what makes the gate real — that requirement lives in the ruleset
> ([ADR 0002](adr/0002-repo-level-write-controls.md)), not in this repository.
> Merge-commit-only (no squash/rebase) is likewise a ruleset guarantee
> ([ADR 0009](adr/0009-data-landing-via-branches-and-sweep.md) §4); it keeps the
> fetch host's local `main` a strict ancestor of `origin/main` so its next
> `git pull --ff-only` converges.

**Maintainer bulk ingestion is out of scope for this sweep.** Batches that bundle
converter code plus regenerated golden masters can never be "data-only", so they
use the `ingest/*` branch prefix, which the sweep deliberately ignores; they land
via their own reviewed consolidation PRs (`data-sweep.yml:5-8`).

### 3. Verify pipeline (`cicd.yaml`)

- **Trigger:** every `pull_request`, every `push` to `main`, and
  `workflow_dispatch` (`.github/workflows/cicd.yaml:20-24`).
- **Write posture:** the workflow's default permission is `contents: read`
  (`cicd.yaml:26-27`). Only the `deploy` job elevates, and only to `pages: write`
  + `id-token: write` (`cicd.yaml:751-753`) — **no job in this workflow can write
  repository contents.** This preserves the read-only-CI posture of
  [ADR 0012](adr/0012-supply-chain-posture.md) at the job level rather than by
  keeping verify in a separate file ([ADR 0019](adr/0019-layered-build-cache-and-unified-cicd.md) §3).
- **Verify gates:**
  - **`tests`** — the single aggregate required check
    (`cicd.yaml:435-448`). The suite is fanned out across `typecheck`,
    `build-claims`, the heavy/fold/shard/fast matrices, the cached
    `build-sqlite-tiers` and `build-ledger` jobs, and `coverage`; `tests` passes
    only if every one of them did. The **reconstruction oracle**
    (`src/ci/reconstruction-oracle.test.ts`) is one of these tests — sharded four
    ways under `heavy-shard` — so round-trip fidelity gates through `tests`
    ([ADR 0016](adr/0016-file-level-claims-and-reconstruction-oracle.md); see
    [`adding-a-dataset.md`](adding-a-dataset.md) §4).
  - **`data-validation`** — a required check (`cicd.yaml:476-500`): structural and
    byte-integrity validation over every archive entry, with deep CSV parsing on
    the entries a PR touches (or the newest entry on a push to `main`). Governs
    the line-accounting invariant in
    [`normalised-schema.md`](normalised-schema.md).
  - **`golden-master`** — the drift gate (`cicd.yaml:526-594`): re-runs the report
    generators against the committed `archive/` + `reference-data/` and fails if
    the working tree then differs from what is committed under `reports/`, so a
    stale committed golden master is caught on the PR that introduced it
    ([ADR 0001](adr/0001-post-fetch-processing-in-repo.md) re-run semantics).
  - **`workflow-audit`** — `actionlint` + `zizmor` over the workflow YAML
    (`cicd.yaml:456-474`). Explicitly *not* a required status check (it gates the
    workflows, not the data) but red runs demand attention.
- **Governing ADR:** [ADR 0019](adr/0019-layered-build-cache-and-unified-cicd.md)
  (unified pipeline, job-level permissions, content-addressed caches),
  [ADR 0012](adr/0012-supply-chain-posture.md) (read-only CI, pinned action
  SHAs).
- **Human in the loop:** no human runs the checks; a human is required to merge
  only when the data sweep withheld auto-merge (stage 2) or for any code-path PR.

### 4. Merge to `main`

- **Trigger:** required checks green (and human review where required).
- **Gate:** the `main` branch ruleset — no direct pushes, no force pushes,
  merge-commit only, required checks — enforced in GitHub settings
  ([ADR 0002](adr/0002-repo-level-write-controls.md),
  [ADR 0009](adr/0009-data-landing-via-branches-and-sweep.md)). Landing past a red
  check is possible only as a deliberate, logged admin bypass.
- **Human in the loop:** depends on the PR class (see stage 2).

### 5. Deploy the site (`cicd.yaml` `deploy`)

- **Trigger:** the `push`-to-`main` run of `cicd.yaml`; the `deploy`,
  `build-site-databases` upload, and post-deploy jobs are gated
  `if: github.ref == 'refs/heads/main'` (`cicd.yaml:740-748`).
- **What it does:** builds the published SQLite databases fresh from committed
  data (never committed — SQLite is not byte-deterministic), assembles the static
  site, uploads and deploys the Pages artefact, then runs post-deploy `smoke`,
  `console-check` and `functionality-check` against the live deployment
  (`cicd.yaml:596-841`).
- **Governing ADR:** [ADR 0003](adr/0003-in-repo-presentation-poc.md),
  [ADR 0019](adr/0019-layered-build-cache-and-unified-cicd.md).
- **Human in the loop:** no.

### 6. Scheduled normalise sweep (`normalise.yml`)

- **Trigger:** cron daily at 06:30 UTC, plus `workflow_dispatch`
  (`.github/workflows/normalise.yml:12-15`).
- **Permissions:** `contents: write`, `pull-requests: write`, `issues: write`,
  and `actions: write` — the last solely to `workflow_dispatch` `cicd.yaml` onto
  the derivation branch, because a bot-authored PR's `pull_request` run otherwise
  parks in `action_required` under the contributor-approval policy
  (`normalise.yml:17-26`, `normalise.yml:130-135`).
- **What it does:** re-derives every entry's `normalised.csv` (open-data lane) and
  the FOI derivations, re-folds the cross-dataset reports, and — if anything
  changed — opens a `normalise/{run-id}` PR whose cross-entry diff is the review
  artefact (`normalise.yml:63-135`). It maintains a rolling "Normalisation
  coverage" dashboard issue (`normalise.yml:137-157`) and turns the run red if any
  entry failed to normalise or verify (`normalise.yml:159-167`). Checkout uses
  `persist-credentials: false`; the write token is injected only at the push step,
  so third-party converter code never runs with a write-capable token in
  `.git/config` (`normalise.yml:36-43`, `normalise.yml:121`).
- **Gate:** the resulting PR is **always human-reviewed, never auto-merged**
  (`normalise.yml:1-5`). Byte-identical re-derivation is a no-op and opens no PR.
- **Governing ADR:** [ADR 0001](adr/0001-post-fetch-processing-in-repo.md)
  (golden-master re-run semantics), with the FOI lane report-and-verify-only per
  [ADR 0004](adr/0004-foi-source-lane.md).
- **Human in the loop:** **yes, always.**

### Adjacent: dataset-class PR labels (`pr-dataset-labels.yml`)

Not part of the landing gate, but it runs alongside the sweep: a cron job
(`:17` and `:47` past each hour) that reconciles derived dataset-class labels on
open data PRs by reading each PR's changed `meta.json` through the GitHub
*contents* API as pure JSON — never a branch checkout or execution. Its writes
are label edits only; it holds `contents: read` and cannot touch `main`
(`.github/workflows/pr-dataset-labels.yml`). Same schedule-not-push security
shape as the data sweep ([ADR 0001](adr/0001-post-fetch-processing-in-repo.md) /
[ADR 0002](adr/0002-repo-level-write-controls.md)).

## Stage-gate summary

| Stage | Workflow / actor | Trigger | Gate / check | Governing ADR | Human? |
|---|---|---|---|---|---|
| Fetch + sanity-gate | Fetch host (LXC) | Upstream change | Sanity-gate; provenance-only acceptance | 0001, 0010, 0011 | No |
| Open PR + gate auto-merge | `data-sweep.yml` | cron 15 min | Data-path allowlist | 0009, 0001 | No (data-only) / Yes (else) |
| Verify | `cicd.yaml` | Every PR + push to main | `tests`, `data-validation` (required); `golden-master`, reconstruction, `workflow-audit` | 0019, 0012 | No |
| Merge | GitHub ruleset | Checks green | No direct/force push, merge-commit only, required checks | 0002, 0009 | Depends on PR class |
| Deploy | `cicd.yaml` `deploy` | Push to main | Post-deploy smoke / console / functionality | 0003, 0019 | No |
| Normalise sweep | `normalise.yml` | cron daily 06:30 | Always-human-reviewed PR; run reddens on failure | 0001, 0004 | Yes, always |

## Write surfaces at a glance

Only three automated credentials can affect the repository, and none can write
`main` directly ([ADR 0012](adr/0012-supply-chain-posture.md) §3):

1. The fetch host's SSH deploy key — pushes `data/*` branches only.
2. `data-sweep.yml` / `normalise.yml` / `pr-dataset-labels.yml` per-run tokens —
   open PRs and (for the data sweep) merge PRs whose diff the allowlist confirms
   is data-only; land on `main` only through the reviewed, ruleset-gated PR.
3. The `deploy` job token — `pages: write` + `id-token: write` only; publishes
   the site, cannot write repository contents.

## See also

- [`adding-a-dataset.md`](adding-a-dataset.md) — the contributor how-to for a new
  entry, with the local verify commands.
- [`normalised-schema.md`](normalised-schema.md) — the open-data lane's derived
  schema, data strata and line-accounting invariant.
- [`source-register.md`](source-register.md) — every known source and its intake
  status.
- [ADR index](adr/README.md) — the full set of architecture decisions.
