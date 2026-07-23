# PR #950 evidence — v1 round 3 (legend, suppression, odd-count grids, caption polish)

Static PNG captures could not be produced this session: the browser screenshot
tool's script injection timed out environment-wide, and Chrome renders an
SVG-loaded-as-image in secure static mode (so a same-origin foreignObject→canvas
fallback also could not run). In their place this folder holds the reproducible
harness and the quantitative before/after geometry measurements.

- `measurements.md` — before (`origin/main`, round 2) vs after (PR #950) caption
  geometry at the 882px desktop scale and the 600px mobile minimum, plus the
  rendered-DOM feature checks (legend, tooltips, suppression, grid tracks).
- `harness/index.html` — mounts every representative dial composition from the
  real `site/v1` modules. To run: copy it beside `site/v1/{copy.js,
  callsign-sections.js,shell.css,tokens.css}` (or serve `site/v1` and point the
  imports there) and open it; the console-free page renders each composition
  under a labelled heading. The measurement scripts in `measurements.md` were run
  against it at window widths giving an 882px scale (desktop) and by forcing each
  `.dial` to `max-width:340px` to collapse the scale to its 600px minimum.
