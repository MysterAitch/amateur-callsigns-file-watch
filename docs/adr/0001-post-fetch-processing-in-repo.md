# ADR 0001 — Post-fetch processing runs in this repository via scheduled, PR-gated GitHub Actions

- Status: accepted
- Date: 2026-07-06
- Related: issues #1 (decision thread), #14, #15, #18, #25

## Context

The mirror's fetch step is deliberately minimal: detect upstream change, download, sanity-gate, commit raw bytes. Everything derivable — normalising the upstream's shifting column schema into a canonical form, quality reports, XLSX/PDF extraction — must run somewhere, and that location determines the project's write-credential surface, recovery story, and the ergonomics of adding new sources.

Constraints already settled elsewhere and treated as fixed here:

- The fetch host stays "just a downloader"; the network-origin requirement applies only to fetching.
- `archive/{key}/raw.*` is the authoritative byte-for-byte record; nothing may compromise it.
- `.npmrc` `ignore-scripts=true` applies wherever code runs; no unconstrained `contents: write` workflows; no push-triggered workflows that grant write to code-executing steps.
- Per-publication derivatives are archived only when the derivation logic is expected to evolve (normalisation is the canonical case).

## Decision

Normalisation and all other post-fetch processing run **in this repository**, in a **cron-scheduled GitHub Actions workflow whose only write path is opening pull requests**.

1. **Trigger: schedule, not push.** The workflow executes only code already reviewed onto `main`, and a scheduled sweep ("find archive entries whose source has a converter but whose `normalised.csv` is missing or stale") uniformly picks up data however it arrived: fetcher pushes, manually-added datasets, or converters written long after their data landed.
2. **Writeback: PR only.** A branch ruleset on `main` (no direct pushes, no force pushes) applies to the workflow token too. CODEOWNERS requires human review on code paths (`src/**`, `.github/**`); data-only PRs may auto-merge on green checks.
3. **Normaliser code lives with the data.** The contract offered downstream is "directory structure + `normalised.csv` + metadata"; consumers never need to read raw or re-implement schema-drift handling. The converter revision is versioned in the same history as the output it produced.
4. **Re-run ("golden master") semantics.** `archive/{key}/normalised.csv` is the *current-best* derivation, not frozen at publication — git history preserves the at-publication view. Converters are re-run across all entries: byte-identical output is a no-op; changed output (converter fix, extraction-library improvement) produces a PR whose diff across affected entries is the review artefact. Converters must therefore be byte-deterministic given (raw bytes, converter code, dependency versions): stable ordering, no timestamps in output.
5. **Raw acceptance is never blocked on processability.** Datasets enter the archive on the strength of honest provenance metadata alone; normalisation is an optional enhancement (see #25).
6. **Machine-friendly exports** (JSON/SQLite/etc. of the latest normalised dataset) are built in the same lane but published as Pages artefacts, not committed — they are wipe-and-rebuild by nature.

## Consequences

- Prerequisites, in order: retire the defunct write-scoped workflow (#18); ruleset + PR-based data landing (#14); read-only CI so PRs are gated (#15); then the normaliser workflow.
- Supply-chain exposure of processing dependencies (CSV/XLSX/PDF libraries) is contained to a workflow that can only open PRs; pinned action SHAs and `ignore-scripts` apply throughout. Unexplained diffs in a re-run PR double as a detection signal for broken or compromised dependency updates.
- Adding a source remains a single-repo change: drop the source module + converter, one commit.
- Consumer surfaces stay out of this repository and are created lazily (#17). If this repo ever needs to become a pure-raw archive, migrating derived data out to a downstream repo remains cheap, because derived content is rebuildable by definition.

## Alternatives considered

- **Downstream derived repository (polling this one).** Strongest structural isolation ("no automated credential can reach raw") but splits each archive entry across repositories, doubles the touch-points for every new source, and multiplies the surfaces whose protections must be kept current. Documented fallback rather than the choice.
- **Processing on the fetch host.** Role creep; a converter bug must never endanger the fetch loop; long-lived repo-wide deploy key is the weakest credential shape here.
- **A second always-on host.** Standing infrastructure burden for a job GitHub-hosted runners already do under the constraints above.
- **Push-triggered or direct-push workflows (including two-job artifact patterns).** Either violates the no-write-on-push rule or still ends in unreviewed writes to `main`; dominated by the scheduled PR pattern.
- **Manual workstation runs.** Defeats unattended operation.
