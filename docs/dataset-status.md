# Archive dataset status

**Generated file - do not edit by hand.** Regenerate with `npm run dataset:status`;
the test suite fails when this file is stale, so any PR changing archive content
must include the regenerated table (changelog discipline, enforced).

This documents **what exists**. Whether each derivation still *verifies* is the
[normalisation coverage dashboard](https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/360)
(daily sweeps); intake that has not reached the archive yet is tracked in
[`source-register.md`](source-register.md).

## Open-data lane (9 entries)

| entry | raw | meta | normalised | components |
|---|---|---|---|---|
| 2022-05-30 | ✔ | ✔ | ✔ | ✔ |
| 2023-02-20 | ✔ | ✔ | ✔ | ✔ |
| 2025-04-08 | ✔ | ✔ | ✔ | ✔ |
| 2025-05-27 | ✔ | ✔ | ✔ | ✔ |
| 2025-06-04 | ✔ | ✔ | ✔ | ✔ |
| 2025-06-08 | ✔ | ✔ | ✔ | ✔ |
| 2025-11-11 | ✔ | ✔ | ✔ | ✔ |
| 2026-01-14 | — | ✔ | ✔ | ✔ |
| 2026-06-23 | ✔ | ✔ | ✔ | ✔ |

## FOI lane (48 entries)

Extracts: `mech` = mechanically re-derivable (xlsx, via `src/shared/xlsx-extract.ts`);
`transcr` = attested transcription of a PDF (see the entry's raw-extract file).
Entries with no data files are record-only responses (not-held, referrals, or
datasets attested but not yet recovered - see each entry's meta and correspondence).

| entry | outcome | dataset classes | vintage | data files | extracts | converter | normalised |
|---|---|---|---|---|---|---|---|
| ofcom-01420046--allocated-reserved-callsigns | successful | register-snapshot | 2022-03-07 | ✔ 1 | 2 mech | `ofcom-01420046-register` | ✔ 1 |
| ofcom-2016-09-20--callsign-database--all-callsigns | successful | register-snapshot | 2016-09-20 | ✔ 1 | 1 mech | `ofcom-2016-09-20-register` | ✔ 1 |
| ofcom-2017-07-03--all-callsigns-with-status | successful | register-snapshot, reference-context | 2017-04-24 | ✔ 1 | 1 transcr | — | — |
| ofcom-2017-07-13--all-callsigns | successful | register-snapshot | 2017-07-13 | ✔ 1 | — | `ofcom-2017-07-13-register` | ✔ 1 |
| ofcom-2020-03-26--allocated-callsigns | successful | register-snapshot | 2020-03-26 | ✔ 1 | 1 mech | `ofcom-2020-03-26-allocated` | ✔ 1 |
| ofcom-2020-10-23--reserved-callsigns | successful | register-snapshot | 2020-10-23 | ✔ 1 | 1 mech | `ofcom-2020-10-23-reserved` | ✔ 1 |
| ofcom-2021-01--all-callsigns | successful | register-snapshot | 2021-01-29 | ✔ 1 | 1 mech | `ofcom-2021-01-register` | ✔ 1 |
| ofcom-2021-04--all-callsigns | successful | register-snapshot | 2021-04-21 | ✔ 1 | 1 mech | `ofcom-2021-04-register` | ✔ 1 |
| ofcom-2022-03-14--available-and-registered--all-callsigns | successful | register-snapshot | 2022-03-14 | ✔ 1 | 1 mech | `ofcom-2022-03-14-register` | ✔ 1 |
| ofcom-2023-01-25--call-sign-list-with-status--all-callsigns | successful | register-snapshot | 2023-01-25 | ✔ 1 | 1 mech | `ofcom-2023-01-25-register` | ✔ 1 |
| ofcom-2023-08-18--call-sign-list--all-callsigns | successful | register-snapshot | 2023-08-18 | ✔ 1 | 1 mech | `ofcom-2023-08-18-register` | ✔ 1 |
| ofcom-2023-11-24--call-sign-list--all-callsigns | successful | register-snapshot | 2023-11-24 | ✔ 1 | — | `ofcom-2023-11-24-register` | ✔ 1 |
| ofcom-2023-12-07--open-data-call-sign-list--all-callsigns | successful | register-snapshot | 2023-12-07 | ✔ 1 | — | `ofcom-2023-12-07-register` | ✔ 1 |
| ofcom-2024-01--foi-1734722--all-callsigns | successful | register-snapshot | 2024-01 | ✔ 1 | — | `ofcom-2024-01-register` | ✔ 1 |
| ofcom-2024-04-30--copy-all-callsigns--all-callsigns | successful | register-snapshot | 2024-04-30 | ✔ 1 | — | `ofcom-2024-04-30-register` | ✔ 1 |
| ofcom-2024-07--call-signs--all-callsigns | successful | register-snapshot | 2024-07 | ✔ 1 | — | `ofcom-2024-07-register` | ✔ 1 |
| ofcom-2024-09--every-radio-callsign--all-callsigns | successful | register-snapshot | 2024-09 | ✔ 1 | — | `ofcom-2024-09-register` | ✔ 1 |
| ofcom-2024-10-21--callsigns--all-callsigns | successful | register-snapshot | 2024-10-21 | ✔ 1 | — | `ofcom-2024-10-21-register` | ✔ 1 |
| ofcom-2024-12--forbidden-suffixes | successful | forbidden-list | 2024-12 | ✔ 1 | — | `ofcom-2024-12-forbidden-suffixes` | ✔ 1 |
| ofcom-2025-03-13--callsigns--all-callsigns | successful | register-snapshot | 2025-03-13 | ✔ 1 | — | `ofcom-2025-03-13-register` | ✔ 1 |
| ofcom-2025-09-11--callsigns--all-callsigns | successful | register-snapshot | 2025-09-11 | ✔ 1 | 1 mech | `ofcom-2025-09-11-register` | ✔ 1 |
| ofcom-285990--available-list-jun-2016 | successful | reference-context | 2016-06-29 | — | 1 transcr | — | — |
| ofcom-299351--available-list-referral | successful | reference-context | — | — | 1 transcr | — | — |
| ofcom-337399--all-callsigns-published-copy | successful | register-snapshot, forbidden-list | 2016-09 | ✔ 1 | 1 transcr | — | — |
| ofcom-498903--reissued-callsigns-since-2010 | successful | issuance-events | 2017-11 | ✔ 1 | 1 mech + 1 transcr | `ofcom-498903-reissue-events` | ✔ 1 |
| ofcom-498906--reciprocal-licences-since-2010 | successful | issuance-events | 2017-11 | ✔ 1 | 1 mech + 1 transcr | `ofcom-498906-reciprocal-events` | ✔ 1 |
| ofcom-518689--suffix-availability-not-held | not held | reference-context | — | — | 1 transcr | — | — |
| ofcom-612185--unallocated-callsigns-not-held | not held | reference-context | — | — | 1 transcr | — | — |
| ofcom-632469--suffix-availability-not-held | not held | reference-context | — | — | 1 transcr | — | — |
| ofcom-671462--suffix-availability-not-held | not held | reference-context | — | — | 1 transcr | — | — |
| ofcom-756622--published-register-csv | successful | register-snapshot, forbidden-list, attribute-addendum | 2019-09-12 | ✔ 2 | — | `ofcom-756622-register-and-forbidden` | ✔ 2 |
| wdtk-1180568--licence-breakdown-duration-age | successful | register-snapshot, attribute-addendum | 2024-10 | ✔ 2 | 1 transcr | `wdtk-1180568-csv-pair` | ✔ 2 |
| wdtk-174341--available-callsigns-list | successful | available-pool | 2013-09-06 | ✔ 1 | 3 mech + 2 transcr | `available-suffix-lists-2013-style` | ✔ 3 |
| wdtk-174543--licence-statistics | successful | statistics-aggregate | 2013-08-28 | ✔ 1 | 2 transcr | — | — |
| wdtk-184767--annual-licence-counts | successful | statistics-aggregate | 2013-12 | ✔ 1 | 1 transcr | `wdtk-184767-counts-table` | ✔ 1 |
| wdtk-197896--available-callsigns-list | successful | available-pool | 2014-03-14 | ✔ 1 | 3 mech | `available-suffix-lists-2013-style` | ✔ 3 |
| wdtk-224333--available-callsigns-list | successful | available-pool | 2014-08-18 | ✔ 1 | 3 mech + 1 transcr | `wdtk-224333-prefix-suffix-lists` | ✔ 3 |
| wdtk-238892--out-of-sequence-callsigns | successful | attribute-addendum, reference-context | 2015-01 | ✔ 1 | 2 mech + 3 transcr | `wdtk-238892-prewar-annex` | ✔ 2 |
| wdtk-247308--available-callsigns-list | successful | available-pool | 2015-02-25 | ✔ 1 | 3 mech + 1 transcr | `available-typed-export-8col` | ✔ 3 |
| wdtk-248271--callbook-psi-licensees | successful | reference-context | 2015-01 | ✔ 1 | 3 transcr | — | — |
| wdtk-251507--reissue-policy | successful | reference-context, issuance-events, attribute-addendum | 2015-02 | ✔ 2 | 2 transcr | `wdtk-251507-transfers-table` | ✔ 1 |
| wdtk-261814--available-callsigns-list | successful | available-pool | 2015-04-16 | ✔ 1 | 3 mech | `available-typed-export-8col` | ✔ 3 |
| wdtk-271469--available-callsigns-list | successful | available-pool | 2015-06-11 | ✔ 1 | 3 mech + 1 transcr | `wdtk-271469-typed-lists` | ✔ 3 |
| wdtk-294011--available-callsigns-list | successful | available-pool | 2015-10-13 | ✔ 1 | 3 mech | `available-typed-export-7col` | ✔ 3 |
| wdtk-299321--available-callsigns-list | successful | available-pool | 2015-10-13 | ✔ 1 | 3 mech | `available-typed-export-7col` | ✔ 3 |
| wdtk-309076--available-callsigns-list | successful | available-pool | 2016-01-21 | ✔ 1 | 1 mech | `wdtk-309076-combined-list` | ✔ 1 |
| wdtk-356636--all-callsigns-plus-forbidden | successful | register-snapshot, forbidden-list | 2016-09 | ✔ 1 | 3 mech + 1 transcr | `wdtk-356636-register-and-forbidden` | ✔ 2 |
| wdtk-596532--allocated-reserved-forbidden | successful | register-snapshot, forbidden-list | 2019-08-12 | ✔ 1 | 2 mech + 1 transcr | `wdtk-596532-register-and-forbidden` | ✔ 2 |
