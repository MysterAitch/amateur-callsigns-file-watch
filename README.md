# PR evidence — issue #796

Orphan branch holding before/after screenshots for tagging
`amateur-callsign-data-around-the-world.md` with the epistemics-tag
convention (`[observed]`/`[derived]`/`[hypothesis]`) its three sibling
narratives already carry throughout. Not part of the site history;
referenced only from the pull request body/comments.

Captured at a 1100×900 viewport (Chromium, headless), light and dark, both
`prefers-color-scheme` media queries exercised via Playwright's
`colorScheme` context option.

**This branch holds two rounds of "after" evidence — read the correction
note below before trusting the `after-*` files without the `-fix` suffix.**

## reports/narratives/amateur-callsign-data-around-the-world.html (issue #796)

Before this change the page carried zero occurrences of the tag convention
(confirmed by `grep -c '\[observed\]\|\[derived\]\|\[hypothesis\]'` against
the rendered HTML), despite its own intro twice pointing readers at the
glossary's claim-tag definitions.

- `before-amateur-callsign-data-around-the-world-light.png` /
  `-dark.png` — the page top: an italic disclaimer explains the page sits
  outside the tagging convention "used elsewhere in this collection"; no
  pill exists anywhere on the page.
- `before-amateur-callsign-data-around-the-world-fcc-light.png` /
  `-dark.png` — the "United States — FCC" section: plain prose throughout,
  no tags.

## Correction: `[observed]`/`[confirmed]` was mis-applied to external-regulator facts

The first round of tagging (`after-amateur-callsign-data-around-the-world-*`,
`-fcc-*`, `-france-*` below) tagged 31 claims, including facts read from the
FCC's own statute, ACMA's own class licence, BNetzA's own exemption
statement, and Ofcom's own guidance as `[observed]`/`[derived]`. That is
wrong against the glossary's own definitions
(`site/glossary.html#tag-observed`): **[observed]** is specifically "something
read directly off the published or archived **register data**" this project
holds, and **[confirmed]** is specifically "a hypothesis subsequently checked
against a named, citable authoritative source" — neither fits a fact stated
on an external regulator's own page with no prior held-data reading and no
prior stated hypothesis. Those external facts already carry their own inline
primary-source citation, which is the honest evidential status for material
this project does not hold (see the page's own "Context, not collection"
section) — tagging them as if they were read off this project's register
data would have been a real epistemic mismatch, not a cosmetic one.

The `after-fix-*` files below are the corrected render: only claims genuinely
grounded in this project's own held FOI/register evidence keep
`[observed]`/`[derived]` (2 + 1 instances), and only the narrative's
genuinely open, not-asserted questions keep `[hypothesis]` (3 instances) —
6 tagged claims in total, far fewer than the first round and far fewer than
the sibling narratives, because this page's content is overwhelmingly
external-regulator context rather than held-data derivation. That is the
honest answer, not a shortfall.

- `after-fix-amateur-callsign-data-around-the-world-light.png` / `-dark.png`
  — the page top: the legend now says explicitly that only held-data claims
  carry a tag, and external facts carry a citation instead; the "At a
  glance" table lead sentence is untagged prose.
- `after-fix-amateur-callsign-data-around-the-world-fcc-light.png` /
  `-dark.png` — the "United States — FCC" section: entirely untagged prose
  (47 CFR §97.107, the RPAAL history, the ULS schema are all external facts)
  until the one paragraph grounded in this project's own held FOI disclosure
  and `archive/2023-02-20/normalised.csv` (the `M/#` reciprocal rows), which
  keeps its `observed` pill.
- `after-fix-amateur-callsign-data-around-the-world-acma-light.png` /
  `-dark.png` — the tail of the Germany section and the Australia section:
  entirely untagged prose (BNetzA's, DARC's, ACMA's and WIA's own material)
  until the `hypothesis` pill on the genuinely open question of whether a
  longer-stay ACMA licence would create a register-visible entry.

### Superseded files (first round — kept for the record, not the current state)

- `after-amateur-callsign-data-around-the-world-light.png` / `-dark.png`
- `after-amateur-callsign-data-around-the-world-fcc-light.png` / `-dark.png`
- `after-amateur-callsign-data-around-the-world-france-light.png` /
  `-dark.png`

## Tag counts (rendered HTML, `class="epistemic-tag tag-*"`, excluding the legend's own three example words)

| tag | before | after (first round, wrong) | after-fix (corrected) |
|---|---:|---:|---:|
| observed | 0 | 16 | 2 |
| derived | 0 | 11 | 1 |
| hypothesis | 0 | 4 | 3 |
| **total** | **0** | **31** | **6** |

Verified against the built page with
`grep -o 'class="epistemic-tag tag-[a-z]*"' ... \| sort \| uniq -c`, and
separately via `npx vitest run src/ci/build-dataset-pages.test.ts
src/ci/internal-link-crawl.test.ts` (120 tests passed on both rounds), which
crawl-verifies every pill's glossary anchor resolves and no link on the page
dangles.
