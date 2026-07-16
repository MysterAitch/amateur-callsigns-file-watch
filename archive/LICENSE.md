# Licence — data in this directory

This note covers `archive/` (and any other directory in this repository that reproduces publisher material). It is separate from the repository's own [MIT licence](../LICENSE), which covers only the project's code and original documentation — never the data.

The files under `archive/` are not original works of this project. They are reproductions of material published by outside bodies: Ofcom's open-data register and its Freedom-of-Information disclosures, obtained directly or via archival copies (the UK Government Web Archive, the Internet Archive, WhatDoTheyKnow). Each publisher's own terms govern re-use of its material — not this project's MIT licence, which does not extend to it.

Terms are recorded, not duplicated, in two places, so nothing here can drift out of date with them:

- **Per publisher** — [`reference-data/publishers.json`](../reference-data/publishers.json) records each publisher's default licence basis, a plain-English statement of it, and verified `licenceCitations` (the source pages that were actually checked to confirm the terms). Several publishers cite the Open Government Licence v3.0 (SPDX identifier `OGL-UK-3.0`) as the basis for Crown-copyright material; others rely on the publisher's own site terms, and one basis is recorded honestly as not yet established. The register renders in full on the site's [publishers pages](https://mysteraitch.github.io/amateur-callsigns-file-watch/publishers/index.html), or can be read directly as JSON.
- **Per entry** — every archived publication's own `meta.json` records its provenance (where it was obtained, and any recovery witnesses). Where a specific publication carries different terms from its publisher's default basis — a historical vintage in particular — that override belongs on the entry, not here.

No licence text is restated in this file: a restated copy would drift from the register the moment a basis is re-verified, corrected or superseded. Consult `reference-data/publishers.json` and the relevant entry's `meta.json` for the terms that apply to any specific file.
