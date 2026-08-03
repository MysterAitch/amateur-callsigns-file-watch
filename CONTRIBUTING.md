# Contributing

## Adding a dataset

To add a new callsign dataset to the archive, follow
[Adding a dataset](docs/adding-a-dataset.md) — it covers which lane to use, the
converter binding, `meta.json`/`correspondence.md` authoring, generating and
verifying the derived files, and regenerating the corpus-wide goldens the change
shifts.

## Pull requests

Every PR body follows [`.github/pull_request_template.md`](.github/pull_request_template.md).
That template auto-fills in the GitHub web UI and in interactive `gh pr create`,
but it is **bypassed by `gh pr create --body`/`--body-file`/`--fill`**. When you
create a PR non-interactively, author the body to the same structure by hand —
the template is the contract, not just a form.

The governing principle is **show, don't tell**: a reviewer should never have to
infer, guess, or re-derive whether the work is done and correct. Include the
evidence — before/after values or markup, quoted rendered output or real-corpus
counts, a screenshot for any visual change — at the highest fidelity that's
cheap, and prefer measured figures to adjectives. Map the evidence to the linked
issue's requirements; state partial contributions explicitly (`Addresses #N`
with what remains, vs `Closes #N` when fully resolved — multiple targeted PRs to
one issue are fine). Keeping issues and PRs current is a priority, not an
afterthought.

**A measured figure carries its date and its source run** (a run id, a PR, or a
dated issue comment) wherever it is quoted — PR bodies, issue comments, ADRs and
docs alike. Stale figures actively mislead: an undated number reads as current
long after the world has moved, and the cost of that failure is recorded in
[ADR 0023](docs/adr/0023-fold-resource-tuning-by-measurement.md)'s consequences.

Don't turn this into a tickbox exercise: delete sections that don't apply and
don't pad. Pragmatism wins.

### How much review a change gets — scale to blast radius, and say why

Verification is scaled to **what it costs to be wrong**, not to the size of the
diff and not to politeness. State which level you chose and why, in the body — an
unstated choice cannot be disagreed with, and the reasoning is the part a reviewer
can check.

- **Full adversarial treatment** — foundation code everything else builds on;
  security guards; **anything whose failure is silent**; and durable factual
  claims or decision records, because those are read as settled and stop anyone
  re-deriving them. A wrong record misleads for longer than wrong code, which
  fails a test or a user and gets found.
- **Proportionate, then move on** — mechanical or behaviour-preserving changes
  where a corpus proves before equals after. Do not run a wide adversarial pass on
  a documentation tweak.

Two riders that are easy to miss:

- **Blast radius changes scheduling, not only review.** Wide-reaching work —
  cross-cutting renames, design tokens, sweep retirements, many-surface changes —
  runs on a deliberately light board: thin the concurrent lanes first so conflicts
  and regressions cannot compound. Parallelism scales inversely with blast radius.
- **Completeness is a separate question from correctness.** If a change fixes N
  instances of a class, say what establishes that N is the whole set. Three fixed
  is not evidence about a fourth. A class fix owes one of: a mechanical
  enumeration that can be re-run, a guard that fails when a new instance appears,
  or an explicitly stated bound ("swept X, found N, bounded at Y, residual filed
  as #n"). Without one of those it is a sample presented as a sweep.

## Writing conventions

### Search for prior wording before authoring an explanation

Before writing reader-facing copy that explains a concept, **search the whole
estate for an existing explanation and prefer carrying it across**. Look wider
than the current surface: the build-time renderers and page builders under
`src/ci/`, the preserved previous surface, `reference-data/flags.md`, and the
committed reports all carry reader-facing prose. A concept can be well explained
somewhere a search of the live pages will not reach.

This is not a tidiness preference — **authoring fresh loses substance, quietly.**
Two measured instances from one change:

- An explanation of why a version-scoped start date is the *earliest surviving*
  rather than the original was rewritten from scratch. The prior wording carried
  the consequence — that a later publication can hold **less** early history than
  an earlier one — and the fresh draft dropped it. That consequence is the whole
  point of the concept.
- An explanation of mass-update episodes was rewritten as "records a single
  system-wide episode". The prior wording hedged: a stamp inside an episode
  "**largely** records the episode itself". The rewrite turned a hedge into a flat
  claim, which is overstatement — the one failure this project treats as
  cardinal.

Prior wording has already been reviewed, and its hedges and consequences are
usually there because something forced them. A fresh draft starts from the
author's current understanding, which is exactly the thing that drifts. Where the
old wording is genuinely inadequate, extend it and say what changed; where it is
adequate, reuse it verbatim and link rather than restate, so there is one copy
rather than two that can diverge.

### Dashes differ by surface, deliberately

- **Reader-facing generated site copy: a spaced en dash** (` – `). Established by the
  typography pass on the v1 surfaces, where unspaced em dashes read heavy in short
  rendered strings and at small sizes.
- **Documentation and repository prose: the em dash** (`—`), unspaced. This is the
  established style here by a wide margin, and the two settled bi-temporal glosses
  are kept verbatim wherever they appear.
- **Numeric ranges: an en dash** on every surface (`2016–2024`, `19–25%`).

The split is worth stating because it is easy to assume one rule covers both, and
acting on that assumption would rewrite several hundred instances in `docs/` to no
benefit. If you are changing dashes in bulk, you are almost certainly applying the
wrong surface's rule — check which surface the text ships to first.

## What we will not trade away

These are the project's non-negotiables. A change that weakens one is rejected
regardless of what it buys, and "it is faster", "it is simpler" and "no user will
notice" are not arguments against them.

**This is the canonical statement.** They are summarised in one line on the
direction hub (issue #1000) and applied in many places; where a record, a doc or a
comment restates one, it should point here rather than re-derive it, so a
correction is one edit rather than a search.

- **Reproducibility and re-derivability.** Every published conclusion can be
  re-run from the archived bytes and reach the same answer. Nothing is asserted
  that cannot be regenerated. Applied in
  [ADR 0001](docs/adr/0001-post-fetch-processing-in-repo.md) and
  [`docs/adding-a-dataset.md`](docs/adding-a-dataset.md).
- **Error-locability.** When an output is wrong it must be possible to say *which
  step made it wrong*. A pipeline that produces a bad answer without indicating
  where the answer went bad is not acceptable, however good its outputs usually
  are. This is why derivations are staged rather than fused.
- **Chain of custody.** Every claim can be traced back through the steps that
  produced it to the source bytes it came from — generated on demand rather than
  asserted. See [ADR 0004](docs/adr/0004-foi-source-lane.md) and
  [ADR 0025](docs/adr/0025-outward-contributions-and-corroboration.md).
- **Bi-temporality: event time and assertion time never collapse.** *When
  something happened* and *when a source said it happened* are different facts,
  and a source revising its account of the past is itself an observation. Neither
  may be overwritten with the other. See
  [`docs/source-register.md`](docs/source-register.md).
- **Raw bytes verbatim.** A publisher's exact bytes are preserved unaltered,
  because the archive's identity is a hash of them; derived views are separate
  artefacts. See [ADR 0010](docs/adr/0010-archive-contract.md).
- **Fail loud.** Corrupt or misleading data is worse than no data. Where
  integrity is in doubt the correct behaviour is a hard, diagnosable failure, not
  a best-effort partial result that reads as complete. Applied throughout
  [ADR 0010](docs/adr/0010-archive-contract.md) and
  [ADR 0014](docs/adr/0014-trust-rating-safety-net.md).
- **No silent transformation — resolve *and* flag.** Cleaning, inferring or
  dropping anything without recording that it happened is forbidden. Where a
  value must be interpreted to be usable, both the interpretation and the fact of
  interpreting are published.
- **Flags never verdicts.** Surfacing that something deviates from its neighbours
  is not the same as ruling on why, and the vocabulary must not smuggle in a
  judgement the evidence does not support. Name the mechanism or the purpose, not
  an imputed state of the source.
- **Corrections by adding a source, never by editing history.** A wrong claim is
  superseded by new evidence recorded alongside it. Published history is not
  rewritten to make the present look tidier — including when the error was ours.
- **Right of reply.** A record about a real person or organisation carries a route
  for them to contest it, and a contested claim is marked as contested rather than
  quietly removed or quietly kept.

## Site-wide engineering baseline

These principles are the floor for **every** user-facing feature, not only the
component work of [ADR 0022](docs/adr/0022-v1-component-architecture.md). They
are cross-cutting: apply them to each new surface rather than rediscovering them
per feature. The concise statement is here; the architectural rationale lives in
the ADRs cross-referenced below.

- **Robust, context-aware output encoding.** Prefer the platform's safe sinks —
  `textContent`, `setAttribute`, DOM construction — which encode by
  construction; treat any data value (a callsign, a dataset or publication
  title, FOI free text) as untrusted external input that may contain markup.
  Encode for the **context** it lands in, per the OWASP output-encoding contexts:
  HTML text, HTML attribute (always double-quoted; escape `& " < '`), URL,
  rawtext / `<script>` / inline-JSON island (escape `<` to `<`, never plain
  entity-escaping — a `</script>` in a title must not break out), and SVG /
  foreign content. Validate a URL's scheme by **parsing it with the WHATWG URL
  parser** and allowlisting relative and `https:` — never by naive string
  matching. Never use `innerHTML` / `insertAdjacentHTML` / `outerHTML` /
  `document.write`, and never derive an attribute *name* from data. Verify the
  encoding against the checked-in **hostile-string corpus** (Big List of Naughty
  Strings, the OWASP XSS evasion vectors, the DOMPurify test suite) with a
  **DOMPurify oracle**, asserting on the **parsed DOM tree** (zero script nodes,
  zero `on*` attributes), not on string equality.

- **Announce dynamic changes.** Follow the WAI-ARIA Authoring Practices. When a
  change alters what is shown, a **single controller-owned live region**
  (`role=status` / `aria-live=polite`, `aria-atomic`) announces the **aggregate**
  outcome ("Showing 12 of 50") — never each element announcing its own change,
  which floods a screen reader. Manage focus: an element that held focus and is
  then hidden must move focus to a stable anchor first. Honour
  `prefers-reduced-motion` for any show/hide transition.

- **No-JS honesty.** Every surface is meaningful without JavaScript — a
  build-rendered, crawler-visible form that carries the real content, even if a
  simpler one than the enhanced view; never an empty shell that only script
  fills. This is enforced by a test gate, not left to discipline.

- **Per-feature error isolation.** One feature's failure degrades **its own
  island** and never the page. Wrap each component's enhancement and refresh in
  its own `try`/`catch` (mark the degraded island); a single throw must not break
  the load-time walk, a refresh sweep, or a sibling surface.

- **Define once; no duplication.** Author a fact, a unit or a render **once** and
  reuse it structurally; do not duplicate-and-guard. Duplication that can desync
  — one page reading a value from JSON while another hardcodes it, or a static
  markup baseline pinned against a separate renderer by a parity test — is
  *actively harmful*, because the two copies are guaranteed to drift. Design it
  out (generate the second view from the one source) rather than policing it with
  a parity test.

- **The least-bad decision test.** Score a design by the **future active pain**
  it avoids, not by its elegance. Foregone niceties are acceptable; a decision
  that is plainer but has no glaring downside beats a clever one that mortgages
  the future. Prefer the **reversible** option — the one whose exit is cheap if
  the call proves wrong.

- **Dependency tiers and the browser-library criterion.** Before adding a
  dependency, place it on the **SHIPPED (strict) → BUILD (deliberate) →
  TEST-ORACLE (liberal)** spectrum and apply the adopt-checklist; a dependency
  that would ship to the client is judged by **value × blast-radius**. Both are
  set out in [ADR 0012](docs/adr/0012-supply-chain-posture.md) (see its 2026-07-24
  addendum) — consult it rather than restating the rules here.

## Dataset-class labels

Data PRs get labelled automatically by dataset class — the label name *is* the
class key from the vocabulary
([`docs/foi-schemas.md`](docs/foi-schemas.md#dataset-classes-entry-level-vocabulary)):
`register-snapshot`, `available-pool`, `issuance-events`, `forbidden-list`,
`statistics-aggregate`, `attribute-addendum`, `reference-context`. This makes
the intake history queryable, e.g. `gh pr list --label register-snapshot`.

The label a PR carries is derived, not asserted: the scheduled
`pr-dataset-labels.yml` workflow reads the `datasetClasses` array from every
`archive/**/meta.json` the PR's diff touches and reconciles the PR's labels to
match on every pass (`npm run labels:pr`), so a later meta edit relabels the
PR without anyone hand-applying anything. Reconciliation only runs on PRs
whose diff includes an archive `meta.json`, and only ever adds or removes
labels within this dataset-class axis — other labels (`chore`, `enhancement`,
`up-next`, …) are left alone. Today only FOI-lane entries declare
`datasetClasses` in their `meta.json`; open-data-lane entries don't carry the
field, so open-data PRs pick up no dataset-class label. Never hand-apply a
dataset-class label to a PR that touches an archive `meta.json` — the next
scheduled pass reconciles it away again unless it matches a declared class.

Labelling the already-merged history is a separate, manually-run one-off over
the same code path (`node src/ci/pr-dataset-labels.ts --state merged`), not
part of the schedule.

## Running the tests

Run `npm run setup:duckdb` once to install the pinned DuckDB CLI locally; the
report-fold and report-sweep tests fold committed reports through it and skip
(with a pointer back to this command) until it is present.

## Test conventions

### Prefer a round-trip where a change spans layers

Where a change crosses layers — render → serialise → parse, encode → decode,
build → fetch → render, claims → text — reach for a **round-trip** before
reaching for more granular unit tests.

Their value shape is unusual, and easy to undervalue by the wrong yardstick:

- **Low diagnostic granularity, wide net.** A round-trip rarely says *where* the
  fault is. What it does is exercise a tall stack in one cheap assertion, so it
  catches gaps no individual layer's tests can see — including ones nobody
  thought to look for.
- **The red flag is the deliverable.** A failure says *"something odd is going on
  here — it may be deliberate, but it warrants a closer look."* That signal is the
  point. Do not weaken a round-trip to quieten it; investigate what it caught.
- **Usually cheap to construct** relative to the coverage it buys. That ratio is
  the argument for them.

A worked example, from the history journeys' static baseline. An HTML parser
**ends an open `<p>` at a `<details>` start tag**. A render placed citations
inside paragraphs; the DOM tree was correct and the serialised markup was
correct, but it **reparsed into a different tree** — the citations became
siblings of the paragraph rather than its children. That is invisible to a
browser-only render and to any unit test that never round-trips. It was caught
only by serialising, reparsing, and comparing against the tree the render built,
which is now a build-time assertion with a test proving the assertion can fail.

The reconstruction oracle is the same idea at corpus scale: every registered text
source is rebuilt from its claims alone and compared to the archived bytes, which
is what makes the claim ledger demonstrably canonical rather than merely asserted
to be.

Pair a round-trip with a test that proves it can fail. A guard nobody has seen
fail is not yet evidence of anything.

### Every test declares its kind

Each `describe` carries a `unit`, `ui` or `data-validity` tag:

```js
describe('…', { tags: ['unit'] }, () => { … })
```

This is enforced by `src/testing/test-taxonomy.test.ts`, so an untagged suite
fails the merge check rather than being silently mis-tiered. A pull-request
failure in the fast leg that will not reproduce on the bare branch is very often
this: the check runs against the merge result, not the branch alone.

### Assertions inside a loop need a non-empty guard

A test whose assertions live entirely inside a loop over a collection derived from
real data, with nothing asserting that the collection is non-empty, passes green
having asserted nothing the moment that collection empties — a loader change, a
filter that stops matching, a schema rename. Use the shared guards in
`src/testing/non-vacuity.ts` (`sampleIndices`, `forEachSampled`,
`assertNonEmpty`), which refuse an empty collection themselves and name which one
in the failure message.

Deliberate sampling is not this defect and is often correct — re-checking every
row of a large source buys little and costs minutes of CI. Pinning an exact
derived total is not this defect either; it fails loudly on drift, which is the
opposite behaviour.

### Naming

Test names read `Subject_Scenario_Outcome`, describing a scenario a reader would
recognise rather than an internal state — for example
`OnThisDayPage_WhenServedWithNoScript_CarriesTheDatedEntriesThemselves`. Cover
the unhappy paths alongside the happy one: what happens when the input is
malformed, the corpus is empty, or the configuration is unexpected.
