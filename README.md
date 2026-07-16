# PR evidence — #658 interactive mirror of the callsign-part wrappers

Before/after screenshots for extending the browser-side field wrappers
(`site/field-wrappers.js`) with the prefix-series/suffix conventions already
shipped for the generated pages (`src/ci/render/prefix-series.ts`,
`src/ci/render/suffix.ts`, issue #644), and adopting them on the interactive
surfaces. "Before" is built from `main`; "after" is built from the
`feat/658-part-wrapper-mirror` branch.

## Surface 1 — the per-callsign page's Components section (`site/callsign.js`)

Real page (`callsign.html?c=M7QNF`), real production JS, a static JSON shard
fixture standing in for the deployed per-shard data (no other change to the
render path).

- `658-callsign-anatomy-before-light.png` / `658-callsign-anatomy-after-light.png`
  — light theme. Before: the "prefix series" row shows the bare stored value
  ("M7", no `#` RSL-slot marker — unlike every other surface's "M#7"
  convention) as a plain link; "suffix" shows as bold text with no crosslink.
  After: "prefix series" reads "M#7" through the shared `prefixSeriesField`
  (`cs cs-pfx` classes); "suffix" is a monospace `cs cs-sfx` chip, linked to
  its per-suffix detail page since this callsign's suffix (QNF) is on the
  forbidden list.
- `658-callsign-anatomy-before-dark.png` / `658-callsign-anatomy-after-dark.png`
  — the same, dark theme.

## Surface 2 — the database lookup's Components rows (`site/app.js`)

`site/app.js`'s `seriesLink`/`suffixLink` (exported for this harness only; the
logic is untouched pre-#658, and unmodified post-#658) rendered with the real
`site/style.css`, outside the live database-backed flow — the interactive
lookup needs a Pages-vendored, multi-hundred-MB SQLite index that cannot be
built in this local capture environment.

- `658-lookup-harness-before-light.png` / `658-lookup-harness-after-light.png`
  — light theme. app.js's own prior `displaySeries`/`seriesLink` already
  inserted the `#` marker correctly, so "M#7" is unchanged; the visible
  difference is the "suffix" value's font — before, a plain proportional-font
  link with no shared class; after, the same link now wears `cs cs-sfx` and
  renders in the family's monospace, matching every other callsign-part value
  on the site.
- `658-lookup-harness-before-dark.png` / `658-lookup-harness-after-dark.png`
  — the same, dark theme.

## Also fixed (not separately screenshotted)

The interactive callsign "pill" (`site/callsign-pill.js`) did not carry the
shared `cs` base class before this PR — the gap #652 flagged and left for this
follow-on. Both `callsignPillLink` and `callsignPillRaw` now emit `class="cs
callsign-pill"`, so a browser-rendered whole callsign, prefix series and
suffix all share the one family selector; this is exercised by
`site/callsign-pill.test.ts` rather than a screenshot; the visual delta is
`.cs`'s own `white-space: nowrap`, present already via `.callsign-pill`'s own
rule, so there is no visible change to capture.
