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

## Applied so far (first cut)

The **20 files with a single top-level `describe`** are tagged now, inline on that describe — the
obvious, clean cases (mostly `unit`). The remaining **71 files have 2–26 sibling top-level
`describe`s** (median 3), so tagging each one accurately is per-`describe` work that belongs to the
**deep-dive split**, where every describe's kind is decided anyway. Tagging them now would be
coarse repetition; deferring keeps each tag honest.

Rough proportions (89 files; runtime from the pre-split baseline): `unit` ~48% of files / ~1% of
time; `ui` ~18% / ~0%; `data-validity`-bearing (incl. the dual-tagged) ~34% of files / **~99% of
the runtime**. The whole cost is in the real-archive tests.

## Open items

- **`acceptance/`** — the repo already has an `acceptance/` suite (`callsign-normalisation`,
  `coverage-semantics`, `edge-cases`, `forbidden-union`, `invariants-and-vocabularies`,
  `licence-vocabulary`). It's a natural higher-environment tier; formalise an `acceptance` tag when
  the split reaches it, rather than folding it into `data-validity`.
- **Equivalence / migration oracles** (`reconstruction-oracle`, the fold-equivalence tests) need
  the full dataset but guard *code* (equivalence), not data quality — they straddle the tiers.
  Left as `data-validity` for now (unresolved).
- **Wiring the lanes** — a later CI change runs `--tags-filter` to gate `full-data` behind `local`
  (like the `heavy-tests.json` fan-out). Not wired yet; these tags are labels-first.
