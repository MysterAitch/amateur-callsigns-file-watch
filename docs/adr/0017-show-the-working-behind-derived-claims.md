# 0017. Show the working behind derived claims (reconstruct-on-read)

Status: proposed
Date: 2026-07-12
Relates: #433, #361 (raw-keyed claim ledger, ADR 0013), #404 (trust-rating net, ADR 0014), #431/#436 (source position + permalinks, ADR 0015), #434 (file-level claims + reconstruction oracle, ADR 0016), #310/#329 (shared affordances + glossary cue)

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
   reference-row `(file, key)`, or a sibling-observation key). Turning an origin
   into a computed-on-read permalink, and rendering the JS-free "show working"
   disclosure, is the surface affordance (P4), deferred to a follow-up lane;
   `explain` returns only the origins.

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
- The rule set the oracle explains is the FULL derived vocabulary emitted today —
  `cleaned-callsign`, `placeholder-form`, `callsign-pattern`, `licence-category`,
  `stripped-collision`, and the `parse-callsign` fan-out — not only the four the
  original design enumerated: the fail-loud "no derived claim is unexplainable"
  invariant forces completeness, so the #422 callsign-pattern rule is explained
  too.
- Scope is the backend engine plus its oracle (design phases P1–P3). The P4 UI
  affordance (the "show working" disclosure, permalinks, glossary-sourced gloss)
  is a separate follow-up.
