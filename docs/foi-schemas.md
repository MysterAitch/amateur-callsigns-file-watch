# FOI dataset schemas

**Generated from the converter registry**; regenerated automatically,
and the repository copy is authoritative. Rendered from the authored
registry values that validation and the column-governance test enforce,
so this page and the accepted vocabulary are the same thing.

Committed normalised files are **per-class core + registered extensions**
(the composed-stack working decision, 2026-07): each file carries its row
family's core columns plus only the extension columns its source asserts.
The union view is a derived, downstream projection (SQLite / published
union CSV), never the committed format. The open-data lane's schema is
documented separately in [`normalised-schema.md`](normalised-schema.md).

## Dataset classes (entry-level vocabulary)

| class | definition |
|---|---|
| `register-snapshot` | the register state at a vintage: one row per callsign carrying its status (and class/date attributes where disclosed) |
| `available-pool` | callsigns (or suffixes) available for issue at a vintage - asserts nothing about allocated callsigns |
| `issuance-events` | dated per-callsign events: issue, re-issue, reallocation, reciprocal-licence issue |
| `forbidden-list` | three-letter suffixes withheld from issue (a different row shape by design: suffixes, not callsigns) |
| `statistics-aggregate` | counts and aggregates, not per-callsign rows |
| `attribute-addendum` | per-callsign or per-licence attributes intended for downstream joins (identifiers, dates, classes) |
| `reference-context` | records that are context rather than datasets: not-held responses, referrals, policy signposts, system-history statements |

## Row-schema families

| family | core columns | description |
|---|---|---|
| `callsign-observation` | `callsign`, `status`, `licence_class` | one row per callsign asserting its state at the entry vintage (register snapshots, available lists); status and licence_class carry the source vocabulary verbatim, empty where the source asserts nothing |
| `issuance-events` | `callsign`, `event`, `event_date` | one row per dated per-callsign event; the event vocabulary is authored per converter from the source document's own wording (reissued, reallocated, reciprocal-licence-issued) |
| `suffix-list` | `suffix` | one row per three-letter suffix (the forbidden lists) - suffixes, not callsigns, by design |
| `counts-aggregate` | `period` | one row per reporting period carrying counts, not per-callsign data; the period label is carried verbatim from the source |
| `callsign-attributes` | `callsign` | one row per callsign (or per callsign-assignment) carrying attributes for downstream joins, without a status assertion (e.g. the Pre-War annex) |
| `database-fields` | `view`, `field_name` | the disclosed licensing-database column headings, grouped by database view (wdtk-238892 Annex A sheet 2) |

## Registered extension columns

Carried only where the source asserts them; adding a column means adding a
reviewed definition here (enforced by the governance test), never inventing
a header.

| column | applicable families | definition |
|---|---|---|
| `suffix` | `callsign-observation` | the three-letter suffix component, carried verbatim alongside the callsign where the source is suffix-shaped |
| `reserved_to_date` | `callsign-observation` | reservation expiry (a validity END - legitimately after the entry vintage), ISO-rendered |
| `licence_issued_date` | `callsign-observation` | the licence issue date as disclosed in register snapshots, ISO-rendered |
| `created_date` | `callsign-observation` | the licensing-system record creation timestamp, ISO-rendered (time kept where the source carries one) |
| `original_start_date` | `callsign-observation`, `callsign-attributes` | the licence's original start date as disclosed, ISO-rendered; per-source semantics caveats live in the entry meta |
| `status` | `issuance-events` | the licence status at disclosure, carried verbatim, when it accompanies event rows |
| `licence_class` | `issuance-events` | the licence product/class vocabulary carried verbatim, when it accompanies event rows |
| `reason` | `issuance-events` | the source's stated reason for the event, verbatim |
| `licence_number` | `issuance-events` | the Siebel-format licence identifier, verbatim |
| `con_id` | `issuance-events` | the Siebel-format contact/consent identifier, verbatim |
| `amateur_radio_licences_issued` | `counts-aggregate` | count of amateur radio licences issued in the period (thousands separators stripped, otherwise verbatim) |
| `business_radio_licences_issued` | `counts-aggregate` | count of business radio licences issued in the period (part of the disclosed assertion; consumers filter) |

## Converter variants

Column **kind** vocabulary: `verbatim` (value carried unchanged),
`prefixed` (source value with an authored prefix), `date` (parsed from
the source's date format to ISO order), `iso-date` (already ISO-shaped
at source, verified not reformatted), `count` (numeric with thousands
separators stripped), `constant` (authored fixed value, stated in the
source column). A **date plausibility bound** appears only for
conversions whose outputs include date columns - dates beyond the bound
fail the conversion.

| variant | bound by |
|---|---|
| `available-suffix-lists-2013-style` | `wdtk-174341--available-callsigns-list`, `wdtk-197896--available-callsigns-list` |
| `available-typed-export-7col` | `wdtk-294011--available-callsigns-list`, `wdtk-299321--available-callsigns-list` |
| `available-typed-export-8col` | `wdtk-247308--available-callsigns-list`, `wdtk-261814--available-callsigns-list` |
| `ofcom-498903-reissue-events` | `ofcom-498903--reissued-callsigns-since-2010` |
| `ofcom-498906-reciprocal-events` | `ofcom-498906--reciprocal-licences-since-2010` |
| `ofcom-756622-register-and-forbidden` | `ofcom-756622--published-register-csv` |
| `wdtk-1180568-csv-pair` | `wdtk-1180568--licence-breakdown-duration-age` |
| `wdtk-184767-counts-table` | `wdtk-184767--annual-licence-counts` |
| `wdtk-224333-prefix-suffix-lists` | `wdtk-224333--available-callsigns-list` |
| `wdtk-238892-prewar-annex` | `wdtk-238892--out-of-sequence-callsigns` |
| `wdtk-251507-transfers-table` | `wdtk-251507--reissue-policy` |
| `wdtk-271469-typed-lists` | `wdtk-271469--available-callsigns-list` |
| `wdtk-309076-combined-list` | `wdtk-309076--available-callsigns-list` |
| `wdtk-356636-register-and-forbidden` | `wdtk-356636--all-callsigns-plus-forbidden` |
| `wdtk-596532-register-and-forbidden` | `wdtk-596532--allocated-reserved-forbidden` |

### `available-suffix-lists-2013-style`

**`raw-extract-sheet-1-foundation.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Foundation = M6aaa` (prefix `M6`) | prefixed |
| `status` | constant `Available` | verbatim |
| `licence_class` | constant `Foundation` | verbatim |
| `suffix` | `Foundation = M6aaa` | verbatim |

Row order: **sorted-by-first-column** — alphabetical suffix order carries no meaning; sorted by callsign for diffability (a near no-op given the constant prefix).

**`raw-extract-sheet-2-intermediate.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Intermediate = 20aaa - Appropriate Secondary Regional Indicator applied only when licence issued` (prefix `20`) | prefixed |
| `status` | constant `Available` | verbatim |
| `licence_class` | constant `Intermediate` | verbatim |
| `suffix` | `Intermediate = 20aaa - Appropriate Secondary Regional Indicator applied only when licence issued` | verbatim |

Row order: **sorted-by-first-column** — alphabetical suffix order carries no meaning; sorted by callsign for diffability (a near no-op given the constant prefix).

**`raw-extract-sheet-3-full.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Full = M0aaa` (prefix `M0`) | prefixed |
| `status` | constant `Available` | verbatim |
| `licence_class` | constant `Full` | verbatim |
| `suffix` | `Full = M0aaa` | verbatim |

Row order: **sorted-by-first-column** — alphabetical suffix order carries no meaning; sorted by callsign for diffability (a near no-op given the constant prefix).

### `available-typed-export-7col`

**`raw-extract-sheet-1-foundation.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `suffix` | `Reference` | verbatim |

Required-present but not carried: `Country`, `Current Series`, `Type`.

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order; sorted by callsign for diffability.

**`raw-extract-sheet-2-intermediate.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `suffix` | `Reference` | verbatim |

Required-present but not carried: `Country`, `Current Series`, `Type`.

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order; sorted by callsign for diffability.

**`raw-extract-sheet-3-full.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `suffix` | `Reference` | verbatim |

Required-present but not carried: `Country`, `Current Series`, `Type`.

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order; sorted by callsign for diffability.

### `available-typed-export-8col`

**`raw-extract-sheet-1-foundation.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `suffix` | `Reference` | verbatim |

Required-present but not carried: `Country`, `Current Series`, `Type`, `Allocated Flag`.

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order; sorted by callsign for diffability.

**`raw-extract-sheet-2-intermediate.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `suffix` | `Reference` | verbatim |

Required-present but not carried: `Country`, `Current Series`, `Type`, `Allocated Flag`.

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order; sorted by callsign for diffability.

**`raw-extract-sheet-3-full.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `suffix` | `Reference` | verbatim |

Required-present but not carried: `Country`, `Current Series`, `Type`, `Allocated Flag`.

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order; sorted by callsign for diffability.

### `ofcom-498903-reissue-events`

**`raw-extract-sheet-1-sheet1.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Call Sign T-Number` | verbatim |
| `event` | constant `reissued` | verbatim |
| `event_date` | `Original Start Date` | iso-date |

Row order: **source-order** — source rows are ordered by start date ascending - a meaningful chronology of re-issue events; preserved.

Date plausibility bound: 2017-12-22.

### `ofcom-498906-reciprocal-events`

**`raw-extract-sheet-1-sheet1.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Call Sign T-Number` | verbatim |
| `event` | constant `reciprocal-licence-issued` | verbatim |
| `event_date` | `Original Start Date` | iso-date |

Row order: **source-order** — source rows are ordered by start date ascending - a meaningful chronology of reciprocal-licence issue events; preserved.

Date plausibility bound: 2017-12-22.

### `ofcom-756622-register-and-forbidden`

**`allocated-reserved-forbidden-call-sign-foi-20190912.csv`** (csv, latin1)

| output column | source | kind |
|---|---|---|
| `callsign` | `Call Sign` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Licence Class` | verbatim |
| `licence_issued_date` | `Licence Issued Dat` | date |

Row order: **source-order** — source rows are ordered by Licence Issued Date ascending (blank dates last) - a meaningful publication order in the earliest known bulk disclosure of per-callsign issue dates; preserved verbatim.

Date plausibility bound: 2019-09-12.

**`allocated-reserved-forbidden-call-sign.csv`** (csv, latin1)

| output column | source | kind |
|---|---|---|
| `suffix` | `NAME` | verbatim |

Row order: **sorted-by-first-column** — alphabetical source order carries no meaning; sorted by suffix (a no-op for the archived file, kept for rule consistency).

Date plausibility bound: 2019-09-12.

### `wdtk-1180568-csv-pair`

**`FOI 1900117 Radio amateur licence breakdown by duration held and age sheet 1.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | *(emitted empty)* | verbatim |
| `reserved_to_date` | `Reserved to Date` | date (future allowed) |

Required-present but not carried: `Type`.

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order; sorted by callsign for diffability.

Date plausibility bound: 2024-10-28.

**`FOI 1900117 Radio amateur licence breakdown by duration held and age sheet 2.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Call Sign` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Licence Type` | verbatim |
| `created_date` | `Created Date` | date |
| `original_start_date` | `Original start date` | date |

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order; sorted by callsign for diffability (duplicate callsigns are attribute rows for multiple licences and tie-break on the whole row).

Date plausibility bound: 2024-10-28.

### `wdtk-184767-counts-table`

**`raw-extract-number-of-licences-coleman.md`** (markdown-table, utf8, transcribes `Number of licences Coleman.pdf`)

| output column | source | kind |
|---|---|---|
| `period` | `period (1 April – 31 March)` | verbatim |
| `amateur_radio_licences_issued` | `Amateur Radio` | count |
| `business_radio_licences_issued` | `Business Radio` | count |

Row order: **source-order** — the letter's financial-year order is chronological and meaningful; preserved.

Date plausibility bound: 2013-12-11.

### `wdtk-224333-prefix-suffix-lists`

**`raw-extract-sheet-1-foundation.csv`** (csv, utf8, 2 verbatim-matched preamble row(s))

| output column | source | kind |
|---|---|---|
| `callsign` | `Suffix` (prefix `M6`) | prefixed |
| `status` | constant `Available` | verbatim |
| `licence_class` | constant `Foundation` | verbatim |
| `suffix` | `Suffix` | verbatim |

Row order: **sorted-by-first-column** — alphabetical suffix order carries no meaning; sorted by callsign for diffability (a near no-op given the constant prefix).

**`raw-extract-sheet-2-intermediate.csv`** (csv, utf8, 2 verbatim-matched preamble row(s))

| output column | source | kind |
|---|---|---|
| `callsign` | `Suffix` (prefix `20`) | prefixed |
| `status` | constant `Available` | verbatim |
| `licence_class` | constant `Intermediate` | verbatim |
| `suffix` | `Suffix` | verbatim |

Row order: **sorted-by-first-column** — alphabetical suffix order carries no meaning; sorted by callsign for diffability (a near no-op given the constant prefix).

**`raw-extract-sheet-3-full.csv`** (csv, utf8, 2 verbatim-matched preamble row(s))

| output column | source | kind |
|---|---|---|
| `callsign` | `Suffix` (prefix `M0`) | prefixed |
| `status` | constant `Available` | verbatim |
| `licence_class` | constant `Full` | verbatim |
| `suffix` | `Suffix` | verbatim |

Row order: **sorted-by-first-column** — alphabetical suffix order carries no meaning; sorted by callsign for diffability (a near no-op given the constant prefix).

### `wdtk-238892-prewar-annex`

**`raw-extract-sheet-1-callsigns.csv`** (csv, utf8, 2 verbatim-matched preamble row(s))

| output column | source | kind |
|---|---|---|
| `callsign` | `Call Sign` | verbatim |
| `original_start_date` | `Original Start Date` | iso-date |

Row order: **source-order** — source rows are already callsign-sorted; preserved.

Date plausibility bound: 2015-01-21.

**`raw-extract-sheet-2-database-fields.csv`** (csv, utf8, 0 verbatim-matched preamble row(s))

| output column | source | kind |
|---|---|---|
| `view` | *(emitted empty)* | verbatim |
| `field_name` | `Field Name` | verbatim |

Row order: **source-order** — rows are grouped by database view (Contact View, then Licence View) - a meaningful disclosed structure; preserved.

### `wdtk-251507-transfers-table`

**`raw-extract-applicants-old-call-signs.md`** (markdown-table, utf8, transcribes `applicants old call signs.pdf`)

| output column | source | kind |
|---|---|---|
| `callsign` | `Call Signs` | verbatim |
| `event` | constant `reallocated` | verbatim |
| `event_date` | `Start date` | date |
| `licence_class` | `Licence Product` | verbatim |
| `status` | `Status` | verbatim |
| `reason` | `Reason` | verbatim |
| `licence_number` | `Licence Number` | verbatim |
| `con_id` | `Con Id` | verbatim |

Required-present but not carried: `Title`, `First_name`, `Last_name`.

Row order: **source-order** — the document presents 'the last 20 applications' newest-first; a meaningful order, preserved.

Date plausibility bound: 2015-02-27.

### `wdtk-271469-typed-lists`

**`raw-extract-sheet-1-amateur-foundation.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `suffix` | `Reference` | verbatim |

Required-present but not carried: `Country`, `Current Series`, `Type`, `Allocated Flag`.

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order; sorted by callsign for diffability.

**`raw-extract-sheet-2-amateur-intermediate.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `suffix` | `Reference` | verbatim |

Required-present but not carried: `Country`, `Current Series`, `Type`, `Allocated Flag`.

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order; sorted by callsign for diffability.

**`raw-extract-sheet-3-amateur-full.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `suffix` | `Reference` | verbatim |

Required-present but not carried: `Country`, `Current Series`, `Type`, `Allocated Flag`.

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order; sorted by callsign for diffability.

### `wdtk-309076-combined-list`

**`raw-extract-sheet-1-sheet1.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `suffix` | `Reference` | verbatim |

Required-present but not carried: `Country`, `Current Series`, `Type`, `Allocated Flag`, `Call Sign Application #`, `MMSI Application #`.

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order; sorted by callsign for diffability.

### `wdtk-356636-register-and-forbidden`

**`raw-extract-sheet-1-all-call-signs.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Call Sign` | verbatim |
| `status` | `Final Status` | verbatim |
| `licence_class` | `SF List` | verbatim |

Row order: **sorted-by-first-column** — source rows arrive grouped but not fully ordered (13 duplicate callsigns, not callsign-sorted); no meaningful order evident, sorted by callsign for diffability.

**`raw-extract-sheet-2-forbidden-suffixes.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `suffix` | `Value` | verbatim |

Required-present but not carried: `Type`.

Row order: **sorted-by-first-column** — alphabetical source order carries no meaning; sorted by suffix (a no-op for the archived file, kept for rule consistency).

### `wdtk-596532-register-and-forbidden`

**`raw-extract-sheet-1-all-callsigns-on-record.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Call Sign` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Licence Class` | verbatim |
| `licence_issued_date` | `Licence Issued Dat` | iso-date |

Row order: **source-order** — source rows are ordered by Licence Issued Date ascending (blank dates last) - the same meaningful publication order as the ofcom-756622 register; preserved for cross-snapshot comparability.

Date plausibility bound: 2019-08-12.

**`raw-extract-sheet-2-forbidden-call-signs.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `suffix` | `NAME` | verbatim |

Row order: **sorted-by-first-column** — alphabetical source order carries no meaning; sorted by suffix (a no-op for the archived file, kept for rule consistency).
