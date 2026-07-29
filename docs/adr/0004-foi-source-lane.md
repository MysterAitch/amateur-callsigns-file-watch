# ADR 0004 — FOI source lane — request-keyed archive entries, data optional, correspondence always

- Status: accepted
- Date: 2026-07-07
- Related: issues #9, #19, #25 (intake principles), #133 (response-letter pattern); ADR 0010 (the archive contract this lane extends), ADR 0012 (supply-chain posture — sanctions the hand-rolled xlsx extractor named below)

> *(Amended 2026-07-29.)* The open questions decision item 5 names have since
> been settled without changing the decision: xlsx→csv extraction is the
> hand-rolled, dependency-free `src/shared/xlsx-extract.ts` (ADR 0012 records
> why), per-release converters exist as authored `{script, variant}` bindings in
> each entry's `meta.json` (`src/shared/foi-normalise.ts`; the generated registry
> is `docs/foi-schemas.md`), and FOI-lane validation has joined the required
> `data-validation` check, so every declared file is hash-verified before any
> merge. Every mechanical derivative is also re-derived from the committed bytes
> and byte-compared on every pull request (`src/ci/foi-verification.ts`).

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

The choice of the **numeric request id as the identity** inside a
`wdtk-{requestId}--{slug}` key is load-bearing, not cosmetic. A
WhatDoTheyKnow request has two names: the numeric id, which is immutable and
is what the WDTK API and attachment URLs are keyed by, and the URL slug,
which is derived from the request title and can be renamed on the WDTK side
(site admins retitle requests; the old slug then redirects or dies). Keying
identity off the slug would let an upstream rename orphan an entry or invite
a duplicate under the new name — the same silent-duplication failure the
open-data lane guards against with content hashes (ADR 0010). So the id
segment is the identity, enforced by validation (`meta.json`'s `requestId`
must equal the key's `wdtk-{id}` segment — `src/ci/validate-foi.ts`), and
the slug segment is a human-readable courtesy frozen at intake: if WDTK
later renames the request, the entry key deliberately does not change.
Direct-from-Ofcom entries have no WDTK id, so their handle is the Ofcom FOI
reference where the disclosure states one; where it does not (several
disclosure-log and web-archive captures carry no case reference), the
practice that grew inside this rule is a date or vintage segment instead,
with `meta.json` recording `ofcomReference: null` and a note saying why —
declared absence rather than an invented identifier, per the archive
contract's honesty rules (ADR 0010).

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
- An entry's files divide into two classes with opposite maintenance rules,
  and the reason is what each one *is*. Raw attachments, the correspondence
  transcript, and witness records (where a copy was seen, when, and the hash
  of the bytes it served) are **observations**: they record events that
  cannot be re-run, so they are append-only — a correction is a new
  observation alongside the old, never an edit that destroys the chain of
  custody. Mechanical extracts and `normalised--*.csv` are **derivations**:
  they are recomputable from the committed bytes at any time, and a CI check
  proves it by re-deriving every one and byte-comparing on every pull
  request (`src/ci/foi-verification.ts`). Regenerating a derivation under an
  improved converter is therefore safe and expected — the reviewed PR diff
  is the record of the change — whereas "regenerating" an observation is a
  contradiction in terms. Anything that judges agreement between witnesses
  is derived on read from the stored hashes, never stored as a verdict, so
  the observation layer stays free of conclusions that could go stale.
