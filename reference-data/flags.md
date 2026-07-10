# Flag registry (components.csv `flags` column)

The closed vocabulary for the semicolon-separated, alphabetically sorted
`flags` column in `archive/{key}/components.csv`. Flags are per-row
determinations; everything a flag *means* lives here, once. Adding a flag is
a reviewed change to this registry plus the parser — never a schema change.

Design notes: flags are sparse (the overwhelming majority of rows carry
none), so a single multi-value column beats per-flag boolean columns — no
schema churn as the vocabulary grows, and diffs show a row gaining exactly
the token that changed. Aggregate filtering belongs to stats and reports,
not the row format.

| flag | meaning | grounding |
|---|---|---|
| `lowercase` | value contains lowercase letters; parsed case-insensitively | observed live (`g0jrk`, `NaNAAA`) |
| `whitespace` | value contains whitespace/invisible characters (removed before parsing) | observed live (space, NBSP) |
| `encoding-failure` | value contains U+FFFD (removed before parsing) | observed 2023–2025 exports |
| `excel-date-shape` | value looks like a spreadsheet date rendering of a month-suffixed callsign (`20-Apr`) | observed 2023/2025-04 exports |
| `rsl-in-register` | parsed register value carries an explicit RSL — the register stores RSL-less core callsigns by design, so *presence* is the notable case (replaces the earlier `missing-rsl` flag, which marked ~19.5k bare `2`-format rows: the norm, not an anomaly) | census 2026-06-23: ~20 rows; see `docs/reference/callsign-structure/` |
| `unknown-rsl` | RSL letter not in `rsl.csv` (temporary/special RSLs such as 2022's `Q` are deliberately not enumerated) | reportable signal, not an error |
| `unknown-prefix-series` | prefix series not in `prefix-formats.csv` (e.g. `M2`, `M4`, `G9` — absent from Ofcom's current Table 1) | honest unknown; no class implied |
| `forbidden-suffix` | suffix appears on Ofcom's August 2019 FOI withheld list (point-in-time semantics — see `forbidden-suffixes.csv` notes). **Empirically NOT an anomaly by itself**: ~2,800 such rows in the live register are long-standing `Allocated` records — the list evidently governs new issuance, not existing allocations. The interesting subset — a forbidden suffix whose original issuance *post-dates* the list coming into force — carries its own `forbidden-suffix-issued-after-list` flag so it stops hiding inside this benign bulk | census 2026-06-23: 2,763 Allocated / 61 Reserved / 2 Available |
| `forbidden-suffix-issued-after-list` | a `forbidden-suffix` row whose original start date falls in a month after the withheld-suffix list came into force — a candidate for scrutiny, not a verdict: it *appears* to post-date the list that ought to have excluded the suffix, but innocent explanations come first (heritage re-issues under a letter of consent, publisher date artefacts, and version starts that reset on later changes rather than record first issuance). Only variants carrying `licence_version_original_start_date` can assert it; a row without a date honestly does not (absence is not evidence) | the list is disclosed and materially unchanged from at least September 2016 (`archive/foi/wdtk-356636…`, vintage 2016-09, carries the same 1,465-suffix set as `forbidden-suffixes.csv` — differing only by line endings and a duplicated `ZIT` row, a data-quality artefact, not a vocabulary change); pre-2016 existence is unknown, so 2016-09 is the earliest boundary the evidence supports. Point-in-time semantics. The stronger derivation is snapshot-differencing against a dated issue-date baseline, which needs master-database context — this single-publication proxy is deliberately conservative |
| `suffix-length-abnormal` | suffix length outside 2–3 letters ("normally, three letters"; two-letter forms are heritage; single letters are NoV contest callsigns, not register entries) | Ofcom guidance §5.2 |
| `class-product-mismatch` | licence class implied by the prefix series disagrees with the `product` column (both known). The flag records the discrepancy, not a verdict: causes are unknown — plausibly issuance-time input errors uncorrected since, plausibly legitimate arrangements not publicly stated (e.g. permission to use a deceased relative's callsign at the holder's own licence level). Full standing table: `reports/class-product-mismatches.md` | an empty product asserts nothing about licensing (many live allocations carry one) and is excluded from the check because the comparison needs both sides; 24 rows in the live register |
| `stripped-collision` | the value stripped to plain characters (`[A-Za-z0-9/#]`) coexists as its own row — the register lists one callsign twice | confirmed live (`G0TQK`, `G7IWE`, `G6FMU`, `M/EI8DJ`) |
| `malformed-home-callsign` | visitor (`M/…`) row whose home-callsign portion cannot be a callsign: shorter than 3 characters, characters outside A–Z/0–9, missing a letter or a digit, or starting `0`/`1` (no ITU call-sign series begins with either — empirical, `itu-call-sign-series.csv`) | confirmed live (`M/1234`, `M/1CNB`, nested `M/M/PT2FM`) |
| `hash-in-register` | visitor row carrying a literal `#` immediately after the slash (`M/#PT2FM`). The RSL sits *before* the slash (`Mx/homecall`: RSGB visitor examples `M/F1ABC`, `MM/F1ABC`, `MW/F1ABC`; Ofcom writes its own RSL slot with `#` in position 2, as in the `2#0` Intermediate format), so a `#` after the slash reads as a reserved-template placeholder rather than a callsign character — it is stripped from the home portion (which parses normally) and recorded here rather than mistaken for a `malformed-home-callsign` | confirmed live (Reserved reciprocal entries `M/#PT2FM`, `M/#VK4VGK`, `M/#YO3IES`) |

Statuses (the `parse_status` column) are not flags: `parsed`, `visitor`
(`M/` + home callsign), `special-event` (`GB…`), `empty`, `unparseable`.
