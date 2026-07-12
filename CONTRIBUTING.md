# Contributing

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

## Running the tests

Run `npm run setup:duckdb` once to install the pinned DuckDB CLI locally; the
report-fold and normalise-sweep tests fold committed reports through it and skip
(with a pointer back to this command) until it is present.
