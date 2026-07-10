# Forbidden-suffix history

The forbidden-suffix list — three-letter suffixes Ofcom withholds from
issue — tracked across every disclosure the archive holds, joined on the
suffix key. Built from the committed FOI `forbidden-list` entries (never
the `landing/` drop zone), regenerated and committed, so a change in a PR
diff is a drift signal. Every figure below is **declared, not verified**.

The disallowed vocabulary is **not static**, and both invariance and drift
are findings: it is unchanged 2016 → 2019 (the two 2019 witnesses agree
exactly with the 2016 set), then changes by the December 2024 disclosure.

## Disclosures

One row per forbidden-list disclosure, oldest first. **Distinct** is the
suffix vocabulary; **rows** exceeds it only where the source duplicated a
row (surfaced, never silently deduplicated). **Added / removed** are the
set diff against the previous disclosure.

| vintage | disclosure | distinct | rows | duplicated | added | removed |
|---|---|---:|---:|---|---|---|
| 2016-09 | `wdtk-356636--all-callsigns-plus-forbidden` | 1,465 | 1,466 | `ZIT` | — | — |
| 2019-08-12 | `wdtk-596532--allocated-reserved-forbidden` | 1,465 | 1,465 | — | — | — |
| 2019-09-12 | `ofcom-756622--published-register-csv` | 1,465 | 1,465 | — | — | — |
| 2024-12 | `ofcom-2024-12--forbidden-suffixes` | 1,464 | 1,464 | — | `JIZ` | `QNF`, `ZFJ` |

## Ever-forbidden union

Across every disclosure held, **1,466** distinct
suffixes have been forbidden at some point. This union — not any single
list — is the intended basis for the future row-level `forbidden-suffix`
flag: flagging against "ever forbidden" is robust to churn and to suspected
omission errors. A suffix on the 2016/2019 lists but absent from 2024 (the
working theory is that the `QNF`/`ZFJ` de-listing is an artefact, not a
deliberate policy change) stays in the union, and so would stay flagged.

## Changes, disclosure by disclosure

The set diff between each disclosure and the one before it. Each added or
removed suffix is a drill-down candidate for a per-suffix detail page
(phase 3): its list history plus every callsign carrying it.

- **2016-09** (`wdtk-356636--all-callsigns-plus-forbidden`): baseline — 1,465 suffixes, no prior disclosure to diff against.
- **2019-08-12** (`wdtk-596532--allocated-reserved-forbidden`): no change — the same 1,465-suffix set as the previous disclosure.
- **2019-09-12** (`ofcom-756622--published-register-csv`): no change — the same 1,465-suffix set as the previous disclosure.
- **2024-12** (`ofcom-2024-12--forbidden-suffixes`): added `JIZ`; removed `QNF`, `ZFJ` → 1,464 suffixes.

## Last-modified distribution

Where a disclosure carries a per-suffix `LastModifiedDate` (the December
2024 export does; the earlier lists do not), the **distribution** of those
timestamps — not a single figure. A near-uniform bulk with one outlier is
itself the finding: it dates the list's origin and pins when a lone suffix
was touched.

### 2024-12 — `ofcom-2024-12--forbidden-suffixes`

| last modified | suffixes | which |
|---|---:|---|
| 2016-07-29 17:19 | 1,463 | _(1,463 suffixes — not enumerated)_ |
| 2020-12-10 09:10 | 1 | `JIZ` |

## First-known-forbidden distribution

For every suffix in the union, the earliest disclosure or `LastModifiedDate`
at which it is known to have been forbidden — bucketed by date. This is the
per-suffix temporal anchor a future `forbidden-suffix-issued-after-first-known-list`
flag will key off; the 2024 export makes it finer than the disclosure
vintages alone.

| first known forbidden | suffixes | which |
|---|---:|---|
| 2016-07-29 | 1,463 | _(1,463 suffixes — not enumerated)_ |
| 2016-09 | 2 | `QNF`, `ZFJ` |
| 2020-12-10 | 1 | `JIZ` |

## Changed-suffix observations

Only the suffixes whose list membership changed at some point — the drift
set. `✓` = on the list at that disclosure, `·` = absent. This per-(suffix,
disclosure) matrix is the seed for the phase-3 per-suffix pages; a later
phase will attach, per suffix, the count of callsigns carrying it **broken
down by status** (Allocated / Reserved / Available) — a bare total would
mislead, since a rise could be a Reserved spike rather than new issuance,
so the shape is left ready for that decomposition.

| suffix | 2016-09 | 2019-08-12 | 2019-09-12 | 2024-12 | first known forbidden |
|---|---:|---:|---:|---:|---|
| `JIZ` | · | · | · | ✓ | 2020-12-10 09:10 — ofcom-2024-12--forbidden-suffixes (LastModifiedDate) |
| `QNF` | ✓ | ✓ | ✓ | · | 2016-09 — wdtk-356636--all-callsigns-plus-forbidden (vintage) |
| `ZFJ` | ✓ | ✓ | ✓ | · | 2016-09 — wdtk-356636--all-callsigns-plus-forbidden (vintage) |
