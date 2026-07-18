# PR evidence — #742 value-catalogue sparkline: reach the timeline on touch/keyboard

Before/after screenshots of a value-catalogue table cell carrying a
per-value sparkline, rendered through the real markdown-to-HTML pipeline
(`renderMarkdown`) inside the site's own page shell, so the visual matches
production exactly. Both states use identical synthetic timeline data (two
`status` values across four dated publications), so the only difference
between them is the change itself.

- `before-light.png` / `before-dark.png` — the sparkline as it stands on
  `main`: a `role="img"` span whose `aria-label`/`title` carry the
  per-publication date:count pairs. The `title` only reaches a hovering
  mouse — nothing on the page lets a touch or keyboard user reach that data.
- `after-light.png` / `after-dark.png` — the same sparkline on this branch,
  with its `<details>`/`<summary>` disclosure open: "Per-publication counts"
  reveals the identical date:count series the span's title/aria-label
  already carry, reachable by tap or by keyboard (Tab to focus the summary,
  Enter/Space to open it) — no script required, since `<details>` is a
  native HTML disclosure.
