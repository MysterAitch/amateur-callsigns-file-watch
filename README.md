# PR evidence — #618 increment 3 (witness hashes + derived agreement)

`witness-block-before-after.html` is a self-contained page showing the real
rendered **Published by / witnessed at** block of the FOI entry
`ofcom-2023-01-25`, before and after this increment.

Open it in a browser. It shows:

- **Before (increment 2):** each witness cites a location; agreement is not
  shown.
- **After (increment 3):** the disclosure-log copy (the ingestion source) now
  records its `sha256`, so it is derived **corroborating** — the mirror holds
  those exact bytes. The UK Government Web Archive mirror was not fetched for
  bytes, so it stays **citation-grade** with no extra marker: no doubt is
  manufactured where nothing was verified. Agreement is derived on read.

Both blocks are the actual generated HTML (the "before" is the same block with
the increment-3 additions removed), styled to approximate the site look.

Screenshots could not be auto-captured in the build sandbox (the browser
tooling's script injection timed out); the committed HTML is the evidence.
