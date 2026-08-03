# ADR 0025 — Contributions we publish outward are tagged, and never counted as corroboration

- Status: accepted
- Date: 2026-07-30
- Related: [ADR 0013](0013-raw-keyed-claim-ledger.md) (the raw-keyed claim ledger and its derived folds — the canonical record this constrains), [ADR 0015](0015-source-intrinsic-vs-archive-provenance.md) (source-intrinsic versus archive provenance — this adds *direction* to that provenance model), [ADR 0014](0014-trust-rating-safety-net.md) (the trust-rating safety net, whose no-inflation property this protects); issues #973 (the ecosystem-citizen posture this boundary belongs to), #1000 (the direction hub that states the posture in one line)

## Context

The project intends to be a good citizen of the wider amateur-radio ecosystem
rather than a competing destination: to feed and strengthen what already exists,
contribute corrections and enrichment back to community resources, and be the
thing people reference rather than migrate to.

One of those community resources is also a **source this project cites**. That
creates a loop, and the loop has a well-known failure mode. Wikipedia names it
**circular reporting**, and the special case where a claim originates in the
citing work itself is **citogenesis**:

1. This project derives a claim and publishes it outward to a community resource.
2. Later intake reads that resource as a source.
3. The claim arrives looking like an *independent* second observation.
4. A corroboration count that treats sources as interchangeable now reports two
   witnesses where there has only ever been one.

The consequence is specific rather than philosophical. Corroboration is already
load-bearing machinery here — though notably it is specified in the registers
rather than in any decision record: [`docs/source-register.md`](../source-register.md)
carries source authority and curation status, and
[`docs/hypothesis-register.md`](../hypothesis-register.md) uses a **two-witness**
bar to decide when a finding may be stated rather than flagged. Both reason over
claims folded from the ledger (ADR 0013). A laundered self-citation does not merely add
noise — it silently satisfies that bar. The mechanism designed to stop a single
source being over-trusted is defeated by the project's own output, and nothing in
the artefacts would show it.

This is a live hazard rather than a hypothetical one, because the outward
contribution is intended and the resource is already cited.

## Decision

**Every claim this project publishes to an external resource carries a
directional provenance marker, and the intake side excludes our own contributed
content from corroboration counts.**

1. **Provenance carries direction, not just origin.** ADR 0015 separates what a
   source intrinsically asserts from what the archive knows about obtaining it.
   This adds a third question: *which way did this claim travel?* A claim we
   received is `inbound`; a claim we published outward is `outbound`. A source
   record that re-presents our own outbound claim is marked as such and is not an
   independent witness.

2. **The exclusion is mechanical, not editorial.** It must be a property of the
   corroboration computation, not a reviewer's discipline. A rule that depends on
   someone remembering the loop existed will fail exactly when the corpus is large
   enough for the loop to matter.

3. **Community claims start as flags, not findings.** A claim held only by a
   community resource stays a flag awaiting corroboration until it is
   cross-referenced against an official or formal source held in the archive.
   This follows the existing convention that flags never become verdicts without
   evidence, and it is what keeps step 4 above from being reachable at all.

4. **The direction of the loop differs by data kind, and both directions are
   named** so the hazard is identifiable by construction:
   - **Activity data — this project is downstream.** It aggregates from
     platforms where holders already log, and is never itself an upload
     destination. Attribution, timestamps and independent verification arrive
     already attached rather than being manufactured here. This is the
     no-original-research principle pointed at activity data, and it starts the
     custody chain stronger than a first-party upload could.
   - **Community knowledge — this project is upstream.** It contributes outward
     and the resource is downstream of it. This is the direction in which the
     circular hazard actually runs, and therefore the one the marker exists for.

## Consequences

- **Corroboration counts become smaller and more honest.** A count that drops
  when this rule lands was previously inflated; that is the rule working, not a
  regression.
- **Outward contribution stays safe to do.** Without this the only safe options
  would be to stop contributing or to stop citing the resource — both of which
  cost more than the marker does.
- **It constrains the ledger's collectors,** which must carry direction through
  from intake rather than discarding it, in the same way source-intrinsic and
  archive provenance are already kept separable.
- **It cannot be retrofitted cheaply.** Once outbound claims are in an external
  corpus untagged, distinguishing them later means reconstructing what was
  published and when — from this side only, against a resource that has since
  been edited by others.

## Confirmation

**Nothing enforces this today, and that is stated rather than implied.** No
outward contribution has been made, so there is no tagged claim to check and no
corroboration count that could yet be wrong. The honest status is a decision
recorded ahead of the mechanism it requires.

What that means concretely: **the marker and the exclusion must exist before the
first outward contribution, not after it.** The retrofit cost above is why the
ordering is load-bearing. Tracked as an issue rather than left as a conclusion
with no downstream effect.

## Revisit when

- The project stops contributing outward at all, or stops citing any resource it
  contributes to — either breaks the loop and makes the marker unnecessary.
- Corroboration stops being counted over sources, so that "two witnesses" is no
  longer a property any consumer relies on.
- An external resource gains its own provenance model rich enough to identify
  re-presented upstream claims, making the marker redundant on their side.
