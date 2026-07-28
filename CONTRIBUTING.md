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

Don't turn this into a tickbox exercise: delete sections that don't apply and
don't pad. Pragmatism wins.

## Site-wide engineering baseline

These principles are the floor for **every** user-facing feature, not only the
component work of [ADR 0022](docs/adr/0022-v1-component-architecture.md). They
are cross-cutting: apply them to each new surface rather than rediscovering them
per feature. The concise statement is here; the architectural rationale lives in
the ADRs cross-referenced below.

- **Comments must be evergreen — and a measurement is only evergreen when it
  carries its date.** A comment states what is true about the code, not what was
  true while it was being written. Measurements are the trap: *"this takes about
  37 minutes"* silently stops being true the moment the pipeline changes and
  then actively misleads, whereas *"measured on PR #947 (2026-07): ~37 min"* is
  true forever, because it records an observation rather than asserting a
  property. Give every figure — timing, size, row count, speed-up ratio — its
  date and its source run or PR. This is not pedantry: a stale `~37 min` in
  `report-sweep.ts` was cited as current in later reasoning about a job that by
  then took under six minutes, and a stale `~11 GB` described a ledger that had
  grown to 12.73 GiB. When a figure is superseded, add the new dated observation
  rather than overwriting the old one — the trend is usually the point.
- **Prefer stable-over-time to fast-today.** Given a choice between a build step
  that is quicker now and one that is slower but whose cost does not grow with
  the archive, take the second. A change that moves a full rebuild from ten
  minutes to fifteen is a good trade if it converts growth in the number of
  publications into a constant — the archive only ever grows, so anything that
  scales with it is a deferred failure rather than a cost. Say which of the two
  a change is buying (see [#994](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/994)).
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
