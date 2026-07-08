# ADR 0004: FOI source lane — request-keyed archive entries, data optional, correspondence always

Date: 2026-07-07
Status: accepted

## Context

The project now holds a decade of FOI-sourced material (2016–2024, surveyed
and staged in the local-only `landing/` drop zone): full-register snapshots,
callsign/prefix/suffix attribute addenda, and responses that carry no data
at all but are records worth keeping — "information not held" answers,
refusals, and policy statements (e.g. Ofcom ref 01618385: the G2/two-letter
heritage cycle of 2018–2020, on the record).

The existing archive lane (`archive/{yyyy-mm-dd}/`) means "Ofcom published
this file on this date": the key is a publication date, the raw file is the
publication. FOI material fits badly there — its natural unit is the
*request* (which may yield several files, one file, or none), its dates are
request/response dates, and its provenance is a WhatDoTheyKnow request or an
Ofcom FOI reference rather than the open-data page.

Issues #9/#19/#25 settled the intake principles (wdtk-{request_id} keys,
feed-probing, pointers-not-snapshots for live tracking); this ADR settles
the at-rest layout and its invariants.

## Decision

1. **A second source lane under the archive tree: `archive/foi/`**, one
   entry per FOI request/event:
   - `archive/foi/wdtk-{requestId}--{slug}/` for WhatDoTheyKnow requests;
   - `archive/foi/ofcom-{reference}--{slug}/` for FOI responses obtained
     directly from Ofcom (no WDTK request exists, e.g. the July 2017
     web-link CSV).
   The open-data lane keeps its date keys and publication semantics
   unchanged. `listArchiveKeys()` (and everything downstream: sweep,
   latest-pointer maintenance, entry reports) is constrained to
   date-shaped keys — a defensive tightening that is correct independently
   of this ADR.

2. **Entries are valid without data.** An entry's invariant is: `meta.json`
   plus `correspondence.md`, with dataset files optional. A "not held" or
   refused response gets a full entry — the answer is the record, and its
   existence prevents the same line of enquiry being re-investigated
   (see `docs/source-register.md`, which becomes a thin cross-lane index).

3. **Entry contents:**
   - `meta.json` — schemaVersion, `sourceKey: "wdtk-foi"` (or
     `"ofcom-foi"`), request id, Ofcom reference, canonical request URL,
     request/response dates, outcome state, and a `files` map declaring
     every committed file with size/sha256 (correspondence included — the
     chain of custody covers transcripts too).
   - `correspondence.md` — the transcript: a citation header (Ofcom
     reference, WDTK URL, dates, outcome), then the exchange. Ofcom's
     words may be quoted in full (public authority statements); requester
     text is summarised or quoted sparingly with attribution. **Never the
     request-…@whatdotheyknow.com addresses or any other personal-data
     artefact.**
   - **Data attachments verbatim** (xlsx/csv as served, byte-preserved,
     `.gitattributes`-marked binary like other raw files).
   - **Response-letter PDFs: committed when publishable, local-only
     otherwise.** *(Amended 2026-07-08 to record the practice ratified with
     the #133 pattern — the original text said letters were never
     committed.)* Letters whose content is publishable ARE committed
     verbatim as disclosure events with `role: response-letter` (or `data`
     where the letter itself carries the disclosed dataset): Ofcom-published
     copies are redacted by Ofcom before publication, and WDTK-served
     letters free of withheld personal data (e.g. the wdtk-356636 response)
     qualify equally. Letters embedding requester email addresses or other
     personal-data artefacts stay in the local drop zone; the committed
     transcript carries their content, and meta.json records their
     existence and sha256 so the local original is verifiable without being
     published.
   - WDTK `.json` and saved HTML likewise stay local-only (ADR-adjacent
     rule already enforced by gitignore).

4. **Validation** extends to the FOI lane: every file declared in an
   entry's meta is hash-checked; no raw.csv requirement; date-key rules do
   not apply. The open-data deep-validation (uniqueness etc.) does not run
   on FOI entries until a converter lane exists for them.

5. **Derivation comes later, per release.** FOI datasets get converters
   only when their schema work is done (xlsx→csv determinism and the
   parsing-library decision are OPEN questions under the supply-chain
   posture — precompiled/audited dependency or hand-rolled minimal
   reader). Until then entries are raw-plus-provenance, which is already
   the archive's founding rule ("raw acceptance never blocked on
   processability"). Attribute addenda (e.g. the reciprocal-licences
   list) are distilled into `reference-data/` via reviewed PRs that cite
   their FOI entry — the entry holds the bytes, reference-data holds the
   join-able distillation.

## Consequences

- Transcripts co-locate with their source event universally — including
  the dataless ones — satisfying the one-structure principle without a
  split rule. The previously mooted `docs/foi-correspondence/` is not
  created.
- `docs/source-register.md` remains the cross-lane index (statuses,
  wanted-list) but stops being the only home of FOI facts.
- Consumers (site, reports, stats) filter by lane; nothing iterating
  publication snapshots sees FOI entries unless it asks to.
- Ingestion flow: one PR per FOI entry (independently reviewable), then a
  single sweep dispatch derives any batch that has converters — one
  approval click per batch, not per dataset.
- The landing drop zone remains the staging area; graduation to an entry
  is a PR.
