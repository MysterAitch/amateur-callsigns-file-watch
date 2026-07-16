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
report-fold and normalise-sweep tests fold committed reports through it and skip
(with a pointer back to this command) until it is present.
