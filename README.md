# PR evidence — #657 narratives rendered on-site

Before/after screenshots for wiring `docs/narratives/*.md` into the rendered
site. "Before" is built from `main`; "after" from the feature branch
(`feat/657-narratives-on-site`). Both are the same static build
(`node src/ci/build-dataset-pages.ts`), served locally and captured with
Playwright's colour-scheme emulation for the light/dark pair.

- `narrative-page--after-{light,dark}.png` — the first data narrative
  (`docs/narratives/the-six-twins.md`) rendered as a themed on-site page at
  `/reports/narratives/the-six-twins.html`: shared nav, breadcrumb-style
  source note, the document's own heading as the page `<h1>`/`<title>`, the
  `[obs]`/`[der]`/`[hyp]` tagging intact, and its repo-relative citations
  (e.g. `src/sources/ofcom-amateur/components.ts`, an archived
  `normalised.csv`) rewritten to followable GitHub blob links. There is no
  "before" for this page — it 404s on `main`.
- `reports-hub--before-{light,dark}.png` / `reports-hub--after-{light,dark}.png`
  — the Reports hub (`/reports/index.html`). Before: no mention of
  narratives. After: a new "Narratives" section listing the rendered page,
  slotted between the standing reports and the register-status docs.
- `fidelity-consistency-backlink--before-{light,dark}.png` /
  `fidelity-consistency-backlink--after-{light,dark}.png` — the fidelity
  deep-dive's within-table consistency section (`/fidelity.html#consistency`).
  Before: ends at the ADR 0018 citation. After: one added line, "See the
  walkthrough: the six twins", linking to the narrative page.

Not captured here (would need the full claim-ledger SQLite pipeline to
render): the third back-link, the ledger's own
`co-temporal-status-divergence` note ("Read the story: the six twins"),
which is exercised directly instead by
`site/ledger.test.ts`'s `CoTemporalDivergence_Gloss_BackLinksTheSixTwinsNarrative`
test, asserting the link's exact href and text against a real G0TQK-shaped
conflict.
