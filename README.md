# PR evidence — issue #796

Orphan branch holding before/after screenshots for tagging
`amateur-callsign-data-around-the-world.md` with the epistemics-tag
convention (`[observed]`/`[derived]`/`[hypothesis]`) its three sibling
narratives already carry throughout. Not part of the site history;
referenced only from the pull request body/comments.

Captured at a 1100×900 viewport (Chromium, headless), light and dark, both
`prefers-color-scheme` media queries exercised via Playwright's
`colorScheme` context option.

## reports/narratives/amateur-callsign-data-around-the-world.html (issue #796)

Before this change the page carried zero occurrences of the tag convention
(confirmed by `grep -c '\[observed\]\|\[derived\]\|\[hypothesis\]'` against
the rendered HTML), despite its own intro twice pointing readers at the
glossary's claim-tag definitions. After the change, every substantive claim
carries one of three tags, rendered as the glossary-linked
`.epistemic-tag` pill exactly as on its sibling narratives.

- `before-amateur-callsign-data-around-the-world-light.png` /
  `-dark.png` — the page top: an italic disclaimer explains the page sits
  outside the tagging convention "used elsewhere in this collection"; no
  pill exists anywhere on the page.
- `before-amateur-callsign-data-around-the-world-fcc-light.png` /
  `-dark.png` — the "United States — FCC" section: plain prose throughout,
  no tags.
- `after-amateur-callsign-data-around-the-world-light.png` / `-dark.png` —
  the page top: the disclaimer is replaced with the standard three-tag
  legend paragraph (matching `the-six-twins.md` / `the-qnf-gap.md`), and
  the "At a glance" table gains a tagged lead sentence.
- `after-amateur-callsign-data-around-the-world-fcc-light.png` / `-dark.png`
  — the same FCC section, now carrying `observed` and `derived` pills
  against the project's own held FOI/register evidence and the cited
  primary regulation.
- `after-amateur-callsign-data-around-the-world-france-light.png` /
  `-dark.png` — the Australia/France sections, the densest part of the
  page, showing all three tags together including two `hypothesis` pills
  on genuinely open questions (ANFR's unconfirmed bulk-export capability;
  the Etalab licence that would apply if it existed).

## Tag counts (rendered HTML, `class="epistemic-tag tag-*"`)

| tag | before | after |
|---|---:|---:|
| observed | 0 | 16 |
| derived | 0 | 11 |
| hypothesis | 0 | 4 |
| **total** | **0** | **31** |

Verified against the built page with
`grep -o 'class="epistemic-tag tag-[a-z]*"' ... \| sort \| uniq -c`, and
separately via `npx vitest run src/ci/build-dataset-pages.test.ts
src/ci/internal-link-crawl.test.ts` (120 tests passed), which crawl-verifies
every pill's glossary anchor resolves and no link on the page dangles.
