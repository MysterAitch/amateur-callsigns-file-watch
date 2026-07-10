# ADR 0011 — Two-tier architecture: a minimal residential fetch host, everything else in-repo

- Status: accepted
- Date: 2026-07-10
- Related: ADR 0001 (in-repo processing), ADR 0009 (how the tiers hand off), ADR 0003 (in-repo presentation)

## Context

Exactly one part of this system has a hard placement constraint: fetching from
Ofcom's opendata page only works from a residential IP, because Cloudflare
blocks datacenter ASNs and serves GitHub-hosted runners and cloud VMs a
challenge page instead of the CSV. Everything else — normalisation, FOI
derivation, validation, report and database builds, the site — has no such
constraint and can run wherever it is cheapest and safest to run it.

This split has been the working shape of the project since deployment, but it
has never been recorded as a decision: the residential-fetch requirement is
documented in the README's automation section, and the "processing runs
in-repo" half is ADR 0001, yet the two-tier framing that ties them together —
and the deliberate choice to keep tier one *minimal* — is nowhere formal. This
ADR states it.

## Decision

**The system is two tiers with a single, narrow interface between them.**

1. **Tier one — the fetch host — stays a minimal downloader.** Its whole job is:
   detect an upstream change, download, sanity-gate the bytes, commit the raw
   entry, and push it to a `data/*` branch (ADR 0009). It holds only a
   write-scoped SSH deploy key, runs on an always-on residential host (a homelab
   LXC or equivalent), and carries none of the derivation logic. The
   network-origin requirement applies to this tier and nothing else. Keeping it
   minimal is the point: a converter bug, a heavy dependency, or a processing
   crash must never be able to endanger the fetch loop, and the host must never
   need a credential broader than "push a branch".

2. **Tier two — everything derivable — runs in this repository.** Normalisation,
   FOI extraction and conversion, data validation, the golden-master report
   builds, the SQLite database, and the Pages site are all produced by
   scheduled, PR-gated GitHub Actions workflows running reviewed code from
   `main` (ADR 0001, ADR 0003). Derived artefacts are rebuildable from the
   archive by definition, so this tier holds nothing irreplaceable; its only
   write path is opening pull requests.

3. **Consumer surfaces are created lazily.** Anything downstream of the archive
   contract ("directory structure + `normalised.csv` + metadata") is built when
   a real need appears, not pre-provisioned. Because derived content is
   rebuildable, migrating it out to a downstream repository later stays cheap,
   and the archive can revert to a pure-raw store without loss if that is ever
   wanted.

## Consequences

- The interface between the tiers is exactly the `data/*` branch push
  (ADR 0009). Neither tier needs to know the other's internals: the host does
  not run converters, and the in-repo workflows do not fetch from Ofcom.
- Adding a new source is a single-repo change (a source module plus a
  converter); the fetch host only gains work if the new source also needs a
  residential origin.
- Standing infrastructure is kept to the one always-on host the constraint
  actually forces. No second long-lived server and no downstream polling repo
  are provisioned speculatively — both were considered and rejected as burden
  without benefit under this split.
- If a future source can be fetched from a datacenter IP (for example, an
  archive replay fronted by a CDN), it can run entirely in tier two, and the
  residential host stays scoped to the sources that genuinely require it.
