# UK amateur callsign structure — reference library

A researched reference on the structure, meaning, and history of UK amateur
radio callsigns, built to inform this repository's callsign component parsing
and data-quality work (normalised schema v2, issue #51). It mirrors formally
published primary documents and summarises them — plus reputable secondary
material — with citations.

## Layout

| file | contents |
|---|---|
| [`sources.md`](sources.md) | Manifest of every source: mirrored documents (with hashes and fetch dates), web sources consulted, and research directories for future digging |
| [`callsign-structure.md`](callsign-structure.md) | The **current** callsign system as implemented (post-October 2025): formats, RSLs, suffixes, special stations |
| [`licence-class-history.md`](licence-class-history.md) | Historical licence classes (Class A/B, Novice, Morse requirements) and callsign series with issue-date ranges |
| [`m8-m9-transition.md`](m8-m9-transition.md) | The 2023–2025 licensing review: M8/M9 replacing the `2` series, RSLs becoming optional, with the verified timeline |
| [`sources/`](sources/) | Mirrored PDFs (authoritative copies) plus lossy `.txt` extractions for searchability |

This directory is documentation only — nothing under `docs/` is touched by
the automated fetch/normalise/validate pipelines, so no carve-outs are
needed anywhere.

## Editorial conventions

- **Status tags.** Regulatory changes are tagged **proposed** (consultation
  text), **decided** (a statement's decision box), or **implemented**
  (in-force licence conditions / operational systems). A decision is not an
  implementation: the December 2023 statement decided many things that only
  came into force in February 2024 (Phase 1) or October 2025 (Phases 2–3),
  sometimes with adjustments.
- **Citation policy.** Common knowledge within the hobby (e.g. "M7 denotes a
  Foundation licence") carries one authoritative citation at first use and is
  not re-attributed at every mention. Per-claim attribution is reserved for
  material that genuinely adds something: issue-date ranges, historical
  details, corrections, or claims found in only one place.
- **Attribution.** Material gleaned from forums, personal pages, and wikis is
  attributed to its author (username/callsign where that is how the author
  identifies), quoted minimally, and never presented as this project's own
  work. Licence terms of each source are recorded in the manifest.
- **Source quality.** Primary sources (Ofcom, ITU) are preferred for what the
  rules *are*; secondary and community sources are often better for how
  things *were* and *why* — but they are interpretations, may contain errors
  (at least one is documented in `sources.md`), and are treated as such.
- **Verbatim quirks.** Quotations preserve the original text exactly,
  including typographical errors in the source documents.
