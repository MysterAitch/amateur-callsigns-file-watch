# ADR 0003: In-repo presentation proof of concept (GitHub Pages + published SQLite)

Date: 2026-07-07
Status: accepted
Related: ADR 0002 (write posture), ADR 0008 (offline-first PWA over the same SQLite), ADR 0013 (raw-keyed claim ledger — reuses this vendored `sql.js-httpvfs` range-read path for the in-browser ledger query lane), ADR 0019 (the deploy workflow named below is now the `deploy` job of the unified `cicd.yaml`, with a layered build cache), ADR 0020 (the sharded static-JSON serving projection that now answers the single-callsign intent)

> *(Amended 2026-07-16.)* This ADR records the original proof of concept, in
> which the published SQLite database was *the* site data source. That framing
> has since moved on: [ADR 0013](0013-raw-keyed-claim-ledger.md) (see its status
> section) makes the raw-keyed claim ledger canonical and the databases one
> derived projection among several, and [ADR 0020](0020-sharded-static-json-serving.md)
> records the sharded static-JSON projection that now serves the common
> single-callsign intent with no database on that path. Read the historical
> content below in that light.

## Context

The repository's data now spans four strata (see `docs/normalised-schema.md`):
source mirror, reference data, derived data, and presentation. The first
three live here; presentation was assumed to live in downstream UI
repositories. Issue #17 anticipated a consumer surface (SPA / SQLite export).

A proof of concept demonstrating the full end-to-end flow — register →
normalisation → components → reference joins → browser — is more valuable
inside this repository than outside it, because what it demonstrates is
*this repository's data contract*.

## Decision

1. **A simple lookup site lives in this repository** (`site/`, deliberately
   frameworkless: no build step, no client-side npm supply chain). It is a
   contract demonstrator, not a product; richer consumer experiences remain
   downstream concerns.
2. **A SQLite database is published to GitHub Pages** as the site's data
   source, built by `src/ci/build-sqlite.ts` from committed data (latest
   dataset's `normalised` + `components`, statistics for every dataset, all
   `reference-data/` tables including the flag registry).
3. **The database is never committed.** SQLite files are not
   byte-deterministic, so the artefact lives outside the golden-master lane
   entirely: derived fresh on every deploy from committed inputs, which
   preserves the property that everything *in git* is reviewable and
   reproducible.
4. **The only client-side dependency, sql.js-httpvfs, is vendored at build
   time from the npm-audited package** (copied out of `node_modules` into
   the deploy artefact) — no CDN script tags, nothing vendored into git.
   It queries the database via HTTP range requests, so browsers fetch
   kilobytes, not the full ~24 MB file.
5. **Deploy workflow**: originally the standalone `.github/workflows/pages.yml`,
   now the site-build and `deploy` jobs of the unified
   `.github/workflows/cicd.yaml` (ADR 0019). The site assembles on every push and
   pull request (giving the deploy path pre-merge coverage), but the configure /
   upload / deploy steps are gated to `main`. `contents: read` throughout; only the
   deploy job holds `pages: write` + `id-token: write`. No repository writeback —
   consistent with ADR 0002's write posture. Actions are digest-pinned per repository
   convention.

## Repository settings changed

- **GitHub Pages enabled** with source "GitHub Actions" (Settings → Pages →
  Build and deployment → Source: GitHub Actions). Applied manually by the
  maintainer on 2026-07-07. To recreate: `gh api --method POST
  "repos/{owner}/{repo}/pages" -f build_type=workflow` (or the UI).

## Consequences

- Every merge to main redeploys the site with fresh data — derivation PRs
  therefore update the public lookup automatically once merged.
- The published database is a convenience copy, not a record: its integrity
  derives from the committed inputs it is built from, and it carries its
  source commit in `build_info`.
- The site publishes data already public in the repository; no new data
  surface is created, only a new rendering of it.
- If the PoC grows beyond "contract demonstrator", that growth belongs
  downstream (issue #17 remains the tracking issue for a full consumer
  surface).
