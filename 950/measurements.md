## Evidence — quantitative before/after (measured in a runnable harness)

The browser screenshot tool's script injection was timing out environment-wide this session (every tab, not just the harness), and Chrome renders SVG-loaded-as-image in secure static mode so a same-origin `foreignObject`→canvas capture also could not run. In place of static captures, each composition was rendered from the **real** `site/v1` modules in a harness and every caption's geometry measured against the panel bounds — arguably a stronger proof of the layout fixes than a screenshot. **Before** = the merged `origin/main` (round-2) code; **After** = this PR. Positive = overflow past the scale edge, in px.

### Desktop — 882px scale

| Composition | Before | After |
|---|---|---|
| M7TEE stack + semantic origin row | clean | clean |
| Synthetic 4-event stack | clean | clean |
| Near-dated tiered run | left −9, right +15 | **clean** |
| Disputed 2-camp (G8NNZ shape) | left −24, right +36, caption-on-caption, phantom scroll | **clean** |
| Heavy 5-camp disagreement | left −27, right +36, phantom scroll | **clean** |
| Long kind labels | clean | clean |
| Realistic recent event near the terminus | right +30, caption-on-caption, phantom scroll | **clean** |
| No-record (ZZ9ZZZ) | full evidence instrument beneath the card (scale + 6 sections) | **no-record card alone (1 section, no scale)** |

### Mobile worst case — 600px scale minimum

| Composition | Before | After |
|---|---|---|
| M7TEE stack | left −5, right +25 | **clean** |
| Synthetic 4-event stack | left −24, right +21 | **clean** |
| Near-dated tiered run | left −21, right +36 | **clean** |
| Disputed 2-camp | left −38, right +51, caption-on-caption | **clean** |
| Heavy 5-camp | left −41, right +51 | **clean** |
| Long kind labels | left −9, right +25, caption-on-caption | **clean** |

After the fixes: **zero caption overflow and zero caption-on-caption overlap at both 882px and the 600px minimum**, across every composition. (At 600px the dial still scrolls to reveal the 600px-min instrument — existing pre-A5 behaviour, out of scope here.)

### Feature correctness (rendered DOM, After)

- **A2 legend**: names `an event` · `a sighting` · `current state`, plus tinted-kind swatches `licence-issued` / `licence-original-start` / `licence-version-original-start` each named; worked micro-example present.
- **A2 tooltips**: event → `licence issued — foundation; … · 2018-10-18`; sighting → `Sighting: recorded by Ofcom 2018 · 2018-11-01`; state → `Allocated — current state · as of 2026-06-23, asserted by Ofcom register snapshot (vintage 2026-06-23)`.
- **A4**: no-record renders only `fast-answer` (no `.scale`, callout present).
- **C1**: anatomy renders 3 filled cells with the 4th track collapsed to `0px` — no blank tile.

Gates: 3 tsconfigs + `npm run lint` + fast unit/ui suite (2575 passed, 0 failed) all green.
