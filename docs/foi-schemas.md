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

Under [ADR 0013](adr/0013-raw-keyed-claim-ledger.md), these schemas are being
recast as **derived folds** over the raw-keyed claim ledger rather than the
canonical format; the vocabulary here remains the contract in the interim.

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
| `licence_cancel_date` | `callsign-observation` | the date a licence was cancelled as disclosed in a register export, ISO-rendered; a past event that cannot postdate the snapshot, recorded only where the source carries one (historic values reach back to the 1930s) |
| `last_modified_date` | `suffix-list`, `callsign-observation` | the record's last-modified timestamp as disclosed in a Salesforce-era export, ISO-rendered with any time-of-day kept: per-suffix provenance in the forbidden-suffix list, per-callsign provenance in the 2023-24 register snapshots - in both cases the dated provenance the earlier exports lack |
| `call_sign_type` | `callsign-observation` | the call-sign service/type discriminator carried verbatim ("Call Sign - Amateur" / "Call Sign - NoV"), kept only where a snapshot asserts more than one value so the Notice-of-Variation special-event/permit callsigns stay distinguishable from ordinary amateur ones (elsewhere the constant Type is a discriminator recorded in meta, not carried) |
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
| `ofcom-01420046-register` | `ofcom-01420046--allocated-reserved-callsigns` |
| `ofcom-2016-09-20-register` | `ofcom-2016-09-20--callsign-database--all-callsigns` |
| `ofcom-2017-07-13-register` | `ofcom-2017-07-13--all-callsigns` |
| `ofcom-2020-03-26-allocated` | `ofcom-2020-03-26--allocated-callsigns` |
| `ofcom-2020-04-23-club-callsigns` | `ofcom-2020-04-23--club-call-signs` |
| `ofcom-2020-10-23-reserved` | `ofcom-2020-10-23--reserved-callsigns` |
| `ofcom-2021-01-register` | `ofcom-2021-01--all-callsigns` |
| `ofcom-2021-04-register` | `ofcom-2021-04--all-callsigns` |
| `ofcom-2022-03-14-register` | `ofcom-2022-03-14--available-and-registered--all-callsigns` |
| `ofcom-2023-01-25-register` | `ofcom-2023-01-25--call-sign-list-with-status--all-callsigns` |
| `ofcom-2023-08-18-register` | `ofcom-2023-08-18--call-sign-list--all-callsigns` |
| `ofcom-2023-11-24-register` | `ofcom-2023-11-24--call-sign-list--all-callsigns` |
| `ofcom-2023-12-07-register` | `ofcom-2023-12-07--open-data-call-sign-list--all-callsigns` |
| `ofcom-2024-01-register` | `ofcom-2024-01--foi-1734722--all-callsigns` |
| `ofcom-2024-04-30-register` | `ofcom-2024-04-30--copy-all-callsigns--all-callsigns` |
| `ofcom-2024-07-register` | `ofcom-2024-07--call-signs--all-callsigns` |
| `ofcom-2024-09-register` | `ofcom-2024-09--every-radio-callsign--all-callsigns` |
| `ofcom-2024-10-21-register` | `ofcom-2024-10-21--callsigns--all-callsigns` |
| `ofcom-2024-12-forbidden-suffixes` | `ofcom-2024-12--forbidden-suffixes` |
| `ofcom-2025-03-13-register` | `ofcom-2025-03-13--callsigns--all-callsigns` |
| `ofcom-2025-09-11-register` | `ofcom-2025-09-11--callsigns--all-callsigns` |
| `ofcom-210648-corrupt-annex-register` | `ofcom-210648--corrupt-annex-callsigns` |
| `ofcom-498903-reissue-events` | `ofcom-498903--reissued-callsigns-since-2010` |
| `ofcom-498906-reciprocal-events` | `ofcom-498906--reciprocal-licences-since-2010` |
| `ofcom-756622-register-and-forbidden` | `ofcom-756622--published-register-csv` |
| `wdtk-1141667-issued-callsigns` | `wdtk-1141667--issued-callsigns` |
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

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Country`: verified constant `M` on every row
- `Current Series`: verified constant `6` on every row
- `Type`: verified constant `Call Sign` on every row

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order; sorted by callsign for diffability.

**`raw-extract-sheet-2-intermediate.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `suffix` | `Reference` | verbatim |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Country`: verified constant `2` on every row
- `Current Series`: content-bearing, not value-verified - the callsign's own series decomposition - constant "0" but for a couple of rows carrying "1"
- `Type`: verified constant `Call Sign` on every row

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order; sorted by callsign for diffability.

**`raw-extract-sheet-3-full.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `suffix` | `Reference` | verbatim |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Country`: content-bearing, not value-verified - the callsign's own country decomposition - this combined sheet mixes a handful of non-M values in (G, GB, U, and blanks)
- `Current Series`: content-bearing, not value-verified - the callsign's own series decomposition - this combined sheet mixes a handful of non-0 values in, plus blanks
- `Type`: content-bearing, not value-verified - 'Call Sign' throughout except a handful of blank cells

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order; sorted by callsign for diffability.

### `available-typed-export-8col`

**`raw-extract-sheet-1-foundation.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `suffix` | `Reference` | verbatim |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Country`: verified constant `M` on every row
- `Current Series`: verified constant `6` on every row
- `Type`: verified constant `Call Sign` on every row
- `Allocated Flag`: verified constant `N` on every row

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order; sorted by callsign for diffability.

**`raw-extract-sheet-2-intermediate.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `suffix` | `Reference` | verbatim |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Country`: verified constant `2` on every row
- `Current Series`: content-bearing, not value-verified - the callsign's own series decomposition - constant "0" but for one row carrying "1"
- `Type`: verified constant `Call Sign` on every row
- `Allocated Flag`: verified constant `N` on every row

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order; sorted by callsign for diffability.

**`raw-extract-sheet-3-full.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `suffix` | `Reference` | verbatim |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Country`: content-bearing, not value-verified - the callsign's own country decomposition - this combined sheet mixes a handful of non-M values in (G, GB, U, and 2 blanks)
- `Current Series`: content-bearing, not value-verified - the callsign's own series decomposition - this combined sheet mixes a handful of non-0 values in, plus 6 blanks
- `Type`: content-bearing, not value-verified - 'Call Sign' throughout except 2 blank cells
- `Allocated Flag`: verified constant `N` on every row

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order; sorted by callsign for diffability.

### `ofcom-01420046-register`

**`raw-extract-sheet-1-report1646659776237.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | *(emitted empty)* | verbatim |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Type`: verified constant `Call Sign - Amateur` on every row

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order (not callsign-sorted, no dates); sorted by callsign for diffability and cross-snapshot comparability.

### `ofcom-2016-09-20-register`

**`raw-extract-sheet-1-sheet1.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Call Sign` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | *(emitted empty)* | verbatim |

Row order: **sorted-by-first-column** — source rows arrive grouped (intermediate 20-series first, forbidden values last) but carry no globally meaningful order (13 duplicate callsigns, not callsign-sorted); sorted by callsign for diffability and cross-snapshot comparability.

### `ofcom-2017-07-13-register`

**`Amateur Call Signs for FOI Request 13 Jul 17.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | *(emitted empty)* | verbatim |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Prefix`: content-bearing, not value-verified - Ofcom's own prefix decomposition of the callsign - not the registered `suffix` extension (the split is not uniformly three-letter-suffix-shaped), preserved verbatim in the archived source only
- `Suffix`: content-bearing, not value-verified - Ofcom's own suffix decomposition of the callsign - not the registered `suffix` extension, preserved verbatim in the archived source only
- `Type`: verified constant `Call Sign - Amateur` on every row

Row order: **sorted-by-first-column** — source rows arrive grouped by suffix but carry no meaningful publication order (no dates, not callsign-sorted); sorted by callsign for diffability and cross-snapshot comparability.

### `ofcom-2020-03-26-allocated`

**`raw-extract-sheet-1-allocated-callsign-as-at-260320.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | *(emitted empty)* | verbatim |

Row order: **sorted-by-first-column** — the source is already grouped by suffix but carries no meaningful publication order (no dates); sorted by callsign for diffability and cross-snapshot comparability.

### `ofcom-2020-04-23-club-callsigns`

**`club-callsigns.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `callsign` | verbatim |
| `status` | `status` | verbatim |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `page`: content-bearing, not value-verified - PDF page number the row was transcribed from - positional layout provenance, not a per-row data assertion
- `row_on_page`: content-bearing, not value-verified - row position within the PDF page - positional layout provenance, not a per-row data assertion

Row order: **sorted-by-first-column** — the source order is the PDF page/row layout, not a meaningful assertion order; sorted by callsign for diffability, with the whole row as tie-break so the recurring per-licence records (and the blank-callsign rows) are all preserved.

### `ofcom-2020-10-23-reserved`

**`raw-extract-sheet-1-reserved-callsigns-23-10-2020.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | *(emitted empty)* | verbatim |
| `created_date` | `Call Sign MMSI: Created Date` | iso-date |
| `last_modified_date` | `Call Sign MMSI: Last Modified Date` | iso-date |
| `reserved_to_date` | `Reserved to Date` | iso-date (future allowed) |
| `licence_cancel_date` | `Licence Cancel Date` | iso-date |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Type`: verified constant `Call Sign - Amateur` on every row

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order (not callsign-sorted, dates not monotonic); sorted by callsign for diffability and cross-snapshot comparability (the one blank callsign sorts first).

Date plausibility bound: 2020-10-23.

### `ofcom-2021-01-register`

**`raw-extract-sheet-1-callsigns.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Licence Type` | verbatim |
| `reserved_to_date` | `Reserved to Date` | iso-date (future allowed) |
| `original_start_date` | `Original Start Date` | iso-date |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Type`: verified constant `Call Sign - Amateur` on every row

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order (not callsign-sorted, dates not monotonic); sorted by callsign for diffability and cross-snapshot comparability.

Date plausibility bound: 2021-01-29.

### `ofcom-2021-04-register`

**`raw-extract-sheet-1-sheet1.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Licence type` | verbatim |
| `reserved_to_date` | `Reserved to Date` | iso-date (future allowed) |
| `original_start_date` | `Original start date` | iso-date |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Type`: verified constant `Call Sign - Amateur` on every row

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order (not callsign-sorted, dates not monotonic); sorted by callsign for diffability and cross-snapshot comparability.

Date plausibility bound: 2021-04-21.

### `ofcom-2022-03-14-register`

**`raw-extract-sheet-1-report1647268967067.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | *(emitted empty)* | verbatim |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Type`: verified constant `Call Sign - Amateur` on every row

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order (not callsign-sorted, no dates); sorted by callsign for diffability and cross-snapshot comparability.

### `ofcom-2023-01-25-register`

**`raw-extract-sheet-1-report1674642037414.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `last_modified_date` | `Call Sign MMSI: Last Modified Date` | iso-date |

Row order: **sorted-by-first-column** — source rows arrive grouped (reserved blocks first) but carry no globally meaningful order (not callsign-sorted, not date-ordered); sorted by callsign for diffability and cross-snapshot comparability.

Date plausibility bound: 2023-01-25.

### `ofcom-2023-08-18-register`

**`raw-extract-sheet-1-call-sign-data.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `last_modified_date` | `Call Sign MMSI: Last Modified Date` | iso-date |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Type`: verified constant `Call Sign - Amateur` on every row

Row order: **sorted-by-first-column** — source rows arrive grouped (reserved blocks first) but carry no globally meaningful order (not callsign-sorted, not date-ordered); sorted by callsign for diffability and cross-snapshot comparability.

Date plausibility bound: 2023-08-18.

### `ofcom-2023-11-24-register`

**`call-sign-list-241123.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `last_modified_date` | `Call Sign MMSI: Last Modified Date` | date |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Type`: verified constant `Call Sign - Amateur` on every row

Row order: **sorted-by-first-column** — source rows arrive grouped (reserved blocks first) but carry no globally meaningful order (not callsign-sorted, not date-ordered); sorted by callsign for diffability and cross-snapshot comparability.

Date plausibility bound: 2023-11-24.

### `ofcom-2023-12-07-register`

**`call-sign-list-for-open-data-07-12-23.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `last_modified_date` | `Call Sign MMSI: Last Modified Date` | date |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Type`: verified constant `Call Sign - Amateur` on every row

Row order: **sorted-by-first-column** — source rows arrive grouped (reserved blocks first) but carry no globally meaningful order (not callsign-sorted, not date-ordered); sorted by callsign for diffability and cross-snapshot comparability.

Date plausibility bound: 2023-12-07.

### `ofcom-2024-01-register`

**`foi-1734722-amateur-call-signs.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `last_modified_date` | `Call Sign MMSI: Last Modified Date` | date |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Type`: verified constant `Call Sign - Amateur` on every row

Row order: **sorted-by-first-column** — source rows arrive grouped (reserved blocks first) but carry no globally meaningful order (not callsign-sorted, not date-ordered); sorted by callsign for diffability and cross-snapshot comparability.

Date plausibility bound: 2024-01-31.

### `ofcom-2024-04-30-register`

**`copy-all-callsigns-30-apr-24.csv`** (csv, latin1)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value__c` | verbatim |
| `status` | `Status__c` | verbatim |
| `licence_class` | `Product__c` | verbatim |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Type__c`: verified constant `Call Sign - Amateur` on every row

Row order: **sorted-by-first-column** — source rows arrive grouped but carry no globally meaningful order (not callsign-sorted, no dates); sorted by callsign for diffability and cross-snapshot comparability.

### `ofcom-2024-07-register`

**`call-signs.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Call sign` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `last_modified_date` | `Call Sign MMSI: Last Modified Date` | date |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Type`: verified constant `Call Sign - Amateur` on every row

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order (not callsign-sorted, no clear date order); sorted by callsign for diffability and cross-snapshot comparability.

Date plausibility bound: 2024-07-31.

### `ofcom-2024-09-register`

**`every-radio-callsign-spreadsheet.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `call_sign_type` | `Type` | verbatim |
| `created_date` | `Created Date` | date |
| `reserved_to_date` | `Reserved to Date` | date (future allowed) |

Row order: **sorted-by-first-column** — source rows arrive roughly callsign-grouped but carry no globally meaningful order (not fully callsign-sorted, not date-ordered); sorted by callsign for diffability and cross-snapshot comparability.

Date plausibility bound: 2024-09-30.

### `ofcom-2024-10-21-register`

**`copy-of-callsigns-21102024.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Callsign` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `last_modified_date` | `Last Modified Date` | date |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Type`: verified constant `Call Sign - Amateur` on every row

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order (not callsign-sorted, no clear date order); sorted by callsign for diffability and cross-snapshot comparability.

Date plausibility bound: 2024-10-21.

### `ofcom-2024-12-forbidden-suffixes`

**`forbidden-amateur-radio-callsigns.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `suffix` | `Name` | verbatim |
| `last_modified_date` | `LastModifiedDate` | date |

Row order: **sorted-by-first-column** — the source is alphabetical by suffix and carries no other meaningful order; sorted by suffix for diffability and cross-disclosure comparability (a near no-op).

Date plausibility bound: 2024-12-31.

### `ofcom-2025-03-13-register`

**`call-signs-13mar2025.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Callsign` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `last_modified_date` | `LastModifiedDate` | date |
| `created_date` | `CreatedDate` | date |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Type`: verified constant `Call Sign - Amateur` on every row

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order (not callsign-sorted, no clear date order); sorted by callsign for diffability and cross-snapshot comparability.

Date plausibility bound: 2025-03-13.

### `ofcom-2025-09-11-register`

**`raw-extract-sheet-1-amateur-callsgn-11092025.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Callsign` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product__c` | verbatim |
| `last_modified_date` | `Licence LastModifiedDate` | iso-date |
| `original_start_date` | `Licence Original_start_date__c` | iso-date |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Type`: verified constant `Call Sign - Amateur` on every row

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order (not callsign-sorted, dates not monotonic); sorted by callsign for diffability and cross-snapshot comparability.

Date plausibility bound: 2025-09-11.

### `ofcom-210648-corrupt-annex-register`

**`raw-extract-sheet-1-sheet1.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | *(emitted empty)* | verbatim |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Type`: verified constant `Call Sign - Amateur` on every row

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order (not callsign-sorted, no dates); sorted by callsign for diffability and cross-snapshot comparability.

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

### `wdtk-1141667-issued-callsigns`

**`raw-extract-sheet-1-sheet1.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Call Sign` | verbatim |
| `status` | `Status__c` | verbatim |
| `licence_class` | `Product__c` | verbatim |
| `last_modified_date` | `LastModifiedDate` | iso-date |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Type__c`: verified constant `Call Sign - Amateur` on every row

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order (not callsign-sorted, dates not monotonic); sorted by callsign for diffability and cross-snapshot comparability.

Date plausibility bound: 2024-07-22.

### `wdtk-1180568-csv-pair`

**`FOI 1900117 Radio amateur licence breakdown by duration held and age sheet 1.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | *(emitted empty)* | verbatim |
| `reserved_to_date` | `Reserved to Date` | date (future allowed) |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Type`: verified constant `Call Sign - Amateur` on every row

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

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Title`: verified constant `S40` on every row
- `First_name`: verified constant `S40` on every row
- `Last_name`: verified constant `S40` on every row

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

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Country`: verified constant `M` on every row
- `Current Series`: verified constant `6` on every row
- `Type`: verified constant `Call Sign` on every row
- `Allocated Flag`: verified constant `N` on every row

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order; sorted by callsign for diffability.

**`raw-extract-sheet-2-amateur-intermediate.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `suffix` | `Reference` | verbatim |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Country`: verified constant `2` on every row
- `Current Series`: content-bearing, not value-verified - the callsign's own series decomposition - constant "0" but for one row carrying "1"
- `Type`: verified constant `Call Sign` on every row
- `Allocated Flag`: verified constant `N` on every row

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order; sorted by callsign for diffability.

**`raw-extract-sheet-3-amateur-full.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `suffix` | `Reference` | verbatim |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Country`: content-bearing, not value-verified - the callsign's own country decomposition - this combined sheet mixes a handful of non-M values in (G, GB, U, and 2 blanks)
- `Current Series`: content-bearing, not value-verified - the callsign's own series decomposition - this combined sheet mixes a handful of non-0 values in, plus 4 blanks
- `Type`: content-bearing, not value-verified - 'Call Sign' throughout except 2 blank cells
- `Allocated Flag`: verified constant `N` on every row

Row order: **sorted-by-first-column** — source rows arrive in no meaningful order; sorted by callsign for diffability.

### `wdtk-309076-combined-list`

**`raw-extract-sheet-1-sheet1.csv`** (csv, utf8)

| output column | source | kind |
|---|---|---|
| `callsign` | `Value` | verbatim |
| `status` | `Status` | verbatim |
| `licence_class` | `Product` | verbatim |
| `suffix` | `Reference` | verbatim |

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Country`: content-bearing, not value-verified - the callsign's own country decomposition - this all-classes sheet carries M, 2, G and a few other values
- `Current Series`: content-bearing, not value-verified - the callsign's own series decomposition - this all-classes sheet carries 0, 6, 1 and a few other values
- `Type`: content-bearing, not value-verified - 'Call Sign' throughout except 2 blank cells
- `Allocated Flag`: verified constant `N` on every row
- `Call Sign Application #`: verified empty on every row
- `MMSI Application #`: verified empty on every row

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

Required-present but not carried (issue #577 - VERIFIED against the actual raw values, not merely declared):

- `Type`: verified constant `Forbidden` on every row

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
