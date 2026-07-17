# PR evidence — issue #753

Orphan branch holding before/after screenshots for the front-door narrow-width
overflow fix. Not part of the site history; referenced only from the pull
request body/comments.

Captured at a 375px viewport (Chromium, headless), full page height cropped to
the search band + orientation + headline-stats row, where the overflow was
most visible.

- `before-light.png` / `before-dark.png` — pre-fix: the input placeholder and
  the "158,318 callsigns in the latest register" stat are cut off at the
  right edge; the page scrolls horizontally.
- `after-light.png` / `after-dark.png` — post-fix: the stat wraps onto a
  second line instead of overflowing; no horizontal scroll.
