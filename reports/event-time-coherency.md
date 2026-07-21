# Event-time coherency (cross-vintage)

The retroactive-revision detector (issue #725, S2): multiple vintages
asserting the same (subject, event-kind) fact about the past should agree
on the date; a later vintage contradicting an earlier one is flagged as a
retroactive revision, and agreement is recorded as corroboration.
Subjects join on the `cleaned` callsign key (a join key, not an
identity). Regenerated and committed, so a new vintage shifting this
picture shows up as a PR diff. **Flags, never verdicts** (issue #467):
every classification carries candidate explanations and adjudicates
none; corroboration is repetition, not proof.

Vocabulary (each term below is used only with these meanings):

- **corroborated** — this vintage repeats the previous vintage’s date — corroboration, not proof (vintages can share one upstream defect)
- **expected-progression** — a bookkeeping date moved forward outside any detected episode — the column doing its stated job, not a revision
- **episode-member** — a bookkeeping date moved forward into a detected mass-update episode — evidence of one system episode, not an individual per-record event
- **revised-forward** — a later vintage asserts a LATER date for a past event than an earlier vintage did — a retroactive revision; candidate explanations include a retention-window drop, a reissue/variation, an upstream correction, or an export artefact
- **revised-backward** — a later vintage asserts an EARLIER date than an earlier vintage did — issue #800 found event-time creep forward-only, so this direction is a finding in its own right; candidate explanations include a republished stale extract or an upstream correction
- **window-restated** — a forward-looking window end changed — renewal/termination bookkeeping is routine for this kind, recorded but not read as a revision of a past event
- **version-window-drop** (mechanism) — the earlier vintage held multiple dated rows for this subject, so a rolling retention window dropping the older rows can explain the movement (issue #800 mechanism A) — candidate, not adjudicated
- **version-window-extension** (mechanism) — the later vintage carries an older dated row the earlier export did not, while the earlier assertion survives among its rows — a wider retention window rather than a replacement; candidate, not adjudicated
- **sole-row-replacement** (mechanism) — the earlier vintage held a single dated row whose value was replaced wholesale (issue #800 mechanism B, the reissue shape) — candidate, not adjudicated

## Mass-update episodes

The deliberately naive v1 spike rule (issue #725): flag any window of at
most 21 days holding more than 50.0% of a dataset’s
populated dates for one event kind; overlapping windows across datasets
and kinds merge into one episode. A dataset needs at least 1,000
populated dates for a kind to count as episode evidence — a majority of a
sparse column is a handful of rows, not a mass touch. Window and
threshold are tuning parameters — a spread-out episode (the recorded 2024 rolling
reprocessing spans ~14 weeks with no single-day spike) is invisible at
this window by design and is NOT disproved by its absence here. An
episode fingerprint also erodes: later vintages overwrite the clustered
dates, so a later vintage’s missing spike never disproves an earlier
vintage’s episode.

### Episode 1: 2016-07-23 → 2016-08-12

Witnessed by (one row per dataset × event kind whose dates cluster in this window):

| event kind | lane | dataset | vintage | clustered span | rows in span | populated | share | peak days |
|---|---|---|---|---|---:|---:|---:|---|
| `record-created` | foi | `ofcom-2020-10-23--reserved-callsigns` | 2020-10-23 | 2016-07-23 → 2016-08-12 | 50,067 | 50,523 | 99.1% | 2016-07-23 (14.3%), 2016-08-02 (11.3%), 2016-08-12 (73.4%) |
| `record-created` | foi | `ofcom-2024-09--every-radio-callsign--all-callsigns` | 2024-09 | 2016-07-23 → 2016-08-12 | 135,038 | 159,996 | 84.4% | 2016-07-23 (56.9%), 2016-08-12 (23.7%) |
| `record-created` | foi | `ofcom-2025-03-13--callsigns--all-callsigns` | 2025-03-13 | 2016-07-23 → 2016-08-12 | 133,654 | 157,227 | 85.0% | 2016-07-23 (57.0%), 2016-08-12 (24.1%) |
| `record-created` | opendata | `2025-04-08` | 2025-04-08 | 2016-07-23 → 2016-08-12 | 133,659 | 157,427 | 84.9% | 2016-07-23 (57.0%), 2016-08-12 (24.1%) |
| `record-created` | opendata | `2025-06-04` | 2025-06-04 | 2016-07-23 → 2016-07-23 | 89,689 | 112,649 | 79.6% | 2016-07-23 (79.6%) |
| `record-last-modified` | foi | `ofcom-2020-10-23--reserved-callsigns` | 2020-10-23 | 2016-07-23 → 2016-08-12 | 47,750 | 50,523 | 94.5% | 2016-07-23 (6.1%), 2016-08-02 (7.1%), 2016-08-12 (80.8%) |
| `record-last-modified` | foi | `ofcom-2023-01-25--call-sign-list-with-status--all-callsigns` | 2023-01-25 | 2016-07-23 → 2016-08-12 | 99,926 | 152,081 | 65.7% | 2016-07-23 (21.7%), 2016-08-12 (37.5%) |
| `record-last-modified` | foi | `ofcom-2023-08-18--call-sign-list--all-callsigns` | 2023-08-18 | 2016-07-23 → 2016-08-12 | 98,681 | 153,248 | 64.4% | 2016-07-23 (21.1%), 2016-08-12 (36.9%) |
| `record-last-modified` | foi | `ofcom-2023-11-24--call-sign-list--all-callsigns` | 2023-11-24 | 2016-07-23 → 2016-08-12 | 56,408 | 108,922 | 51.8% | 2016-07-23 (29.3%), 2016-08-12 (16.6%) |
| `record-last-modified` | foi | `ofcom-2023-12-07--open-data-call-sign-list--all-callsigns` | 2023-12-07 | 2016-07-23 → 2016-08-12 | 56,326 | 108,992 | 51.7% | 2016-07-23 (29.2%), 2016-08-12 (16.5%) |
| `record-last-modified` | foi | `ofcom-2024-01--foi-1734722--all-callsigns` | 2024-01 | 2016-07-23 → 2016-08-12 | 97,751 | 153,938 | 63.5% | 2016-07-23 (20.6%), 2016-08-12 (36.6%) |
| `record-last-modified` | foi | `ofcom-2024-07--call-signs--all-callsigns` | 2024-07 | 2016-07-23 → 2016-08-12 | 92,857 | 155,346 | 59.8% | 2016-07-23 (18.6%), 2016-08-12 (35.3%) |
| `record-last-modified` | opendata | `2023-02-20` | 2023-02-20 | 2016-07-23 → 2016-08-12 | 99,926 | 152,081 | 65.7% | 2016-07-23 (21.7%), 2016-08-12 (37.5%) |

### Episode 2: 2025-10-11 → 2025-10-30

Witnessed by (one row per dataset × event kind whose dates cluster in this window):

| event kind | lane | dataset | vintage | clustered span | rows in span | populated | share | peak days |
|---|---|---|---|---|---:|---:|---:|---|
| `licence-version-last-modified` | opendata | `2025-11-11` | 2025-11-11 | 2025-10-11 → 2025-10-30 | 104,221 | 105,716 | 98.6% | 2025-10-11 (82.2%), 2025-10-30 (11.1%) |
| `licence-version-last-modified` | opendata | `2026-01-14` | 2026-01-14 | 2025-10-11 → 2025-10-30 | 89,792 | 96,155 | 93.4% | 2025-10-11 (78.3%), 2025-10-30 (10.9%) |
| `licence-version-last-modified` | opendata | `2026-06-23` | 2026-06-23 | 2025-10-11 → 2025-10-30 | 90,189 | 105,332 | 85.6% | 2025-10-11 (72.5%), 2025-10-30 (10.5%) |

## Cross-vintage classification totals

Each consecutive pair of observations of the same (subject, event kind),
classified. A subject’s first observation for a kind has nothing to
compare and is not counted; a vintage that does not carry a subject or a
kind is a non-observation, never "nothing happened".

| event kind | classification | subject-steps |
|---|---|---:|
| `licence-issued` | corroborated | 103,901 |
| `licence-version-last-modified` | corroborated | 185,309 |
| `licence-version-last-modified` | expected-progression | 13,362 |
| `licence-version-last-modified` | revised-backward | 5 |
| `licence-version-original-start` | corroborated | 595,173 |
| `licence-version-original-start` | revised-backward | 122 |
| `licence-version-original-start` | revised-forward | 580 |
| `record-created` | corroborated | 377,936 |
| `record-created` | revised-backward | 101,880 |
| `record-created` | revised-forward | 101,875 |
| `record-last-modified` | corroborated | 1,549,208 |
| `record-last-modified` | expected-progression | 126,236 |
| `record-last-modified` | revised-backward | 3,032 |
| `reserved-until` | corroborated | 879 |
| `reserved-until` | window-restated | 7 |

## Notable vintage pairs

Pairs of consecutive observations where at least 100 subjects
were classified as revised, episode-member or window-restated — where the
register’s story changed between two vintages. The full distribution
(every pair, every classification) is re-derivable from the fold
(src/ci/event-time-coherency.ts).

| event kind | from (vintage) | to (vintage) | classification | mechanism (candidate) | subjects |
|---|---|---|---|---|---:|
| `licence-version-original-start` | `ofcom-2021-04--all-callsigns` (2021-04-21) | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | revised-forward | sole-row-replacement | 325 |
| `record-created` | `ofcom-2024-09--every-radio-callsign--all-callsigns` (2024-09) | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | revised-forward | sole-row-replacement | 101,869 |
| `record-created` | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | `ofcom-2025-03-13--callsigns--all-callsigns` (2025-03-13) | revised-backward | sole-row-replacement | 101,668 |
| `record-created` | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | `ofcom-2025-03-13--callsigns--all-callsigns` (2025-03-13) | revised-backward | version-window-drop | 204 |
| `record-last-modified` | `ofcom-2024-07--call-signs--all-callsigns` (2024-07) | `wdtk-1141667--issued-callsigns` (2024-07-22) | revised-backward | sole-row-replacement | 632 |
| `record-last-modified` | `2025-06-04` (2025-06-04) | `ofcom-2025-09-11--callsigns--all-callsigns` (2025-09-11) | revised-backward | sole-row-replacement | 2,196 |

## Revision exemplars

Up to 10 per kind and direction, ordered by subject — the shape of the
working, not a ranking. Any subject’s full sequence is re-derivable with
`subjectKindSequence` (src/ci/event-time-coherency.ts). Mechanisms are
candidates (read off row multiplicity either side of the step), never
verdicts.

| event kind | subject | from (vintage) | asserted | rows | to (vintage) | now asserts | classification | mechanism (candidate) |
|---|---|---|---|---:|---|---|---|---|
| `licence-version-last-modified` | `G0RIV` | `2026-01-14` (2026-01-14) | 2026-01-06 | 2 | `2026-06-23` (2026-06-23) | 2025-10-11 | revised-backward | version-window-drop |
| `licence-version-last-modified` | `G1UOJ` | `2026-01-14` (2026-01-14) | 2025-10-30 | 2 | `2026-06-23` (2026-06-23) | 2025-10-11 | revised-backward | version-window-drop |
| `licence-version-last-modified` | `M6FZA` | `2025-11-11` (2025-11-11) | 2025-10-30 | 2 | `2026-06-23` (2026-06-23) | 2025-10-11 | revised-backward | version-window-drop |
| `licence-version-last-modified` | `M6GFG` | `2026-01-14` (2026-01-14) | 2025-10-16 | 2 | `2026-06-23` (2026-06-23) | 2025-10-11 | revised-backward | version-window-drop |
| `licence-version-last-modified` | `M7AAC` | `2026-01-14` (2026-01-14) | 2025-10-29 | 2 | `2026-06-23` (2026-06-23) | 2025-10-11 | revised-backward | version-window-drop |
| `licence-version-original-start` | `20CAM` | `ofcom-2025-09-11--callsigns--all-callsigns` (2025-09-11) | 2007-11-22 | 1 | `2025-11-11` (2025-11-11) | 2007-01-30 | revised-backward | version-window-extension |
| `licence-version-original-start` | `20TWA` | `ofcom-2021-04--all-callsigns` (2021-04-21) | 2015-05-06 | 1 | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2012-03-22 | revised-backward | version-window-extension |
| `licence-version-original-start` | `20TWA` | `ofcom-2025-09-11--callsigns--all-callsigns` (2025-09-11) | 2015-05-06 | 1 | `2025-11-11` (2025-11-11) | 2012-03-22 | revised-backward | version-window-extension |
| `licence-version-original-start` | `21DQG` | `ofcom-2025-09-11--callsigns--all-callsigns` (2025-09-11) | 2024-04-04 | 1 | `2025-11-11` (2025-11-11) | 2024-03-28 | revised-backward | version-window-extension |
| `licence-version-original-start` | `21GTD` | `ofcom-2025-09-11--callsigns--all-callsigns` (2025-09-11) | 2017-12-01 | 1 | `2025-11-11` (2025-11-11) | 1998-07-14 | revised-backward | version-window-extension |
| `licence-version-original-start` | `21GXW` | `ofcom-2025-09-11--callsigns--all-callsigns` (2025-09-11) | 2024-09-20 | 1 | `2025-11-11` (2025-11-11) | 2024-09-09 | revised-backward | version-window-extension |
| `licence-version-original-start` | `G0BSY` | `ofcom-2025-09-11--callsigns--all-callsigns` (2025-09-11) | 2024-05-08 | 1 | `2025-11-11` (2025-11-11) | 2024-05-07 | revised-backward | version-window-extension |
| `licence-version-original-start` | `G0JXF` | `ofcom-2025-09-11--callsigns--all-callsigns` (2025-09-11) | 2019-08-22 | 1 | `2025-11-11` (2025-11-11) | 1988-06-30 | revised-backward | version-window-extension |
| `licence-version-original-start` | `G0LOU` | `ofcom-2021-04--all-callsigns` (2021-04-21) | 2018-09-11 | 1 | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2018-09-10 | revised-backward | version-window-extension |
| `licence-version-original-start` | `G0LOU` | `ofcom-2025-09-11--callsigns--all-callsigns` (2025-09-11) | 2018-09-11 | 1 | `2025-11-11` (2025-11-11) | 2018-09-10 | revised-backward | version-window-extension |
| `licence-version-original-start` | `20BIQ` | `ofcom-2021-04--all-callsigns` (2021-04-21) | 2007-05-09 | 1 | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2023-05-12 | revised-forward | sole-row-replacement |
| `licence-version-original-start` | `20BUF` | `ofcom-2021-04--all-callsigns` (2021-04-21) | 2009-02-08 | 1 | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2023-10-26 | revised-forward | sole-row-replacement |
| `licence-version-original-start` | `20CAM` | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2007-01-30 | 2 | `ofcom-2025-09-11--callsigns--all-callsigns` (2025-09-11) | 2007-11-22 | revised-forward | version-window-drop |
| `licence-version-original-start` | `20CGT` | `ofcom-2021-01--all-callsigns` (2021-01-29) | 2011-06-03 | 1 | `ofcom-2021-04--all-callsigns` (2021-04-21) | 2021-03-05 | revised-forward | sole-row-replacement |
| `licence-version-original-start` | `20CIP` | `ofcom-2021-04--all-callsigns` (2021-04-21) | 2011-12-01 | 1 | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2022-10-12 | revised-forward | sole-row-replacement |
| `licence-version-original-start` | `20CMB` | `ofcom-2021-04--all-callsigns` (2021-04-21) | 2009-07-06 | 1 | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2023-07-31 | revised-forward | sole-row-replacement |
| `licence-version-original-start` | `20CPR` | `ofcom-2021-04--all-callsigns` (2021-04-21) | 2012-10-23 | 1 | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2023-06-20 | revised-forward | sole-row-replacement |
| `licence-version-original-start` | `20CUB` | `ofcom-2021-04--all-callsigns` (2021-04-21) | 2012-07-03 | 1 | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2023-05-09 | revised-forward | sole-row-replacement |
| `licence-version-original-start` | `20DGR` | `ofcom-2021-04--all-callsigns` (2021-04-21) | 2014-11-28 | 1 | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2024-03-07 | revised-forward | sole-row-replacement |
| `licence-version-original-start` | `20EAZ` | `ofcom-2021-04--all-callsigns` (2021-04-21) | 2012-11-22 | 1 | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2022-05-19 | revised-forward | sole-row-replacement |
| `record-created` | `20AAC` | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2024-07-11 | 1 | `ofcom-2025-03-13--callsigns--all-callsigns` (2025-03-13) | 2016-07-29 | revised-backward | sole-row-replacement |
| `record-created` | `20AAD` | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2024-03-19 | 1 | `ofcom-2025-03-13--callsigns--all-callsigns` (2025-03-13) | 2016-07-29 | revised-backward | sole-row-replacement |
| `record-created` | `20AAE` | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2024-04-12 | 1 | `ofcom-2025-03-13--callsigns--all-callsigns` (2025-03-13) | 2016-07-30 | revised-backward | sole-row-replacement |
| `record-created` | `20AAF` | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2024-03-11 | 1 | `ofcom-2025-03-13--callsigns--all-callsigns` (2025-03-13) | 2016-07-31 | revised-backward | sole-row-replacement |
| `record-created` | `20AAG` | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2024-06-15 | 1 | `ofcom-2025-03-13--callsigns--all-callsigns` (2025-03-13) | 2016-08-01 | revised-backward | sole-row-replacement |
| `record-created` | `20AAH` | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2024-04-17 | 1 | `ofcom-2025-03-13--callsigns--all-callsigns` (2025-03-13) | 2016-08-02 | revised-backward | sole-row-replacement |
| `record-created` | `20AAI` | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2024-03-12 | 1 | `ofcom-2025-03-13--callsigns--all-callsigns` (2025-03-13) | 2016-08-05 | revised-backward | sole-row-replacement |
| `record-created` | `20AAJ` | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2024-03-12 | 1 | `ofcom-2025-03-13--callsigns--all-callsigns` (2025-03-13) | 2016-08-05 | revised-backward | sole-row-replacement |
| `record-created` | `20AAK` | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2024-09-01 | 1 | `ofcom-2025-03-13--callsigns--all-callsigns` (2025-03-13) | 2016-07-23 | revised-backward | sole-row-replacement |
| `record-created` | `20AAL` | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2024-03-12 | 1 | `ofcom-2025-03-13--callsigns--all-callsigns` (2025-03-13) | 2016-08-05 | revised-backward | sole-row-replacement |
| `record-created` | `20AAC` | `ofcom-2024-09--every-radio-callsign--all-callsigns` (2024-09) | 2016-07-29 | 1 | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2024-07-11 | revised-forward | sole-row-replacement |
| `record-created` | `20AAD` | `ofcom-2024-09--every-radio-callsign--all-callsigns` (2024-09) | 2016-07-29 | 1 | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2024-03-19 | revised-forward | sole-row-replacement |
| `record-created` | `20AAE` | `ofcom-2024-09--every-radio-callsign--all-callsigns` (2024-09) | 2016-07-30 | 1 | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2024-04-12 | revised-forward | sole-row-replacement |
| `record-created` | `20AAF` | `ofcom-2024-09--every-radio-callsign--all-callsigns` (2024-09) | 2016-07-31 | 1 | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2024-03-11 | revised-forward | sole-row-replacement |
| `record-created` | `20AAG` | `ofcom-2024-09--every-radio-callsign--all-callsigns` (2024-09) | 2016-08-01 | 1 | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2024-06-15 | revised-forward | sole-row-replacement |
| `record-created` | `20AAH` | `ofcom-2024-09--every-radio-callsign--all-callsigns` (2024-09) | 2016-08-02 | 1 | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2024-04-17 | revised-forward | sole-row-replacement |
| `record-created` | `20AAI` | `ofcom-2024-09--every-radio-callsign--all-callsigns` (2024-09) | 2016-08-05 | 1 | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2024-03-12 | revised-forward | sole-row-replacement |
| `record-created` | `20AAJ` | `ofcom-2024-09--every-radio-callsign--all-callsigns` (2024-09) | 2016-08-05 | 1 | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2024-03-12 | revised-forward | sole-row-replacement |
| `record-created` | `20AAK` | `ofcom-2024-09--every-radio-callsign--all-callsigns` (2024-09) | 2016-07-23 | 1 | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2024-09-01 | revised-forward | sole-row-replacement |
| `record-created` | `20AAL` | `ofcom-2024-09--every-radio-callsign--all-callsigns` (2024-09) | 2016-08-05 | 1 | `wdtk-1180568--licence-breakdown-duration-age` (2024-10) | 2024-03-12 | revised-forward | sole-row-replacement |
| `record-last-modified` | `20AHY` | `ofcom-2024-07--call-signs--all-callsigns` (2024-07) | 2018-08-02 | 1 | `wdtk-1141667--issued-callsigns` (2024-07-22) | 2018-08-01 | revised-backward | sole-row-replacement |
| `record-last-modified` | `20ALM` | `ofcom-2024-07--call-signs--all-callsigns` (2024-07) | 2018-04-18 | 1 | `wdtk-1141667--issued-callsigns` (2024-07-22) | 2018-04-17 | revised-backward | sole-row-replacement |
| `record-last-modified` | `20AUG` | `ofcom-2024-01--foi-1734722--all-callsigns` (2024-01) | 2017-08-06 | 1 | `wdtk-1141667--issued-callsigns` (2024-07-22) | 2017-08-05 | revised-backward | sole-row-replacement |
| `record-last-modified` | `20BDW` | `ofcom-2024-07--call-signs--all-callsigns` (2024-07) | 2024-04-08 | 1 | `wdtk-1141667--issued-callsigns` (2024-07-22) | 2024-04-07 | revised-backward | sole-row-replacement |
| `record-last-modified` | `20BQP` | `ofcom-2024-07--call-signs--all-callsigns` (2024-07) | 2024-04-26 | 1 | `wdtk-1141667--issued-callsigns` (2024-07-22) | 2024-04-25 | revised-backward | sole-row-replacement |
| `record-last-modified` | `20BRH` | `ofcom-2024-07--call-signs--all-callsigns` (2024-07) | 2024-04-07 | 1 | `wdtk-1141667--issued-callsigns` (2024-07-22) | 2024-04-06 | revised-backward | sole-row-replacement |
| `record-last-modified` | `20BTG` | `ofcom-2024-07--call-signs--all-callsigns` (2024-07) | 2018-08-28 | 1 | `wdtk-1141667--issued-callsigns` (2024-07-22) | 2018-08-27 | revised-backward | sole-row-replacement |
| `record-last-modified` | `20BVT` | `ofcom-2024-07--call-signs--all-callsigns` (2024-07) | 2024-06-05 | 1 | `wdtk-1141667--issued-callsigns` (2024-07-22) | 2024-06-04 | revised-backward | sole-row-replacement |
| `record-last-modified` | `20CDJ` | `ofcom-2024-07--call-signs--all-callsigns` (2024-07) | 2024-04-09 | 1 | `wdtk-1141667--issued-callsigns` (2024-07-22) | 2024-04-08 | revised-backward | sole-row-replacement |
| `record-last-modified` | `20CJI` | `ofcom-2024-07--call-signs--all-callsigns` (2024-07) | 2019-04-11 | 1 | `wdtk-1141667--issued-callsigns` (2024-07-22) | 2019-04-10 | revised-backward | sole-row-replacement |

## Corroboration depth

How many datasets assert each (subject, event kind) fact, and whether
they agree on the compared statistic. Agreement is corroboration in the
publisher-entities sense — identical copies strengthen the record — but
is never proof: vintages can inherit one upstream defect. Divergence is
exactly the revision material classified above.

| event kind | datasets asserting | subjects agreeing | subjects diverging |
|---|---:|---:|---:|
| `licence-issued` | 2 | 103,901 | 0 |
| `licence-version-last-modified` | 2 | 10,862 | 1,648 |
| `licence-version-last-modified` | 3 | 82,352 | 10,731 |
| `licence-version-original-start` | 2 | 3,409 | 2 |
| `licence-version-original-start` | 3 | 2,500 | 9 |
| `licence-version-original-start` | 4 | 4,346 | 16 |
| `licence-version-original-start` | 5 | 7,793 | 43 |
| `licence-version-original-start` | 6 | 10,994 | 66 |
| `licence-version-original-start` | 7 | 80,895 | 391 |
| `record-created` | 2 | 274 | 3 |
| `record-created` | 3 | 1,266 | 4 |
| `record-created` | 4 | 45,329 | 1,850 |
| `record-created` | 5 | 8,721 | 98,807 |
| `record-created` | 6 | 30 | 273 |
| `record-created` | 7 | 7 | 940 |
| `record-created` | 8 | 0 | 4 |
| `record-last-modified` | 2 | 285 | 37 |
| `record-last-modified` | 3 | 237 | 52 |
| `record-last-modified` | 4 | 823 | 202 |
| `record-last-modified` | 5 | 483 | 227 |
| `record-last-modified` | 6 | 206 | 134 |
| `record-last-modified` | 7 | 560 | 766 |
| `record-last-modified` | 8 | 134 | 113 |
| `record-last-modified` | 9 | 41,499 | 2,259 |
| `record-last-modified` | 10 | 17 | 1,383 |
| `record-last-modified` | 11 | 2 | 1,031 |
| `record-last-modified` | 12 | 1,493 | 1,572 |
| `record-last-modified` | 13 | 6,864 | 96,134 |
| `record-last-modified` | 14 | 3 | 330 |
| `record-last-modified` | 15 | 4 | 939 |
| `record-last-modified` | 16 | 0 | 4 |
| `reserved-until` | 2 | 491 | 0 |
| `reserved-until` | 3 | 31 | 3 |
| `reserved-until` | 4 | 41 | 0 |
| `reserved-until` | 5 | 47 | 4 |
