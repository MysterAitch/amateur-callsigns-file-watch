# ADR 0017 — Show the working behind derived claims (reconstruct-on-read)

- Status: accepted
- Date: 2026-07-12
- Related: #433 (backend engine + oracle), #438 (P4 surface: inline nudges + deep-dive that render this working), #361 (raw-keyed claim ledger, ADR 0013), #404 (trust-rating net, ADR 0014), #431/#436 (source position + permalinks, ADR 0015), #434 (file-level claims + reconstruction oracle, ADR 0016), #310/#329 (shared affordances + glossary cue)

## Context

Every derived claim in the ledger names the `rule` that produced it (the HOW),
but the EVIDENCE it was computed from — the input raw claim(s), the reference
rows, and any sibling observation — is not surfaced. We want that working to be
trivially discoverable and re-verifiable, generalising "show, don't tell" from
PRs and issues to the data itself.

The working is already latent: it is `rule` + the same-observation raw claims +
the versioned reference tables, all in hand. A derived claim's
`provenance.(sourceFile, ordinal)` IS the join key to its raw basis (the raw
subject token and every raw attribute cell of that observation share it); the
one cross-row rule additionally reaches a sibling observation of the same source.
What is missing is not data but a rule-dispatched function that STRUCTURES those
existing inputs into a re-verifiable trace.

## Decision

1. **Reconstruct-on-read; store nothing extra.** A per-rule
   `explain(claim, ledger, ref)` (`src/v2/explain.ts`) re-runs the SAME lifted
   `components.ts` logic the emit path used and returns a structured
   `Working { inputs, steps, result }`. The working is computed on demand for the
   values actually shown, never materialised across the corpus.

2. **Same-code correctness.** Because `explain` calls the same `cleanedCallsign`
   / `parseCallsign` / `normaliseLicenceCategory` / `callsignPattern` the emitter
   called — every branch's `result` is produced BY calling the lifted function —
   the shown working cannot diverge from the claim. A stored copy of the
   derivation would be a second representation that can drift; a reconstruction
   cannot.

3. **Resolve pointers, do not store them.** Reference-table rules
   (`licence-category`, and `parse-callsign`'s `implied_class` via
   `prefix-formats.csv` and the forbidden-suffix flags via
   `forbidden-suffixes.csv`) return the matched reference-data row `{file,key,row}`,
   reconstructed from the loaded `ReferenceData` (no file I/O). `stripped-collision`
   returns the sibling observation's key, found by re-running the same
   strip-and-membership test `componentsFlagsForRows` performs. Both are resolved
   at read time, never persisted per claim.

4. **No corpus inflation; #404 untouched.** `explain` adds no claims, no fields,
   and no serialisation change; the JSONL/N-Quads bytes and the fat-vs-compact
   `claims` VIEW multiset are identical, and `checkNoInflationClaims` inspects
   `layer`/`rule`/subject exactly as before. Stored input-references are REJECTED
   as the default: they would hang provenance rows off millions of derived claims,
   introduce a drift-prone second copy of the derivation, and force a JSONL/golden
   change for zero query benefit.

5. **Fail loud on a gap.** Explaining a raw claim, a derived claim with no rule,
   or a rule the dispatcher does not know THROWS. An unexplainable derived claim
   is a surfaced gap, never a silent blank — the same posture as the reconstruction
   oracle's explicit non-coverage.

6. **Clickable chain via #431 (the surface's job).** Each `WorkingInput.origin`
   carries the coordinates (a raw-claim `(sourceFile, ordinal, predicate)`, a
   reference-row `(file, key)`, or a sibling-observation key); `explain` returns
   only the origins. The reusable P4 render engine that turns each origin into a
   computed-on-read permalink and renders the JS-free "show working" disclosure
   landed with #562 (`src/ci/render/show-working.ts`, composing #431's
   `permalinkForProvenance`). The fidelity and integrity deep-dive
   (`fidelity.html#show-working`) is its first production consumer — rendering real
   derived claims from the newest archived publication through this engine (#438,
   #601); the remaining generated surfaces followed under the same issue, and
   #438 has since closed with that surfacing arc delivered.

7. **Self-checked by a committed oracle.** A CI self-check beside
   `trust-rating.ts` (`src/ci/explain-oracle.test.ts`) asserts, over a
   representative real-archive sample, that `explain(claim, ledger, ref).result`
   equals `claim.object` for every derived claim, that every input origin resolves
   to something real, and that no derived claim is unexplainable. Because `explain`
   computes `result` solely from the inputs it returns, that equality also proves
   the inputs are sufficient — not a plausible-looking subset.

8. **Escape hatch (deferred, not built).** If a pure-data/RDF consumer ever needs
   the working inline WITHOUT the derivation code, emit it as a SEPARATE derived,
   rule-tagged lens reproducible from `explain` (degrading to Computed) — never in
   the observation ledger, never dressed as source. Not the default; recorded so
   the door is left open.

## Consequences

- A reader tracing any derived value gets its inputs, an ordered transformation
  trace, and the reproduced result — and can re-verify that the value genuinely
  reproduces from them.
- The derivation stays single-sourced in `components.ts`; the working is a
  projection of it, so it cannot rot.
- Additive: no format or golden change; legacy ledgers and the #404 no-inflation
  trace are undisturbed, because nothing is stored.
- The completeness guarantee is the MECHANISM, not a fixed list: the fail-loud
  "no derived claim is unexplainable" invariant forces the dispatcher to cover
  the full derived vocabulary the ledger emit produces, whatever it grows to.
  At acceptance that vocabulary was `cleaned-callsign`, `placeholder-form`,
  `callsign-pattern`, `licence-category`, `stripped-collision` and the
  `parse-callsign` fan-out — already wider than the four the original design
  enumerated (the #422 callsign-pattern rule was forced in exactly this way) —
  and the tiers added since joined the dispatcher the same way:
  `authored-event-vocabulary` and `authored-binding-role` from the #813
  promotion, and `event-date-extraction` from the #725 event-time tier. The
  within-table column flags of ADR 0018 explain through their own
  `explainColumnFlag`, reusing this decision's `Working` shape.
- The backend engine plus its oracle (design phases P1–P3) and the reusable P4
  render engine — the "show working" disclosure and its permalink resolver
  (#562) — have landed, and the fidelity and integrity deep-dive (#438, #601) is
  the render engine's first production consumer. The remaining generated
  surfaces followed under #438's inline-nudge + deep-dive work, which has since
  closed with that arc delivered.
- The render engine also carries the #439 "examine" affordance: a derivation-
  code register maps each emitted rule to the function whose re-run IS its
  working (linked as a pinned blob inside every rendered disclosure — the
  same-code guarantee made clickable), and a shared examine trail walks any
  displayed record to its pinned source line, its working, and its entry's
  provenance — degrading honestly to provenance alone where a working is not
  exposed.
