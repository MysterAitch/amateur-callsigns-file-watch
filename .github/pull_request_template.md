<!--
  Delete every section and comment that doesn't apply, and don't pad: a one-line
  bugfix deserves a one-line body. The one rule behind all of this — SHOW, DON'T
  TELL: a reviewer should never have to infer, guess, or re-derive whether the
  work is done and correct. Give them the evidence so they can spend their
  attention on "is it done WELL", not "is it done".

  Start with one sentence: what this changes and why. Then link the issue:
    Closes #N     — this PR fully resolves it
    Addresses #N  — partial; say what remains (several targeted PRs to one
                    issue are fine and encouraged)
    #N            — an arc/data PR that advances but doesn't close it
-->

## What
<!-- The changes, as bullets with a bold lead-in each. -->

## Evidence
<!--
  Show it meets the issue's requirements, at the highest fidelity that's cheap:
    - before / after values or markup — e.g. `60% → 70% ink`, `<td>` → `<th scope="row">`
    - quoted rendered output or real-corpus counts — e.g. "0 escaped, 150 rendering, 8 tables wrapped"
    - a screenshot for any VISUAL change (attach the image — humans read these fastest;
      drag-drop into the PR on the web, or paste an uploaded-asset URL)
  Prefer measured figures over adjectives: "≈2.7:1 → ≈5.1:1", not "better contrast".
-->

## Verification
<!--
  Concrete commands + named test file(s) + exact pass counts — not "tests pass". e.g.
    `npx tsc --noEmit` clean · `npm run lint` clean · `vitest run src/…/foo.test.ts` — 42/42 pass
  Data PRs: `npm run validate:data` green + golden-master byte-stable.
  Note honestly anything deferred to a post-deploy or manual check.
-->

## Scope & follow-ups
<!-- What is deliberately NOT in this PR, and why. Deferred items, follow-on issues. -->

<!--
  Type-specific slots — add whichever fit, delete the rest:
    Data ingestion — Provenance & integrity (sha256, capture source + date, manifest);
                     Dataset at a glance (files / headers / rows); Anomalies preserved
                     (normalise the assertion, never repair it).
    Converter/normaliser — Schema decisions; Row counts.
    Verification pass — severity-tiered corrections (CRITICAL / MAJOR / MINOR) with
                        before → after values, re-verified against raw bytes.
    Assumptions — decisions taken under ambiguity.
    Docs / design only — "No behaviour change" / "No code — doc only".
-->
