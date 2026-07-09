# ADR 0007: Publish the coverage dashboard as a site page, keep a workflow alarm

Date: 2026-07-09
Status: proposed

## Context

The normalisation-coverage dashboard (issue #43) is maintained as an
auto-updated **GitHub issue**: the normalise-sweep workflow finds it *by its
exact title* and rewrites the issue body on every run. This works, but it has
real downsides:

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

Relates to #43 (the dashboard), #229 (reports publishing), #243 (freshness gate).
