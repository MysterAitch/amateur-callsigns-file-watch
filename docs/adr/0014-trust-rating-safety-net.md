# ADR 0014 — The trust-rating model, derived from provenance and guarded against inflation

- Status: accepted
- Date: 2026-07-12
- Related: ADR 0013 (raw-keyed claim ledger), ADR 0010 (archive contract), ADR 0005 (canonical callsign forms); issues #155 (verification of the trust model), #398 (verification-coverage tracker), #361 (claim-ledger exploration)

## Context

The project surfaces two trust axes to consumers — **source authority** (per
dataset: how official the publisher is) and **claim confidence** (per value: how
sure we are of *this* value). Their rungs are fixed by `site/glossary.html` (the
`#axes` panel) and their conceptual home by ADR 0013: authority is a property of
where a source came from, and confidence is a **read-out of source authority
combined with production method**, never an independent editorial dial.

The rungs were defined and shown, but nothing *enforced* that a surfaced rating
matched what the provenance warranted. Authority was implicit — inferred by hand
in the one generator that labels it (`build-data-status`) from the lane and
`sourceKey` — with no single derivation that every surface had to go through, and
no check that two surfaces could not disagree. Confidence was the claim's `layer`
(`raw` / `derived`) plus its named `rule`, with no assertion that a `derived`
claim could not be dressed as a verbatim one. The specific failure this leaves
open is **trust-rating inflation**: a dataset or claim being surfaced at a
*higher* rung than its provenance and production method justify — a community CSV
dropped into the open-data lane and rated Official, or a computed value relabelled
as an as-published source fact. Automated self-checks are what make "move fast"
safe (issue #155, tracked on #398); the trust axes were the gap.

## Decision

**Derive both trust axes mechanically from provenance, through one canonical
function per axis, and enforce with committed, fail-loud checks that trust can
only *degrade* through derivation, never inflate.**

### Axis 2 — source authority, derived on read

- **The rungs** (`site/glossary.html`, best-to-worst known origin): Official →
  FOI → Reference → Community → Self.
- **Authority is a pure function of the lane** a source lives in. The lane is
  already an immutable fact of the archive layout: open-data publications under
  `archive/<date>/`, FOI disclosures under `archive/foi/**`, reference tables
  under `reference-data/`. `deriveSourceAuthority(provenance)`
  (`src/shared/source-authority.ts`) maps a provenance descriptor — a location
  string that names the lane, plus the declared `sourceKey` — to exactly one
  rung: `open-data → Official`, `foi → FOI`, `reference-data → Reference`,
  `project-derived → Self`, `community → Community`.
- **Derive on read, do not persist.** Because the lane is already the source of
  truth, a persisted `sourceAuthority` field on every `meta.json` would be a
  second copy that can drift from the lane it describes — and drift is exactly the
  failure mode being guarded. So authority is computed from the lane at read time;
  no golden changes, nothing new to keep in sync. The location classifier accepts
  both an archive-relative directory (`foi/<entry>`, a bare date key) and a claim
  ledger's `sourceFile` (`opendata/<date>/raw.csv`, `foi/<entry>/…`), so one
  derivation serves the metas and the ledger alike.
- **Ambiguity is flagged, never guessed upward.** A location matching no known
  lane, or a lane/`sourceKey` mismatch that would inflate — a date-keyed
  (open-data) entry declaring a non-Ofcom `sourceKey`, which would otherwise
  inherit the top Official rung — returns a *flag*, not a rung. The net never
  resolves an uncertain provenance to a flattering default.

### Axis 3 — claim confidence, a read-out of layer and rule

- **The rungs** (`site/glossary.html`): As-published → Computed → Looked-up →
  Community → Best-guess.
- **Confidence is read out, never stored.** `claimConfidence(claim)`
  (`src/v2/claim.ts`) maps a claim's `layer` and `rule` to a rung: a `raw` claim
  is *As-published* (the verbatim source token); a `derived` claim resolved via a
  reference table (the licence-category tier) is *Looked-up*; any other `derived`
  claim produced by a named rule is *Computed*. A derived claim never reads out
  As-published — derivation degrades confidence by construction.

### The no-inflation invariant, enforced

`src/ci/trust-rating.ts` carries three checks, pure over their inputs (archive
metas and `Claim[]`), returning violations; `assertTrustRating` throws on any, so
the committed tests (and an optional CI step) fail loud:

1. **Authority totality/consistency.** Every archive entry (open-data and FOI)
   resolves to exactly one valid rung via the canonical function — nothing is
   unclassified. And the label the dataset overview surfaces for each entry is
   reconciled against the canonical derivation, so no surface can show a rung the
   derivation contradicts.
2. **No-inflation on claims.** Over the claim ledger: a `raw` claim carries **no**
   rule and reads out As-published; a `derived` claim names a rule and reads out
   Computed or Looked-up (**never** As-published); every derived claim **traces
   to a raw basis** for its subject in the same source — directly, or through the
   `normalises_to` chain (raw token → cleaned → placeholder) — so no subject is
   invented; and the derived **licence-category tier is present only for a subject
   whose source disclosed a product**, never conjured onto a bare listed-only
   subject.

Together these assert that a value's surfaced trust cannot exceed its provenance
× production method.

## Consequences

- **Inflation is caught, demonstrably.** The committed tests include negative
  cases — a computed `normalises_to` edge relabelled `raw` (a computed value
  dressed as As-published), a derived claim missing its rule, a derived claim for
  a subject with no raw basis, and a licence-category tier on a subject that
  disclosed no product — each of which the net flags. A green suite is therefore
  evidence the guard works, not merely that the happy path passes.
- **One derivation, no drift.** Authority has a single mechanical source of truth
  that every surface is reconciled against; there is no second persisted copy to
  fall out of step with the lane.
- **The model is retained, not redefined.** The rungs and their meaning remain
  those of `site/glossary.html` and ADR 0013; this ADR records how they are
  *derived and enforced*, and adds no new axis or vocabulary.
- **First draft, deliberately minimal.** The claim invariant is exercised in CI
  over a representative real sample carrying every claim shape rather than the
  full multi-million-claim corpus; the functions are pure over `Claim[]`, so the
  same checks scale to a whole-corpus or streaming gate unchanged when that cost
  is warranted. The `project-derived` and `community` lanes are defined in the
  derivation ahead of a source that populates them, so a future community or
  self-derived source classifies without a code change.
