# Test taxonomy

A first-cut labelling of tests by **what they actually guard**, so each kind can later run in the
right place. Tags are native vitest 4 tags: the vocabulary is declared in `vitest.config.ts`
(`test.tags`, with `strictTags` on so a typo fails loudly), and applied as explicit
`{ tags: [...] }` options on `describe`/`test`. They are inert until a `--tags-filter` selects on
them, so adding them changes no test outcome.

## Why

The ~1 h CI `tests` job and a shared-state isolation bug (#478) both trace to one thing: the
suite **conflates two kinds of test** — guards of the *code/algorithms* (which want small, fast,
isolated fixtures) and validations of the *actual data* through the pipeline (which want the whole
real archive). Separating them lets the cheap guards gate every PR in seconds while the expensive
data validations run where they belong.

## The environments (a gated staging model)

Like `local → dev → test → staging → prod`: each higher environment runs against **increasingly
realistic data**, and **you don't start a higher tier until the lower one is green**. Cheap,
low-fidelity guards fail fast and gate the realistic-data tiers.

| Env | Tags | Data | When it runs |
|-----|------|------|--------------|
| **local** | `unit`, `ui` | fixtures / none | first, every PR — the gate |
| **full-data** | `data-validity` | the whole real archive | only after `local` is green |

## The tags

- **`unit`** — code-correctness guard: fixture in, assert the transform; no real dataset.
- **`ui`** — browser/DOM helper under `site/` (jsdom); no real dataset. Runs in the local tier
  with `unit` for now ("good enough combined"; may split out later).
- **`data-validity`** — validates the real full dataset / pipeline against our encoded assumptions
  (every entry parses, no unexpected patterns, the forbidden-suffix set, the reconstruction and
  fold oracles). Inherently slower; higher tier.
- **A file that does both** simply carries **both** tags — there is no "mixed" tag. Multi-valued
  tags dissolve the conflation: the fixture `describe` gets `unit`, the real-archive `describe`
  gets `data-validity`.

## Applied (issues #336 / #398)

Every `*.test.ts` is now tagged **per top-level `describe`**, classified by kind:

- **GUARD (`unit`)** — pure/fixture guards over small inputs: most of `src/shared`, `src/sources`,
  `src/scheduled-run.*`, `src/tools`, the `src/v2` emit/tier tests, and the pure `src/ci`
  render/structure tests. Inside a mixed file, the fixture-fold `describe`s (e.g. the
  "controlled ledger" folds) carry `unit` while their real-archive siblings carry `data-validity`.
- **GUARD (`ui`)** — the `site/**` browser tests (jsdom and the DOM-free browser helpers).
- **VALIDATION (`data-validity`)** — whole-corpus / DuckDB-fold / deploy-artefact-building tests:
  the `heavy-tests.json` files, plus the cheap-but-full-corpus ones that stay in the fast pool
  (`forbidden-suffix-history`, `trust-rating`, `cross-dataset-invariants`'s real-archive fold, the
  collector families, the `src/acceptance` suite).

A file that mixes kinds carries **both** across its sibling `describe`s — the fixture `describe`
gets `unit`, the real-archive `describe` gets `data-validity`. A meta-test,
`src/testing/test-taxonomy.test.ts`, pins the invariants (every file tagged, every heavy file a
data validation, the lane union covering every file) so a future validation cannot be silently
mis-tiered.

The whole runtime cost still sits in the `data-validity` real-archive tests; `unit` + `ui` are the
millisecond guard lane, run locally by `npm run test:unit` (the `fast` project filtered to
`unit || ui`).

### The one exemption

`src/ci/build-dataset-pages.test.ts` is intentionally left untagged while a separate change owns it;
the self-check encodes that exemption explicitly (`UNTAGGED_EXEMPT`). Tagging it is a tracked
follow-up.

## Open items

- **`acceptance/`** — the `acceptance/` suite validates the real pipeline/reference data against
  acceptance criteria, so it is tagged **`data-validity`** for now (its definition fits, and it
  belongs above the local guard lane). A distinct `acceptance` tag is deferred until there is a
  concrete lane that treats it separately — introducing a fourth tag now would only add a
  vocabulary the local lane does not consume.
- **Equivalence / migration oracles** (`reconstruction-oracle`, the fold-equivalence oracles) need
  the full dataset but guard *code* (equivalence), not data quality — they straddle the tiers.
  Their real-archive `describe`s are `data-validity`; their fixture-fold `describe`s are `unit`.
- **Wiring the CI lanes** — the local `test:unit` lane exists (step 3). A later CI change (step 4)
  runs `--tagsFilter` to gate `full-data` behind `local`, and step 5 extends the input-closure
  cache; both are measure-first follow-ups on the fan-out (#478) and are **not** part of this
  labelling pass.
