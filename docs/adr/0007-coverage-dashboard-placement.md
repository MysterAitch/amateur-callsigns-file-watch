# ADR 0007 — Publish the coverage dashboard as a site page, keep a workflow alarm

- Status: proposed (not implemented — the dashboard remains the title-keyed issue)
- Date: 2026-07-09
- Related: issues #43 (the original dashboard issue, closed and continued as #360 — the title-keyed reopen this record anticipated), #360 (the live rolling dashboard the report sweep finds by exact title), #229 (reports publishing), #243 (the freshness gate)

> *(Amended 2026-07-29.)* This remains a proposal, and the state it describes
> is still current: the coverage dashboard is the auto-updated issue
> "Normalisation coverage (rolling dashboard)" (#360), which the report sweep
> (`.github/workflows/reports-sweep.yml`) still finds **by its exact title**
> and rewrites on every run — the load-bearing-title fragility this record
> names is live, and the reopen-under-a-new-number failure it anticipated has
> already happened once (#43 → #360). No committed `reports/coverage.md`
> exists yet. The decision below is the recorded direction, not a description
> of the built system.

## Context

The normalisation-coverage dashboard (issue #43) is maintained as an
auto-updated **GitHub issue**: the scheduled sweep workflow (today the report
sweep, `reports-sweep.yml`) finds it *by its exact title* and rewrites the
issue body on every run. This works, but it has real downsides:

- The title string is a load-bearing lookup key — renaming or closing the issue
  silently orphans the automation (or makes it reopen/duplicate).
- It is far less discoverable than the site, and sits apart from the rest of the
  published reporting.
- It is not versioned in git, so a change is not a reviewable diff.

Since the standing reports and `docs/dataset-status.md` are now published as site
HTML under `/reports/` (issue #229), a coverage page is a natural home. The one
capability the issue provides that a static page does not is **re-alarming**: a
failed entry turns the sweep run red and keeps the issue red until fixed.

## Decision

**Hybrid. Publish the coverage dashboard as a committed, sweep-regenerated
`reports/coverage.md` rendered to `/reports/coverage.html` and linked from the
reports hub — the primary, discoverable, git-diffable surface — and keep a
lightweight failure signal (the workflow run status, and optionally the existing
alarm issue) purely for re-alarm-on-drift. The page is the source of truth; the
alarm is a notification, not the record.**

The sweep step that currently rewrites the issue body instead (or additionally)
writes the committed report; the re-alarm-on-failure behaviour is preserved via
the workflow's own red/green status (a failed sweep already fails the run). If an
alarm issue is retained, it becomes a thin pointer to the page, not the dashboard
itself, and its title stops being load-bearing.

## Consequences

- **For:** discoverable and consistent with the rest of the reporting; versioned
  (PR diff = change signal, enforced by the golden-master freshness gate #243);
  no fragile title lookup.
- **Against / costs:** a static page cannot itself "go red", so the alarm must
  live in the workflow status (or a thin issue); migrating means rewriting the
  sweep's issue-update step and adding the page to the build.
- **Migration:** additive — the page can ship before the issue is retired; the
  issue can be demoted to a pointer or closed once the page is trusted.

Relations are recorded in the `Related` header above, so they have a single home.
