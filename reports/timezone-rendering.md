# Timezone-rendering classification (per source)

Which clock convention each source's date/datetime columns are rendered
under (issue #858), classified by chained NATURAL EXPERIMENTS: two
sources sharing records on the same event kind, at least one side
carrying time-of-day, disagreeing by exactly one day ONLY in the
midnight-offset window of BST-dated stamps — the UTC-vs-local
day-truncation signature the #857 review proved on the wdtk-1141667 /
2024-07-register pair. Every conclusion is **[derived]** — Ofcom states
no timezone anywhere in any export — and is offered with its evidence
chain named and re-runnable (`node src/ci/timezone-rendering.ts`),
never adjudicated (issue #467). Sources with insufficient overlap are
honestly UNCLASSIFIED, never guessed.

The candidate convention set is **{UTC, Europe/London civil time}** — a
stated assumption: these are the only conventions a UK regulator's
export plausibly renders and the only two the one-day boundary
experiment distinguishes; any third convention would surface loudly in
the unexplained bucket.

Binding caveats (issue #858):

- **Season-limited detectability**: GMT = UTC in winter, so only
  BST-dated boundary-crossing stamps discriminate. A pair with no such
  overlap is honestly undeterminable — winter agreement is NOT evidence
  of same convention.
- **Same-upstream-instant assumption**: records revised between the two
  exports are excluded (|day difference| > 1); a re-stamping pipeline
  would surface as conflicting evidence, which is a loud finding here,
  never averaged away.
- **Per-export scope**: this classifies each EXPORT's rendering, not the
  source system — the corpus itself shows the register's rendering
  changing between exports.
- **Scope**: the universe is every source asserting at least one S1
  event-date claim. A dated column outside the S1 tier (e.g. the
  forbidden-list disclosures' `LastModifiedDate`, a documented S1
  exclusion) is out of scope until that tier covers it.

Evidence floor: 5 subjects; noise tolerance: 5% of the supporting evidence.

## Per-source classification

The annotation this report exists to derive. `[derived]` throughout;
the chain column is the working — each hop names the exact pairwise
experiment (re-runnable from the pairs table below) that carries the
conclusion to this source. "Additional corroborating routes" counts
further chains reaching the same label from a different anchoring
experiment (routes may still share downstream equality edges, so they
are additional evidence, not fully independent derivations).

| source | rendering | evidence chain |
|---|---|---|
| `foi/ofcom-2020-10-23--reserved-callsigns` | **renders Europe/London local time** [derived] | 1. `foi/wdtk-1141667--issued-callsigns vs foi/ofcom-2020-10-23--reserved-callsigns [record-last-modified]` — oriented shift: 204 summer boundary subjects place the timed side on UTC<br>(+1 additional corroborating route) |
| `foi/ofcom-2021-01--all-callsigns` | unclassified — no pairwise experiment reaches this source (no shared record overlap with a time-of-day-bearing source) | — |
| `foi/ofcom-2021-04--all-callsigns` | unclassified — no pairwise experiment reaches this source (no shared record overlap with a time-of-day-bearing source) | — |
| `foi/ofcom-2023-01-25--call-sign-list-with-status--all-callsigns` | **renders Europe/London local time** [derived] | 1. `foi/wdtk-1141667--issued-callsigns vs foi/ofcom-2023-01-25--call-sign-list-with-status--all-callsigns [record-last-modified]` — oriented shift: 322 summer boundary subjects place the timed side on UTC<br>(+3 additional corroborating routes) |
| `foi/ofcom-2023-08-18--call-sign-list--all-callsigns` | **renders Europe/London local time** [derived] | 1. `foi/wdtk-1141667--issued-callsigns vs foi/ofcom-2023-08-18--call-sign-list--all-callsigns [record-last-modified]` — oriented shift: 434 summer boundary subjects place the timed side on UTC<br>(+3 additional corroborating routes) |
| `foi/ofcom-2023-11-24--call-sign-list--all-callsigns` | **renders Europe/London local time** [derived] | 1. `foi/wdtk-1141667--issued-callsigns vs foi/ofcom-2023-11-24--call-sign-list--all-callsigns [record-last-modified]` — oriented shift: 485 summer boundary subjects place the timed side on UTC<br>(+3 additional corroborating routes) |
| `foi/ofcom-2023-12-07--open-data-call-sign-list--all-callsigns` | **renders Europe/London local time** [derived] | 1. `foi/wdtk-1141667--issued-callsigns vs foi/ofcom-2023-12-07--open-data-call-sign-list--all-callsigns [record-last-modified]` — oriented shift: 485 summer boundary subjects place the timed side on UTC<br>(+3 additional corroborating routes) |
| `foi/ofcom-2024-01--foi-1734722--all-callsigns` | **renders Europe/London local time** [derived] | 1. `foi/wdtk-1141667--issued-callsigns vs foi/ofcom-2024-01--foi-1734722--all-callsigns [record-last-modified]` — oriented shift: 485 summer boundary subjects place the timed side on UTC<br>(+3 additional corroborating routes) |
| `foi/ofcom-2024-07--call-signs--all-callsigns` | **renders Europe/London local time** [derived] | 1. `foi/wdtk-1141667--issued-callsigns vs foi/ofcom-2024-07--call-signs--all-callsigns [record-last-modified]` — oriented shift: 629 summer boundary subjects place the timed side on UTC<br>(+3 additional corroborating routes) |
| `foi/ofcom-2024-09--every-radio-callsign--all-callsigns` | **renders UTC** [derived] | 1. `opendata/2025-06-04 vs foi/ofcom-2020-10-23--reserved-callsigns [record-last-modified]` — oriented shift: 197 summer boundary subjects place the timed side on UTC<br>2. `foi/ofcom-2024-09--every-radio-callsign--all-callsigns vs opendata/2025-06-04 [record-created]` — same-convention (119 agreeing boundary subjects)<br>(+1 additional corroborating route) |
| `foi/ofcom-2024-10-21--callsigns--all-callsigns` | **renders UTC** [derived] | 1. `foi/wdtk-1141667--issued-callsigns vs foi/ofcom-2020-10-23--reserved-callsigns [record-last-modified]` — oriented shift: 204 summer boundary subjects place the timed side on UTC<br>2. `foi/wdtk-1141667--issued-callsigns vs foi/ofcom-2024-10-21--callsigns--all-callsigns [record-last-modified]` — same-convention (706 agreeing boundary subjects)<br>(+3 additional corroborating routes) |
| `foi/ofcom-2025-03-13--callsigns--all-callsigns` | **renders UTC** [derived] | 1. `foi/wdtk-1141667--issued-callsigns vs foi/ofcom-2020-10-23--reserved-callsigns [record-last-modified]` — oriented shift: 204 summer boundary subjects place the timed side on UTC<br>2. `foi/wdtk-1141667--issued-callsigns vs foi/ofcom-2025-03-13--callsigns--all-callsigns [record-last-modified]` — same-convention (691 agreeing boundary subjects)<br>(+3 additional corroborating routes) |
| `foi/ofcom-2025-09-11--callsigns--all-callsigns` | unclassified — no pairwise experiment reaches this source (no shared record overlap with a time-of-day-bearing source) | — |
| `foi/ofcom-756622--published-register-csv` | unclassified — only a one-window agreement constraint (excludes one orientation) with no labelled partner to combine with | — |
| `foi/wdtk-1141667--issued-callsigns` | **renders UTC** [derived] | 1. `foi/wdtk-1141667--issued-callsigns vs foi/ofcom-2020-10-23--reserved-callsigns [record-last-modified]` — oriented shift: 204 summer boundary subjects place the timed side on UTC<br>(+10 additional corroborating routes) |
| `foi/wdtk-1180568--licence-breakdown-duration-age` | unclassified — no pairwise experiment reaches this source (no shared record overlap with a time-of-day-bearing source) | — |
| `foi/wdtk-596532--allocated-reserved-forbidden` | unclassified — only a one-window agreement constraint (excludes one orientation) with no labelled partner to combine with | — |
| `opendata/2023-02-20` | **renders Europe/London local time** [derived] | 1. `foi/wdtk-1141667--issued-callsigns vs opendata/2023-02-20 [record-last-modified]` — oriented shift: 323 summer boundary subjects place the timed side on UTC<br>(+3 additional corroborating routes) |
| `opendata/2025-04-08` | **renders UTC** [derived] | 1. `foi/wdtk-1141667--issued-callsigns vs foi/ofcom-2020-10-23--reserved-callsigns [record-last-modified]` — oriented shift: 204 summer boundary subjects place the timed side on UTC<br>2. `foi/wdtk-1141667--issued-callsigns vs opendata/2025-04-08 [record-last-modified]` — same-convention (688 agreeing boundary subjects)<br>(+3 additional corroborating routes) |
| `opendata/2025-05-27` | **renders UTC** [derived] | 1. `opendata/2025-05-27 vs foi/ofcom-2023-01-25--call-sign-list-with-status--all-callsigns [record-last-modified]` — oriented shift: 5 summer boundary subjects place the timed side on UTC<br>(+9 additional corroborating routes) |
| `opendata/2025-06-04` | **renders UTC** [derived] | 1. `opendata/2025-06-04 vs foi/ofcom-2020-10-23--reserved-callsigns [record-last-modified]` — oriented shift: 197 summer boundary subjects place the timed side on UTC<br>(+10 additional corroborating routes) |
| `opendata/2025-06-08` | **renders UTC** [derived] | 1. `opendata/2025-06-08 vs foi/ofcom-2023-01-25--call-sign-list-with-status--all-callsigns [record-last-modified]` — oriented shift: 5 summer boundary subjects place the timed side on UTC<br>(+9 additional corroborating routes) |
| `opendata/2025-11-11` | unclassified — no pairwise experiment reaches this source (no shared record overlap with a time-of-day-bearing source) | — |
| `opendata/2026-01-14` | unclassified — no pairwise experiment reaches this source (no shared record overlap with a time-of-day-bearing source) | — |
| `opendata/2026-06-23` | unclassified — no pairwise experiment reaches this source (no shared record overlap with a time-of-day-bearing source) | — |

## Pairwise natural experiments

One row per (timed source, partner source, event kind) sharing
single-valued subjects. Cells: oriented one-day shifts in the two
midnight-offset windows (utc→ / ←local), window agreements (a23 / a0),
agreement with no orientation signal, unexplained one-day disagreements,
not-comparable (revised between exports, excluded), and
margin/pre-1996 exclusions.

| timed source | partner source | kind | utc→ | ←local | a23 | a0 | agree (no signal) | unexplained | not comparable | excluded | verdict |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `foi/ofcom-2024-09--every-radio-callsign--all-callsigns` | `foi/ofcom-2020-10-23--reserved-callsigns` | `record-created` | 2 | 0 | 0 | 1 | 50,511 | 0 | 0 | 3 | insufficient-evidence |
| `foi/ofcom-2024-09--every-radio-callsign--all-callsigns` | `foi/ofcom-2025-03-13--callsigns--all-callsigns` | `record-created` | 0 | 0 | 98 | 21 | 155,664 | 0 | 0 | 241 | same-convention |
| `foi/ofcom-2024-09--every-radio-callsign--all-callsigns` | `opendata/2025-04-08` | `record-created` | 0 | 0 | 98 | 21 | 155,669 | 0 | 0 | 241 | same-convention |
| `foi/ofcom-2024-09--every-radio-callsign--all-callsigns` | `opendata/2025-05-27` | `record-created` | 0 | 0 | 4 | 1 | 976 | 0 | 0 | 0 | insufficient-evidence |
| `foi/ofcom-2024-09--every-radio-callsign--all-callsigns` | `opendata/2025-06-04` | `record-created` | 0 | 0 | 98 | 21 | 110,617 | 0 | 0 | 233 | same-convention |
| `foi/ofcom-2024-09--every-radio-callsign--all-callsigns` | `opendata/2025-06-08` | `record-created` | 0 | 0 | 4 | 1 | 976 | 0 | 0 | 0 | insufficient-evidence |
| `foi/wdtk-1141667--issued-callsigns` | `foi/ofcom-2020-10-23--reserved-callsigns` | `record-last-modified` | 204 | 0 | 0 | 0 | 6,823 | 0 | 434 | 33 | differs-by-local-offset (timed side = UTC) |
| `foi/wdtk-1141667--issued-callsigns` | `foi/ofcom-2023-01-25--call-sign-list-with-status--all-callsigns` | `record-last-modified` | 322 | 0 | 0 | 3 | 55,197 | 0 | 50,420 | 834 | differs-by-local-offset (timed side = UTC) |
| `foi/wdtk-1141667--issued-callsigns` | `foi/ofcom-2023-08-18--call-sign-list--all-callsigns` | `record-last-modified` | 434 | 0 | 3 | 3 | 55,425 | 0 | 51,160 | 835 | differs-by-local-offset (timed side = UTC) |
| `foi/wdtk-1141667--issued-callsigns` | `foi/ofcom-2023-11-24--call-sign-list--all-callsigns` | `record-last-modified` | 485 | 0 | 0 | 3 | 55,530 | 0 | 51,480 | 836 | differs-by-local-offset (timed side = UTC) |
| `foi/wdtk-1141667--issued-callsigns` | `foi/ofcom-2023-12-07--open-data-call-sign-list--all-callsigns` | `record-last-modified` | 485 | 0 | 0 | 3 | 55,553 | 0 | 51,527 | 836 | differs-by-local-offset (timed side = UTC) |
| `foi/wdtk-1141667--issued-callsigns` | `foi/ofcom-2024-01--foi-1734722--all-callsigns` | `record-last-modified` | 485 | 0 | 0 | 3 | 55,577 | 0 | 51,584 | 835 | differs-by-local-offset (timed side = UTC) |
| `foi/wdtk-1141667--issued-callsigns` | `foi/ofcom-2024-07--call-signs--all-callsigns` | `record-last-modified` | 629 | 0 | 1 | 9 | 92,292 | 4 | 15,976 | 838 | differs-by-local-offset (timed side = UTC) |
| `foi/wdtk-1141667--issued-callsigns` | `foi/ofcom-2024-10-21--callsigns--all-callsigns` | `record-last-modified` | 0 | 0 | 693 | 13 | 59,841 | 0 | 48,633 | 839 | same-convention |
| `foi/wdtk-1141667--issued-callsigns` | `foi/ofcom-2025-03-13--callsigns--all-callsigns` | `record-last-modified` | 0 | 0 | 680 | 11 | 57,919 | 0 | 50,574 | 839 | same-convention |
| `foi/wdtk-1141667--issued-callsigns` | `opendata/2023-02-20` | `record-last-modified` | 323 | 0 | 0 | 3 | 55,205 | 0 | 50,423 | 835 | differs-by-local-offset (timed side = UTC) |
| `foi/wdtk-1141667--issued-callsigns` | `opendata/2025-04-08` | `record-last-modified` | 0 | 0 | 677 | 11 | 57,526 | 0 | 50,970 | 839 | same-convention |
| `foi/wdtk-1141667--issued-callsigns` | `opendata/2025-05-27` | `record-last-modified` | 0 | 0 | 17 | 0 | 824 | 0 | 132 | 0 | agreement-only-h23 |
| `foi/wdtk-1141667--issued-callsigns` | `opendata/2025-06-04` | `record-last-modified` | 0 | 0 | 672 | 11 | 56,782 | 0 | 51,722 | 839 | same-convention |
| `foi/wdtk-1141667--issued-callsigns` | `opendata/2025-06-08` | `record-last-modified` | 0 | 0 | 17 | 0 | 824 | 0 | 132 | 0 | agreement-only-h23 |
| `foi/wdtk-596532--allocated-reserved-forbidden` | `foi/ofcom-756622--published-register-csv` | `licence-issued` | 0 | 0 | 223 | 0 | 0 | 0 | 0 | 5 | agreement-only-h23 |
| `opendata/2025-05-27` | `foi/ofcom-2020-10-23--reserved-callsigns` | `record-created` | 0 | 0 | 0 | 0 | 11 | 0 | 0 | 0 | no-boundary-signal |
| `opendata/2025-05-27` | `foi/ofcom-2020-10-23--reserved-callsigns` | `record-last-modified` | 2 | 0 | 0 | 0 | 2 | 0 | 5 | 0 | insufficient-evidence |
| `opendata/2025-05-27` | `foi/ofcom-2023-01-25--call-sign-list-with-status--all-callsigns` | `record-last-modified` | 5 | 0 | 0 | 0 | 7 | 0 | 956 | 3 | differs-by-local-offset (timed side = UTC) |
| `opendata/2025-05-27` | `foi/ofcom-2023-08-18--call-sign-list--all-callsigns` | `record-last-modified` | 8 | 0 | 0 | 0 | 9 | 0 | 951 | 3 | differs-by-local-offset (timed side = UTC) |
| `opendata/2025-05-27` | `foi/ofcom-2023-11-24--call-sign-list--all-callsigns` | `record-last-modified` | 9 | 0 | 0 | 0 | 10 | 0 | 949 | 3 | differs-by-local-offset (timed side = UTC) |
| `opendata/2025-05-27` | `foi/ofcom-2023-12-07--open-data-call-sign-list--all-callsigns` | `record-last-modified` | 9 | 0 | 0 | 0 | 10 | 0 | 948 | 3 | differs-by-local-offset (timed side = UTC) |
| `opendata/2025-05-27` | `foi/ofcom-2024-01--foi-1734722--all-callsigns` | `record-last-modified` | 9 | 0 | 0 | 0 | 10 | 0 | 948 | 3 | differs-by-local-offset (timed side = UTC) |
| `opendata/2025-05-27` | `foi/ofcom-2024-07--call-signs--all-callsigns` | `record-last-modified` | 15 | 0 | 0 | 0 | 675 | 0 | 278 | 3 | differs-by-local-offset (timed side = UTC) |
| `opendata/2025-05-27` | `foi/ofcom-2024-09--every-radio-callsign--all-callsigns` | `record-created` | 0 | 0 | 4 | 1 | 976 | 0 | 0 | 0 | insufficient-evidence |
| `opendata/2025-05-27` | `foi/ofcom-2024-10-21--callsigns--all-callsigns` | `record-last-modified` | 0 | 0 | 19 | 1 | 854 | 0 | 94 | 3 | agreement-only-h23 |
| `opendata/2025-05-27` | `foi/ofcom-2025-03-13--callsigns--all-callsigns` | `record-created` | 0 | 0 | 4 | 1 | 976 | 0 | 0 | 0 | insufficient-evidence |
| `opendata/2025-05-27` | `foi/ofcom-2025-03-13--callsigns--all-callsigns` | `record-last-modified` | 0 | 0 | 19 | 1 | 904 | 0 | 44 | 3 | agreement-only-h23 |
| `opendata/2025-05-27` | `foi/wdtk-1141667--issued-callsigns` | `record-last-modified` | 0 | 0 | 17 | 0 | 824 | 0 | 127 | 3 | agreement-only-h23 |
| `opendata/2025-05-27` | `opendata/2023-02-20` | `record-last-modified` | 5 | 0 | 0 | 0 | 7 | 0 | 956 | 3 | differs-by-local-offset (timed side = UTC) |
| `opendata/2025-05-27` | `opendata/2025-04-08` | `record-created` | 0 | 0 | 4 | 1 | 976 | 0 | 0 | 0 | insufficient-evidence |
| `opendata/2025-05-27` | `opendata/2025-04-08` | `record-last-modified` | 0 | 0 | 19 | 1 | 923 | 0 | 25 | 3 | agreement-only-h23 |
| `opendata/2025-05-27` | `opendata/2025-06-04` | `record-created` | 0 | 0 | 4 | 1 | 1,069 | 0 | 0 | 0 | insufficient-evidence |
| `opendata/2025-05-27` | `opendata/2025-06-04` | `record-last-modified` | 0 | 0 | 20 | 1 | 1,032 | 1 | 7 | 3 | agreement-only-h23 |
| `opendata/2025-05-27` | `opendata/2025-06-08` | `record-created` | 0 | 0 | 4 | 1 | 1,069 | 0 | 0 | 0 | insufficient-evidence |
| `opendata/2025-05-27` | `opendata/2025-06-08` | `record-last-modified` | 0 | 0 | 20 | 1 | 1,040 | 0 | 0 | 3 | agreement-only-h23 |
| `opendata/2025-06-04` | `foi/ofcom-2020-10-23--reserved-callsigns` | `record-created` | 2 | 0 | 0 | 1 | 7,608 | 0 | 2 | 3 | insufficient-evidence |
| `opendata/2025-06-04` | `foi/ofcom-2020-10-23--reserved-callsigns` | `record-last-modified` | 197 | 0 | 0 | 0 | 6,748 | 0 | 517 | 34 | differs-by-local-offset (timed side = UTC) |
| `opendata/2025-06-04` | `foi/ofcom-2023-01-25--call-sign-list-with-status--all-callsigns` | `record-last-modified` | 291 | 0 | 0 | 0 | 8,258 | 0 | 97,363 | 831 | differs-by-local-offset (timed side = UTC) |
| `opendata/2025-06-04` | `foi/ofcom-2023-08-18--call-sign-list--all-callsigns` | `record-last-modified` | 398 | 0 | 3 | 0 | 8,385 | 0 | 98,208 | 834 | differs-by-local-offset (timed side = UTC) |
| `opendata/2025-06-04` | `foi/ofcom-2023-11-24--call-sign-list--all-callsigns` | `record-last-modified` | 447 | 0 | 0 | 0 | 8,455 | 0 | 98,564 | 835 | differs-by-local-offset (timed side = UTC) |
| `opendata/2025-06-04` | `foi/ofcom-2023-12-07--open-data-call-sign-list--all-callsigns` | `record-last-modified` | 447 | 0 | 0 | 0 | 8,465 | 0 | 98,624 | 835 | differs-by-local-offset (timed side = UTC) |
| `opendata/2025-06-04` | `foi/ofcom-2024-01--foi-1734722--all-callsigns` | `record-last-modified` | 447 | 0 | 0 | 0 | 8,478 | 0 | 98,692 | 834 | differs-by-local-offset (timed side = UTC) |
| `opendata/2025-06-04` | `foi/ofcom-2024-07--call-signs--all-callsigns` | `record-last-modified` | 584 | 0 | 1 | 5 | 42,299 | 4 | 65,978 | 843 | differs-by-local-offset (timed side = UTC) |
| `opendata/2025-06-04` | `foi/ofcom-2024-09--every-radio-callsign--all-callsigns` | `record-created` | 0 | 0 | 98 | 21 | 110,617 | 0 | 0 | 233 | same-convention |
| `opendata/2025-06-04` | `foi/ofcom-2024-10-21--callsigns--all-callsigns` | `record-last-modified` | 0 | 0 | 761 | 22 | 105,122 | 1 | 3,828 | 850 | same-convention |
| `opendata/2025-06-04` | `foi/ofcom-2025-03-13--callsigns--all-callsigns` | `record-created` | 0 | 0 | 100 | 21 | 111,698 | 0 | 0 | 245 | same-convention |
| `opendata/2025-06-04` | `foi/ofcom-2025-03-13--callsigns--all-callsigns` | `record-last-modified` | 0 | 0 | 768 | 22 | 108,258 | 0 | 1,521 | 865 | same-convention |
| `opendata/2025-06-04` | `foi/wdtk-1141667--issued-callsigns` | `record-last-modified` | 0 | 0 | 673 | 11 | 56,781 | 0 | 51,681 | 844 | same-convention |
| `opendata/2025-06-04` | `opendata/2023-02-20` | `record-last-modified` | 292 | 0 | 0 | 0 | 8,259 | 0 | 97,373 | 832 | differs-by-local-offset (timed side = UTC) |
| `opendata/2025-06-04` | `opendata/2025-04-08` | `record-created` | 0 | 0 | 100 | 21 | 111,876 | 0 | 0 | 254 | same-convention |
| `opendata/2025-06-04` | `opendata/2025-04-08` | `record-last-modified` | 0 | 0 | 777 | 22 | 108,883 | 2 | 1,060 | 876 | same-convention |
| `opendata/2025-06-04` | `opendata/2025-05-27` | `record-created` | 0 | 0 | 4 | 1 | 1,069 | 0 | 0 | 0 | insufficient-evidence |
| `opendata/2025-06-04` | `opendata/2025-05-27` | `record-last-modified` | 0 | 0 | 20 | 1 | 1,032 | 1 | 7 | 3 | agreement-only-h23 |
| `opendata/2025-06-04` | `opendata/2025-06-08` | `record-created` | 0 | 0 | 4 | 1 | 1,069 | 0 | 0 | 0 | insufficient-evidence |
| `opendata/2025-06-04` | `opendata/2025-06-08` | `record-last-modified` | 0 | 0 | 20 | 1 | 1,032 | 1 | 7 | 3 | agreement-only-h23 |
| `opendata/2025-06-08` | `foi/ofcom-2020-10-23--reserved-callsigns` | `record-created` | 0 | 0 | 0 | 0 | 11 | 0 | 0 | 0 | no-boundary-signal |
| `opendata/2025-06-08` | `foi/ofcom-2020-10-23--reserved-callsigns` | `record-last-modified` | 2 | 0 | 0 | 0 | 2 | 0 | 5 | 0 | insufficient-evidence |
| `opendata/2025-06-08` | `foi/ofcom-2023-01-25--call-sign-list-with-status--all-callsigns` | `record-last-modified` | 5 | 0 | 0 | 0 | 7 | 0 | 956 | 3 | differs-by-local-offset (timed side = UTC) |
| `opendata/2025-06-08` | `foi/ofcom-2023-08-18--call-sign-list--all-callsigns` | `record-last-modified` | 8 | 0 | 0 | 0 | 9 | 0 | 951 | 3 | differs-by-local-offset (timed side = UTC) |
| `opendata/2025-06-08` | `foi/ofcom-2023-11-24--call-sign-list--all-callsigns` | `record-last-modified` | 9 | 0 | 0 | 0 | 10 | 0 | 949 | 3 | differs-by-local-offset (timed side = UTC) |
| `opendata/2025-06-08` | `foi/ofcom-2023-12-07--open-data-call-sign-list--all-callsigns` | `record-last-modified` | 9 | 0 | 0 | 0 | 10 | 0 | 948 | 3 | differs-by-local-offset (timed side = UTC) |
| `opendata/2025-06-08` | `foi/ofcom-2024-01--foi-1734722--all-callsigns` | `record-last-modified` | 9 | 0 | 0 | 0 | 10 | 0 | 948 | 3 | differs-by-local-offset (timed side = UTC) |
| `opendata/2025-06-08` | `foi/ofcom-2024-07--call-signs--all-callsigns` | `record-last-modified` | 15 | 0 | 0 | 0 | 675 | 0 | 278 | 3 | differs-by-local-offset (timed side = UTC) |
| `opendata/2025-06-08` | `foi/ofcom-2024-09--every-radio-callsign--all-callsigns` | `record-created` | 0 | 0 | 4 | 1 | 976 | 0 | 0 | 0 | insufficient-evidence |
| `opendata/2025-06-08` | `foi/ofcom-2024-10-21--callsigns--all-callsigns` | `record-last-modified` | 0 | 0 | 19 | 1 | 854 | 0 | 94 | 3 | agreement-only-h23 |
| `opendata/2025-06-08` | `foi/ofcom-2025-03-13--callsigns--all-callsigns` | `record-created` | 0 | 0 | 4 | 1 | 976 | 0 | 0 | 0 | insufficient-evidence |
| `opendata/2025-06-08` | `foi/ofcom-2025-03-13--callsigns--all-callsigns` | `record-last-modified` | 0 | 0 | 19 | 1 | 904 | 0 | 44 | 3 | agreement-only-h23 |
| `opendata/2025-06-08` | `foi/wdtk-1141667--issued-callsigns` | `record-last-modified` | 0 | 0 | 17 | 0 | 824 | 0 | 127 | 3 | agreement-only-h23 |
| `opendata/2025-06-08` | `opendata/2023-02-20` | `record-last-modified` | 5 | 0 | 0 | 0 | 7 | 0 | 956 | 3 | differs-by-local-offset (timed side = UTC) |
| `opendata/2025-06-08` | `opendata/2025-04-08` | `record-created` | 0 | 0 | 4 | 1 | 976 | 0 | 0 | 0 | insufficient-evidence |
| `opendata/2025-06-08` | `opendata/2025-04-08` | `record-last-modified` | 0 | 0 | 19 | 1 | 923 | 0 | 25 | 3 | agreement-only-h23 |
| `opendata/2025-06-08` | `opendata/2025-05-27` | `record-created` | 0 | 0 | 4 | 1 | 1,069 | 0 | 0 | 0 | insufficient-evidence |
| `opendata/2025-06-08` | `opendata/2025-05-27` | `record-last-modified` | 0 | 0 | 20 | 1 | 1,040 | 0 | 0 | 3 | agreement-only-h23 |
| `opendata/2025-06-08` | `opendata/2025-06-04` | `record-created` | 0 | 0 | 4 | 1 | 1,069 | 0 | 0 | 0 | insufficient-evidence |
| `opendata/2025-06-08` | `opendata/2025-06-04` | `record-last-modified` | 0 | 0 | 20 | 1 | 1,032 | 1 | 7 | 3 | agreement-only-h23 |

Verdict vocabulary:

- **differs-by-local-offset** — the boundary experiment fired: the two renderings differ by the local offset, oriented under the two-candidate convention set
- **same-convention** — summer stamps in BOTH midnight-offset windows agree on the day — both orientations excluded, the two sides render under one convention (an equality edge; which convention comes from elsewhere in the chain)
- **agreement-only-h23** — only the hour-23 window has coverage and it agrees — excludes (timed=UTC ∧ partner=local) but leaves the reverse orientation untested; a partial constraint, classifying nothing alone
- **agreement-only-h0** — only the non-midnight hour-0 window has coverage and it agrees — excludes (timed=local ∧ partner=UTC) but leaves the reverse orientation untested; a partial constraint, classifying nothing alone
- **no-boundary-signal** — comparable overlap exists but carries no summer boundary-window stamps (winter-only overlap, or mid-day stamps only) — honestly undeterminable: GMT = UTC in winter, so agreement here is NOT evidence of same convention
- **insufficient-evidence** — boundary-window cells exist but below the evidence floor — not classified on a handful of rows
- **conflicting-evidence** — the cells contradict each other beyond the noise tolerance — a loud finding to examine (a re-stamping pipeline, or genuine consecutive-day revisions), never an average

## Minute-level corroboration (both sides timed)

Where BOTH sides render time-of-day, the exact minute difference between
the two rendered instants for shared single-valued subjects (bounded to
±3 hours). Same convention ⇒ 0; UTC-vs-BST ⇒ ±60 for summer instants.
Corroborates the day-boundary verdicts above; decided by neither alone.

| source 1 | source 2 | kind | season | Δ minutes | subjects |
|---|---|---|---|---|---:|
| `foi/ofcom-2024-09--every-radio-callsign--all-callsigns` | `opendata/2025-05-27` | `record-created` | summer | 0 | 701 |
| `foi/ofcom-2024-09--every-radio-callsign--all-callsigns` | `opendata/2025-05-27` | `record-created` | winter | 0 | 280 |
| `foi/ofcom-2024-09--every-radio-callsign--all-callsigns` | `opendata/2025-06-04` | `record-created` | margin | 0 | 233 |
| `foi/ofcom-2024-09--every-radio-callsign--all-callsigns` | `opendata/2025-06-04` | `record-created` | summer | 0 | 102,330 |
| `foi/ofcom-2024-09--every-radio-callsign--all-callsigns` | `opendata/2025-06-04` | `record-created` | winter | 0 | 8,406 |
| `foi/ofcom-2024-09--every-radio-callsign--all-callsigns` | `opendata/2025-06-08` | `record-created` | summer | 0 | 701 |
| `foi/ofcom-2024-09--every-radio-callsign--all-callsigns` | `opendata/2025-06-08` | `record-created` | winter | 0 | 280 |
| `foi/wdtk-1141667--issued-callsigns` | `opendata/2025-05-27` | `record-last-modified` | summer | 0 | 824 |
| `foi/wdtk-1141667--issued-callsigns` | `opendata/2025-05-27` | `record-last-modified` | winter | 0 | 17 |
| `foi/wdtk-1141667--issued-callsigns` | `opendata/2025-06-04` | `record-last-modified` | margin | 0 | 775 |
| `foi/wdtk-1141667--issued-callsigns` | `opendata/2025-06-04` | `record-last-modified` | summer | 0 | 47,205 |
| `foi/wdtk-1141667--issued-callsigns` | `opendata/2025-06-04` | `record-last-modified` | winter | 0 | 10,259 |
| `foi/wdtk-1141667--issued-callsigns` | `opendata/2025-06-08` | `record-last-modified` | summer | 0 | 824 |
| `foi/wdtk-1141667--issued-callsigns` | `opendata/2025-06-08` | `record-last-modified` | winter | 0 | 17 |
| `opendata/2025-05-27` | `opendata/2025-06-04` | `record-created` | summer | 0 | 794 |
| `opendata/2025-05-27` | `opendata/2025-06-04` | `record-created` | winter | 0 | 280 |
| `opendata/2025-05-27` | `opendata/2025-06-04` | `record-last-modified` | margin | 0 | 3 |
| `opendata/2025-05-27` | `opendata/2025-06-04` | `record-last-modified` | summer | 0 | 972 |
| `opendata/2025-05-27` | `opendata/2025-06-04` | `record-last-modified` | winter | 0 | 81 |
| `opendata/2025-05-27` | `opendata/2025-06-08` | `record-created` | summer | 0 | 794 |
| `opendata/2025-05-27` | `opendata/2025-06-08` | `record-created` | winter | 0 | 280 |
| `opendata/2025-05-27` | `opendata/2025-06-08` | `record-last-modified` | margin | 0 | 3 |
| `opendata/2025-05-27` | `opendata/2025-06-08` | `record-last-modified` | summer | 0 | 979 |
| `opendata/2025-05-27` | `opendata/2025-06-08` | `record-last-modified` | winter | 0 | 82 |
| `opendata/2025-06-04` | `opendata/2025-06-08` | `record-created` | summer | 0 | 794 |
| `opendata/2025-06-04` | `opendata/2025-06-08` | `record-created` | winter | 0 | 280 |
| `opendata/2025-06-04` | `opendata/2025-06-08` | `record-last-modified` | margin | 0 | 3 |
| `opendata/2025-06-04` | `opendata/2025-06-08` | `record-last-modified` | summer | 0 | 972 |
| `opendata/2025-06-04` | `opendata/2025-06-08` | `record-last-modified` | winter | 0 | 81 |

## Time-of-day evidence base and batch-signature fingerprints

Per (source, kind): the subjects asserting the kind, the single-valued
timed subjects anchoring experiments (a column whose every time reads
00:00 carries a time FORMAT but no clock information and anchors
nothing), the summer midnight-offset-window stamps, and the modal hour.
Under the documented local-midnight-batch prior (issue #857: bulk
register jobs completing within minutes of local midnight), a summer
23:xx cluster CORROBORATES a UTC rendering and a 00:xx cluster a local
one — corroborating evidence only, never sole: fingerprints classify
nothing without a pairwise experiment.

| source | kind | vintage | subjects | multi-valued (excluded) | timed | summer 23:xx | summer 00:xx | modal hour |
|---|---|---|---:|---:|---:|---:|---:|---|
| `foi/ofcom-2020-10-23--reserved-callsigns` | `licence-cancelled` | 2020-10-23 | 7,397 | 0 | 0 | 0 | 0 | — |
| `foi/ofcom-2020-10-23--reserved-callsigns` | `record-created` | 2020-10-23 | 50,523 | 0 | 0 | 0 | 0 | — |
| `foi/ofcom-2020-10-23--reserved-callsigns` | `record-last-modified` | 2020-10-23 | 50,523 | 0 | 0 | 0 | 0 | — |
| `foi/ofcom-2020-10-23--reserved-callsigns` | `reserved-until` | 2020-10-23 | 93 | 0 | 0 | 0 | 0 | — |
| `foi/ofcom-2021-01--all-callsigns` | `licence-version-original-start` | 2021-01-29 | 96,161 | 0 | 0 | 0 | 0 | — |
| `foi/ofcom-2021-01--all-callsigns` | `reserved-until` | 2021-01-29 | 112 | 0 | 0 | 0 | 0 | — |
| `foi/ofcom-2021-04--all-callsigns` | `licence-version-original-start` | 2021-04-21 | 96,869 | 0 | 0 | 0 | 0 | — |
| `foi/ofcom-2021-04--all-callsigns` | `reserved-until` | 2021-04-21 | 123 | 0 | 0 | 0 | 0 | — |
| `foi/ofcom-2023-01-25--call-sign-list-with-status--all-callsigns` | `record-last-modified` | 2023-01-25 | 152,075 | 5 | 0 | 0 | 0 | — |
| `foi/ofcom-2023-08-18--call-sign-list--all-callsigns` | `record-last-modified` | 2023-08-18 | 153,242 | 4 | 0 | 0 | 0 | — |
| `foi/ofcom-2023-11-24--call-sign-list--all-callsigns` | `record-last-modified` | 2023-11-24 | 108,919 | 2 | 0 | 0 | 0 | — |
| `foi/ofcom-2023-12-07--open-data-call-sign-list--all-callsigns` | `record-last-modified` | 2023-12-07 | 108,989 | 2 | 0 | 0 | 0 | — |
| `foi/ofcom-2024-01--foi-1734722--all-callsigns` | `record-last-modified` | 2024-01 | 153,932 | 4 | 0 | 0 | 0 | — |
| `foi/ofcom-2024-07--call-signs--all-callsigns` | `record-last-modified` | 2024-07 | 155,342 | 3 | 0 | 0 | 0 | — |
| `foi/ofcom-2024-09--every-radio-callsign--all-callsigns` | `record-created` | 2024-09 | 159,988 | 8 | 159,976 | 126 | 33 | 16:xx (91,286) |
| `foi/ofcom-2024-09--every-radio-callsign--all-callsigns` | `reserved-until` | 2024-09 | 4,317 | 2 | 0 | 0 | 0 | — |
| `foi/ofcom-2024-10-21--callsigns--all-callsigns` | `record-last-modified` | 2024-10-21 | 156,275 | 3 | 0 | 0 | 0 | — |
| `foi/ofcom-2025-03-13--callsigns--all-callsigns` | `record-created` | 2025-03-13 | 157,220 | 7 | 0 | 0 | 0 | — |
| `foi/ofcom-2025-03-13--callsigns--all-callsigns` | `record-last-modified` | 2025-03-13 | 157,220 | 6 | 0 | 0 | 0 | — |
| `foi/ofcom-2025-09-11--callsigns--all-callsigns` | `licence-last-modified` | 2025-09-11 | 105,518 | 0 | 0 | 0 | 0 | — |
| `foi/ofcom-2025-09-11--callsigns--all-callsigns` | `licence-original-start` | 2025-09-11 | 105,518 | 0 | 0 | 0 | 0 | — |
| `foi/ofcom-756622--published-register-csv` | `licence-issued` | 2019-09-12 | 103,901 | 1 | 0 | 0 | 0 | — |
| `foi/wdtk-1141667--issued-callsigns` | `record-last-modified` | 2024-07-22 | 110,619 | 2 | 110,027 | 725 | 16 | 16:xx (30,899) |
| `foi/wdtk-1180568--licence-breakdown-duration-age` | `licence-created` | 2024-10 | 103,504 | 59 | 103,328 | 72 | 23 | 03:xx (32,943) |
| `foi/wdtk-1180568--licence-breakdown-duration-age` | `licence-original-start` | 2024-10 | 103,504 | 81 | 0 | 0 | 0 | — |
| `foi/wdtk-1180568--licence-breakdown-duration-age` | `reserved-until` | 2024-10 | 610 | 0 | 0 | 0 | 0 | — |
| `foi/wdtk-596532--allocated-reserved-forbidden` | `licence-issued` | 2019-08-12 | 103,901 | 1 | 228 | 223 | 0 | 23:xx (228) |
| `opendata/2023-02-20` | `record-last-modified` | 2023-02-20 | 152,075 | 5 | 0 | 0 | 0 | — |
| `opendata/2025-04-08` | `record-created` | 2025-04-08 | 157,420 | 7 | 0 | 0 | 0 | — |
| `opendata/2025-04-08` | `record-last-modified` | 2025-04-08 | 157,420 | 6 | 0 | 0 | 0 | — |
| `opendata/2025-05-27` | `record-created` | 2025-05-27 | 1,074 | 0 | 1,074 | 4 | 1 | 11:xx (98) |
| `opendata/2025-05-27` | `record-last-modified` | 2025-05-27 | 1,074 | 0 | 1,064 | 20 | 1 | 18:xx (353) |
| `opendata/2025-06-04` | `record-created` | 2025-06-04 | 112,645 | 4 | 112,638 | 104 | 21 | 16:xx (91,194) |
| `opendata/2025-06-04` | `record-last-modified` | 2025-06-04 | 112,645 | 3 | 112,005 | 818 | 25 | 03:xx (31,094) |
| `opendata/2025-06-08` | `record-created` | 2025-06-08 | 1,074 | 0 | 1,074 | 4 | 1 | 11:xx (98) |
| `opendata/2025-06-08` | `record-last-modified` | 2025-06-08 | 1,074 | 0 | 1,064 | 20 | 1 | 18:xx (353) |
| `opendata/2025-11-11` | `licence-version-last-modified` | 2025-11-11 | 105,499 | 12 | 0 | 0 | 0 | — |
| `opendata/2025-11-11` | `licence-version-original-start` | 2025-11-11 | 105,499 | 80 | 0 | 0 | 0 | — |
| `opendata/2026-01-14` | `licence-version-last-modified` | 2026-01-14 | 95,957 | 12 | 0 | 0 | 0 | — |
| `opendata/2026-01-14` | `licence-version-original-start` | 2026-01-14 | 95,957 | 73 | 0 | 0 | 0 | — |
| `opendata/2026-06-23` | `licence-version-last-modified` | 2026-06-23 | 105,332 | 0 | 0 | 0 | 0 | — |
| `opendata/2026-06-23` | `licence-version-original-start` | 2026-06-23 | 105,332 | 0 | 0 | 0 | 0 | — |
