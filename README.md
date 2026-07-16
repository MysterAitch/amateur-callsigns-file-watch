# PR evidence — #560 MIT code licence, per-publisher data terms, register-derived acknowledgement

Before/after screenshots of the site's About page. "Before" is built from
`main`; "after" is built from the feature branch with the new licensing
section's placeholder populated by `src/ci/build-about-acknowledgement.ts`
(the same rendering the deploy performs).

- `before-light.png` / `before-dark.png` — the About page as it stands on
  `main`: five panels (not-affiliated, what this is, why it exists, currency,
  reporting errors) then the plain footer note.
- `after-light.png` / `after-dark.png` — the same page on the feature branch:
  a new "Licensing and acknowledgements" panel appears between "Reporting
  errors" and the footer, everything else unchanged (same nav, same five
  panels).
- `after-detail-light.png` / `after-detail-dark.png` — a close-up of the new
  panel: the MIT-licence statement for the project's own code, a pointer to
  `archive/LICENSE.md` for the data terms, and the register-derived
  acknowledgement list — one line per publisher (its name, linked to its own
  publisher page, and its default licence basis in plain English), read
  directly from `reference-data/publishers.json` at build time. Ofcom, the
  UK Government Web Archive, The National Archives, the Internet Archive and
  WhatDoTheyKnow show their Crown-copyright/site-terms bases; the ITU, OARC
  Wiki and GitHub entries show honestly as "not established (unverified)"
  rather than a guessed licence; the `self` entry (this mirror) is excluded,
  as it is not a third party being acknowledged.
