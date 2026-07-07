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
| `missing-rsl` | `2`-format callsign stored without its mandatory-in-use RSL | register stores RSL-less core callsigns by design; see `docs/reference/callsign-structure/` |
| `unknown-rsl` | RSL letter not in `rsl.csv` (temporary/special RSLs such as 2022's `Q` are deliberately not enumerated) | reportable signal, not an error |
| `unknown-prefix-series` | prefix series not in `prefix-formats.csv` (e.g. `M2`, `M4`, `G9` — absent from Ofcom's current Table 1) | honest unknown; no class implied |
| `forbidden-suffix` | suffix appears on Ofcom's August 2019 FOI withheld list (point-in-time semantics — see `forbidden-suffixes.csv` notes). **Empirically NOT an anomaly by itself**: ~2,800 such rows in the live register are long-standing `Allocated` records — the list evidently governs new issuance, not existing allocations. The interesting subset is allocations *created after* August 2019 | census 2026-06-23: 2,763 Allocated / 61 Reserved / 2 Available |
| `suffix-length-abnormal` | suffix length outside 2–3 letters ("normally, three letters"; two-letter forms are heritage; single letters are NoV contest callsigns, not register entries) | Ofcom guidance §5.2 |
| `class-product-mismatch` | licence class implied by the prefix series disagrees with the `product` column (both known). The flag records the discrepancy, not a verdict: causes are unknown — plausibly issuance-time input errors uncorrected since, plausibly legitimate arrangements not publicly stated (e.g. permission to use a deceased relative's callsign at the holder's own licence level). Full standing table: `reports/class-product-mismatches.md` | empty product = never-licensed, never a mismatch; 24 rows in the live register |
| `stripped-collision` | the value stripped to plain characters (`[A-Za-z0-9/#]`) coexists as its own row — the register lists one callsign twice | confirmed live (`G0TQK`, `G7IWE`, `G6FMU`, `M/EI8DJ`) |

Statuses (the `parse_status` column) are not flags: `parsed`, `visitor`
(`M/` + home callsign), `special-event` (`GB…`), `empty`, `unparseable`.
