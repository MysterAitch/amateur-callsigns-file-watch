# PR evidence — issues #793 and #794

Orphan branch holding before/after screenshots for the narrow-width
horizontal-overflow fixes. Not part of the site history; referenced only
from the pull request body/comments.

Captured at a 375px viewport (Chromium, headless), light and dark.

## data-status.html (issue #793)

The whole page scrolled horizontally at narrow widths, even though the
inventory grid's own `.overflow` wrapper correctly clipped and internally
scrolled the wide table. Screenshots are taken after scrolling the page as
far right as it will go (`window.scrollTo(100000, 0)`), the same check the
original audit used.

- `before-data-status-light.png` / `before-data-status-dark.png` — pre-fix:
  the page has scrolled into blank space to the right of the real content —
  nothing is rendered there because nothing was ever meant to be.
- `after-data-status-light.png` / `after-data-status-dark.png` — post-fix:
  the same scroll attempt does nothing; the page has no horizontal scroll to
  give.

## reports/narratives/the-six-twins.html (issue #794)

A 50-character unbroken inline code token
(`callsign.toUpperCase().replace(/[^A-Z0-9/]/g, '')`) had no spaces to wrap
on, so it forced the whole page wider than the viewport. Screenshots are
scrolled to the code block itself.

- `before-the-six-twins-light.png` / `before-the-six-twins-dark.png` —
  pre-fix: the code line is clipped at the right edge of the viewport (the
  page itself has been forced wider, not just the code block).
- `after-the-six-twins-light.png` / `after-the-six-twins-dark.png` —
  post-fix: the code block scrolls sideways within its own box (same
  convention as the site's wide data tables); the page itself does not.

## Measured `document.documentElement.scrollWidth` vs `clientWidth`

| page | viewport | before | after |
|---|---|---|---|
| data-status.html | 320/375/400px | 706–712 vs 320/375/400 (overflow) | equal (no overflow) |
| the-six-twins.html | 320/375/400px | 453 vs 320/375/400 (overflow) | equal (no overflow) |

Also spot-checked clean, before and after, at the same three widths in both
themes: index.html, ledger.html, explore.html, about.html, statistics.html,
compare.html, and the other three narrative pages.
