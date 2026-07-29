import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  acquireClaimsSource,
  computeEventTimeCoherency,
  subjectKindSequence,
  renderEventTimeCoherency,
  EXEMPLAR_LIMIT,
  EVENT_TIME_COHERENCY_PATH,
  type ClaimsSourceHandle,
  type EventTimeCoherency,
} from './event-time-coherency.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';
import { EVENT_DATE_KINDS } from '../v2/claim.ts';
import { assertNonEmpty } from '../testing/non-vacuity.ts';

// Issue #725 S2: the detector validated against the corpus's RECORDED ground
// truth — the two data-coherency episodes documented in
// docs/source-register.md (#800 event-time creep with the G3ATI/G3SDS worked
// examples; #801 the 2025-10-11/-30 mass update) plus the 2016 migration
// cluster from the issue's empirical survey. The detector must find each of
// them from the claims alone, classify them in its own vocabulary, and keep a
// mass episode ONE finding rather than tens of thousands. Test names follow
// Subject_Scenario_Outcome.
//
// Figures asserted exactly are figures of the COMMITTED archive (immutable
// entries): they change only when a new dataset is ingested, which is exactly
// when this suite should demand a deliberate re-read, like the other
// data-validity goldens.

describe.skipIf(!duckDbAvailable())('event-time coherency — real-corpus ground truth', { tags: ['data-validity'] }, () => {
  let handle: ClaimsSourceHandle;
  let c: EventTimeCoherency;
  beforeAll(() => {
    // One claims source for the whole suite: the shared deploy-time Parquet
    // where the run provides one (CLAIMS_PARQUET), else a one-off full-corpus
    // materialisation.
    handle = acquireClaimsSource();
    c = computeEventTimeCoherency(handle.source);
  }, 600_000);
  afterAll(() => { handle.dispose(); });

  // --- The committed report is exactly this fold -------------------------

  it('CoherencyReport_FoldedFromTheClaimLedger_MatchesTheCommittedGoldenByteForByte', () => {
    const golden = fs.readFileSync(path.resolve(process.cwd(), EVENT_TIME_COHERENCY_PATH), 'utf8');
    expect(renderEventTimeCoherency(c)).toBe(golden);
  });

  it('CoherencyFold_RunTwiceOverTheSameClaims_IsByteDeterministic', () => {
    expect(renderEventTimeCoherency(computeEventTimeCoherency(handle.source))).toBe(renderEventTimeCoherency(c));
  });

  // --- Ground truth (a): the #801 mass-update episode --------------------

  it('MassEpisode_2025October_IsDetectedWithTheRecordedDatesAndShare', () => {
    const episode = c.episodes.find(e => e.start === '2025-10-11');
    expect(episode).toBeDefined();
    if (episode === undefined) return;
    // The recorded window: two waves, 2025-10-11 and 2025-10-30 (#801).
    expect(episode.end).toBe('2025-10-30');
    // Witnessed by every open-data vintage carrying the licence-version
    // last-modified column — the column the episode was recorded against.
    expect(episode.signals.map(s => `${s.kind}:${s.dataset}`)).toEqual([
      'licence-version-last-modified:2025-11-11',
      'licence-version-last-modified:2026-01-14',
      'licence-version-last-modified:2026-06-23',
    ]);
    // Roughly the recorded share. #801 records 55.2% of ALL 158,318 register
    // rows for the 2026-06-23 vintage; this fold's denominator is POPULATED
    // dates (105,332), so the same cluster reads 85.6% here — and the row
    // count in the span (90,189) against the full register reproduces the
    // recorded all-rows figure (56.97%, recorded as 55.2% for the two peak
    // days alone).
    const latest = episode.signals.find(s => s.dataset === '2026-06-23');
    expect(latest).toBeDefined();
    if (latest === undefined) return;
    expect(latest.rows).toBeGreaterThan(85_000);
    expect(latest.share).toBeGreaterThan(0.8);
    expect(latest.peakDays.map(p => p.day)).toEqual(['2025-10-11', '2025-10-30']);
    // The recorded two-wave split: ~76k on the first day, ~11k on the second.
    const first = latest.peakDays[0];
    expect(first.share).toBeGreaterThan(0.7);
  });

  it('MassEpisode_2025October_StaysOneFindingNotTensOfThousands', () => {
    // The ~90k records touched in the episode appear as EPISODE evidence
    // (three witness signals), never as ~90k per-record revisions: the
    // licence-version-last-modified revision totals stay tiny (the recorded
    // erosion between vintages reads as expected-progression, and only a
    // handful of subjects move backward).
    const lvm = c.totals.filter(t => t.kind === 'licence-version-last-modified');
    const revised = lvm.filter(t => t.classification === 'revised-forward' || t.classification === 'revised-backward');
    const revisedSubjects = revised.reduce((sum, t) => sum + t.subjects, 0);
    expect(revisedSubjects).toBeLessThan(100);
    const corroborated = lvm.find(t => t.classification === 'corroborated');
    expect(corroborated).toBeDefined();
    expect(corroborated?.subjects ?? 0).toBeGreaterThan(150_000);
  });

  // --- Ground truth (b): the 2016 migration cluster -----------------------

  it('MassEpisode_2016Migration_IsDetectedAcrossBothLanesAndBothBookkeepingColumns', () => {
    const episode = c.episodes.find(e => e.start === '2016-07-23');
    expect(episode).toBeDefined();
    if (episode === undefined) return;
    // The empirically recorded three-date window, 23 Jul – 12 Aug 2016.
    expect(episode.end).toBe('2016-08-12');
    // The survey's strongest witnesses are all present: the 2020 reserved
    // disclosure's near-total fingerprint on BOTH its date columns, and the
    // 2023 FOI register snapshot at the recorded ~63-66% of populated dates.
    const keys = episode.signals.map(s => `${s.kind}:${s.dataset}`);
    expect(keys).toContain('record-created:ofcom-2020-10-23--reserved-callsigns');
    expect(keys).toContain('record-last-modified:ofcom-2020-10-23--reserved-callsigns');
    expect(keys).toContain('record-last-modified:ofcom-2023-01-25--call-sign-list-with-status--all-callsigns');
    const reservedCreated = episode.signals.find(s => s.kind === 'record-created' && s.dataset === 'ofcom-2020-10-23--reserved-callsigns');
    expect(reservedCreated?.share ?? 0).toBeGreaterThan(0.95);
    const foi2023 = episode.signals.find(s => s.kind === 'record-last-modified' && s.dataset.startsWith('ofcom-2023-01-25'));
    expect(foi2023?.share ?? 0).toBeGreaterThan(0.6);
    expect(foi2023?.peakDays.map(p => p.day)).toEqual(['2016-07-23', '2016-08-12']);
    // Both lanes witness it (the open-data twin of the 2023-01-25 register
    // and the 2025 open-data publications carry the same fingerprint).
    expect(new Set(episode.signals.map(s => s.lane))).toEqual(new Set(['foi', 'opendata']));
  });

  it('MassEpisodes_OnTheCurrentCorpus_AreExactlyTheTwoRecordedOnes', () => {
    expect(
      c.episodes.map(e => `${e.start}..${e.end}`),
      'The detected episode list moved. A NEW episode here is a genuine finding (or a detector regression), '
      + 'never routine churn: examine its witness signals, record the episode in docs/source-register.md\'s '
      + '"Known data-coherency episodes" table alongside #800/#801, regenerate reports/event-time-coherency.md '
      + '(node src/ci/event-time-coherency.ts), and only then update this pinned list.',
    ).toEqual([
      '2016-07-23..2016-08-12',
      '2025-10-11..2025-10-30',
    ]);
  });

  // --- Ground truth (c): the #800 worked examples -------------------------

  it('G3ATI_EarliestSurvivingStartDate_MovesForwardByVersionWindowDrop', () => {
    // docs/source-register.md (#800 mechanism A): G3ATI holds a 1952-10-10
    // licence-version row in archive/2025-11-11 that is absent from
    // archive/2026-06-23, so its earliest SURVIVING start date moves forward.
    const seq = subjectKindSequence(handle.source, 'G3ATI', c.episodes)
      .filter(r => r.kind === 'licence-version-original-start');
    const v20251111 = seq.find(r => r.dataset === '2025-11-11');
    expect(v20251111).toMatchObject({ stat: '1952-10-10', nrows: 2 });
    const v20260623 = seq.find(r => r.dataset === '2026-06-23');
    expect(v20260623).toMatchObject({
      stat: '2015-02-07',
      classification: 'revised-forward',
      mechanism: 'version-window-drop',
    });
    // Richer than the recorded pair: the 1952 row is absent from the 2021
    // register annexes (whose earliest surviving date is already 2015-02-07)
    // and REAPPEARS in 2025-11-11 — the extension mirror of the drop.
    expect(v20251111).toMatchObject({ classification: 'revised-backward', mechanism: 'version-window-extension' });
  });

  it('G3SDS_SoleVersionRowDate_JumpsWholesaleAsSoleRowReplacement', () => {
    // docs/source-register.md (#800 mechanism B): G3SDS 1977-07-09 →
    // 2026-02-23 between 2025-11-11 and 2026-06-23, a single-version
    // callsign's date replaced wholesale on a variation/reissue.
    const seq = subjectKindSequence(handle.source, 'G3SDS', c.episodes)
      .filter(r => r.kind === 'licence-version-original-start');
    // Four consecutive version-scoped datasets across both lanes corroborate
    // 1977-07-09 (the licence-SCOPED 2024/2025 disclosures agree too, under
    // their own licence-original-start kind — separate by design)…
    const before = seq.filter(r => r.dataset !== '2026-06-23');
    expect(before.length).toBe(4);
    for (const row of before) expect(row).toMatchObject({ stat: '1977-07-09', nrows: 1 });
    expect(before.filter(r => r.classification === 'corroborated')).toHaveLength(3);
    // …then the latest vintage contradicts them all. The 49-year jump keeps
    // the sole-row-replacement candidate even though this pair crosses a
    // rendering boundary (ISO 2026-01-14 vs day-first 2026-06-23): a
    // day-truncation collision can only ever move a date by one day.
    const v20260623 = seq.find(r => r.dataset === '2026-06-23');
    expect(v20260623).toMatchObject({
      stat: '2026-02-23',
      prevStat: '1977-07-09',
      classification: 'revised-forward',
      mechanism: 'sole-row-replacement',
    });
    // The licence-scoped kind sees the same 1977 story from its own two
    // witnesses, structurally never compared against the version-scoped rows.
    const licenceScoped = subjectKindSequence(handle.source, 'G3SDS', c.episodes)
      .filter(r => r.kind === 'licence-original-start');
    expect(licenceScoped.map(r => r.stat)).toEqual(['1977-07-09', '1977-07-09']);
  });

  // --- Corroboration for stable facts -------------------------------------

  it('CorroborationDepth_ForStableFacts_ShowsAgreementAtScale', () => {
    // The two 2019 register-and-forbidden witnesses (an Ofcom disclosure and
    // a WDTK copy of the same publication) agree on every licence-issued
    // date they both carry — the publisher-entities identical-copies logic
    // through time.
    const licenceIssued = c.corroboration.find(r => r.kind === 'licence-issued' && r.depth === 2);
    expect(licenceIssued).toEqual({ kind: 'licence-issued', depth: 2, agreeing: 103_901, diverging: 0 });
    // The earliest-surviving original-start date is corroborated by all five
    // version-scoped datasets for the overwhelming majority of subjects.
    const originalStart5 = c.corroboration.find(r => r.kind === 'licence-version-original-start' && r.depth === 5);
    expect(originalStart5?.agreeing ?? 0).toBeGreaterThan(80_000);
    expect(originalStart5?.diverging ?? 0).toBeLessThan(1_000);
    // The two licence-SCOPED disclosures (the per-licence 2024-10 sheet and
    // the Salesforce-flavoured 2025-09-11 workbook) corroborate each other's
    // licence original-start for ~103k subjects — agreement that was
    // previously misread as ~102k register-record revisions.
    const licenceOriginal = c.corroboration.find(r => r.kind === 'licence-original-start' && r.depth === 2);
    expect(licenceOriginal?.agreeing ?? 0).toBeGreaterThan(100_000);
  });

  // --- Cross-scope artefacts stay structurally impossible ------------------
  //
  // The review of the first cut established that all three of its "fresh
  // catches" were ARTEFACTS of conflated column semantics or rendering
  // differences, not register revisions. These cases pin the corrections.

  it('LicenceScopedColumns_AfterTheKindSplit_NeverReadAsRegisterRecordRevisions', () => {
    // wdtk-1180568's per-licence CreatedDate (values in 2024, the
    // disclosure's era) was previously compared against register records'
    // created dates (the 2016 migration cluster) as one kind, manufacturing
    // ~102k phantom "revisions" in each direction. With the licence-scoped
    // kinds split, neither that disclosure nor the licence-scoped 2025-09-11
    // workbook participates in ANY record-scoped comparison…
    for (const kind of ['record-created', 'record-last-modified']) {
      expect(c.pairs.filter(p => p.kind === kind && (p.dataset.startsWith('wdtk-1180568') || p.prevDataset.startsWith('wdtk-1180568')))).toEqual([]);
      expect(c.pairs.filter(p => p.kind === kind && (p.dataset.startsWith('ofcom-2025-09-11') || p.prevDataset.startsWith('ofcom-2025-09-11')))).toEqual([]);
    }
    // …and the record-created axis returns to near-total corroboration: the
    // handful of genuine per-record divergences, not ~204k phantom steps.
    const recordCreatedRevised = c.totals
      .filter(t => t.kind === 'record-created' && (t.classification === 'revised-forward' || t.classification === 'revised-backward'))
      .reduce((sum, t) => sum + t.subjects, 0);
    expect(recordCreatedRevised).toBeLessThan(20);
    // Each licence-scoped kind currently has at most the two 2024/2025
    // witnesses, so no licence-scoped comparison crosses into any other kind.
    for (const t of assertNonEmpty(c.totals, 'event-time coherency totals')) {
      expect(['record-created', 'record-last-modified', 'licence-version-last-modified', 'licence-version-original-start', 'licence-issued', 'licence-cancelled', 'reserved-until', 'licence-created', 'licence-last-modified', 'licence-original-start']).toContain(t.kind);
    }
  });

  it('OneDayLastModifiedGap_AcrossTheUtcRenderedWdtkExport_CarriesTheRenderingDifferenceCandidate', () => {
    // The 632 subjects whose last-modified reads one day earlier in
    // wdtk-1141667 than in the 2024-07 register: the register renders
    // day-first date-only (local), the workbook export renders ISO with UTC
    // time-of-day, and S1's day truncation shifts a 23:00Z stamp into the
    // previous BST day. Confirmed a rendering collision, not an event — the
    // mechanism must say so, never sole-row-replacement.
    const pair = c.pairs.find(p =>
      p.kind === 'record-last-modified'
      && p.prevDataset.startsWith('ofcom-2024-07')
      && p.dataset.startsWith('wdtk-1141667')
      && p.classification === 'revised-backward');
    expect(pair).toMatchObject({ mechanism: 'rendering-difference', subjects: 632 });
    // Bounded surfaces: exemplars stay capped per kind and direction.
    expect(c.exemplars.length).toBeLessThanOrEqual(EVENT_DATE_KINDS.length * 2 * EXEMPLAR_LIMIT);
  });
});
