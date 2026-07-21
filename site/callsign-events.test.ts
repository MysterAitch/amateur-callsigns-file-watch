// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { stripModel, renderEventStripInto, renderEventStrip, resetEventStripCaches } from './callsign-events.js';

// The per-callsign event-time strip (issue #726), pinned on fixtures shaped
// exactly like src/ci/build-callsign-event-shards.ts's output. What matters
// here is the honesty contract, not the pixels:
//  - findings render statement + caveats, never a bare rule-name badge
//    (issue #861 item 4);
//  - every event-time claim carries its assertion-time provenance inline;
//  - disagreements list both camps and adjudicate neither (issue #467);
//  - the reissue explainer is ALWAYS present, folded on a stable record and
//    auto-opened on a signal-bearing one (the conditional-prominence pattern);
//  - absence renders as non-observation, never "available"/"did not exist".
// Test names follow Subject_Scenario_Outcome.

type EventsMeta = Parameters<typeof stripModel>[1];
type EventRecord = NonNullable<Parameters<typeof stripModel>[0]>;

function meta(): EventsMeta {
  return {
    schemaVersion: 1,
    asAt: '2026-06-23',
    counts: { datasets: 3, subjects: 2, shards: 1, unkeyableEventClaims: 0 },
    datasets: [
      { lane: 'foi', key: 'entry-a', vintage: '2020-05-01', title: 'entry-a', href: 'datasets/foi/entry-a/index.html' },
      { lane: 'opendata', key: '2025-11-11', vintage: '2025-11-11', title: 'Ofcom open data, 2025-11-11', href: 'datasets/open-data/2025-11-11/index.html' },
      { lane: 'opendata', key: '2026-06-23', vintage: '2026-06-23', title: 'Ofcom open data, 2026-06-23', href: 'datasets/open-data/2026-06-23/index.html' },
    ],
    kinds: [
      { id: 'record-created', label: 'register record created (publisher bookkeeping)', contribution: 'system-presence' },
      { id: 'licence-version-original-start', label: 'licence-version start — the earliest surviving in the asserting vintage', contribution: 'licence-start' },
      { id: 'licence-cancelled', label: 'licence cancelled', contribution: 'licence-end' },
    ],
    rules: [
      { id: 'licence-start-on-or-before-t', gloss: 'at least one consulted vintage asserts a start on or before t' },
      { id: 'consistent-with-licence-in-force-at-t', gloss: 'start evidence with no cancellation evidence - consistent with, never proof' },
      { id: 'record-in-system-on-or-before-t', gloss: 'bookkeeping stamps only - never a licensing event' },
    ],
    caveats: [
      { id: 'earliest-surviving', label: 'earliest surviving date, not “the true original”', gloss: 'issue #800 - rolling retention and reissues drop or replace older rows' },
      { id: 'vintages-disagree', label: 'the consulted vintages disagree', gloss: 'issue #467 - surfaced beside the finding, resolved nowhere' },
      { id: 'availability-trap', label: 'absence of evidence is non-observation', gloss: 'never "was available" or "did not exist"' },
    ],
    episodes: [{ start: '2016-07-23', end: '2016-08-12' }],
    shards: ['G3', 'M7'],
  };
}

// A stable, corroborated record: one start, two agreeing vintages, bookkeeping.
function stableRecord(): EventRecord {
  return {
    e: [
      [0, '2016-08-01', [[0, 1]], 0],
      [1, '2018-12-20', [[1, 1], [2, 1]]],
    ],
    f: [
      [0, 'a licence(-version) start dated 2018-12-20 is asserted on or before 2026-06-23', [0], [1]],
      [1, 'start evidence dated 2018-12-20 with no cancellation evidence — consistent with a licence being in force at 2026-06-23, never proof', [0, 2], [1]],
    ],
  };
}

// A signal-bearing record: the vintages disagree on the start (both camps).
function signalRecord(): EventRecord {
  return {
    e: [
      [1, '1977-07-09', [[0, 1], [1, 1]]],
      [1, '2026-02-23', [[2, 1]]],
    ],
    f: [
      [0, 'licence(-version) starts dated between 1977-07-09 and 2026-02-23 are asserted on or before 2026-06-23', [0, 1], [0, 1]],
    ],
    g: [
      [1, [['1977-07-09', [0, 1]], ['2026-02-23', [2]]]],
    ],
    w: 1,
  };
}

// A record whose only dated evidence is bookkeeping.
function bookkeepingOnlyRecord(): EventRecord {
  return {
    e: [[0, '2016-08-01', [[0, 1]], 0]],
    f: [[2, 'record bookkeeping stamps dated on or before 2026-06-23 — a statement about the system, never a licensing event', [], [0]]],
  };
}

const render = (record: EventRecord) => {
  const host = document.createElement('div');
  renderEventStripInto(host, 'G3ZZZ', record, meta());
  return host;
};

describe('stripModel (issue #726)', { tags: ['ui'] }, () => {
  it('StripModel_StableCorroboratedRecord_KeepsReissueExplainerFolded', () => {
    const model = stripModel(stableRecord(), meta());
    expect(model.reissueOpen).toBe(false);
    expect(model.reissueReasons).toEqual([]);
  });

  it('StripModel_SignalBearingRecord_OpensReissueExplainerAndNamesTheSignals', () => {
    const model = stripModel(signalRecord(), meta());
    expect(model.reissueOpen).toBe(true);
    expect(model.reissueReasons.join(' ')).toMatch(/vintages disagree/);
    expect(model.reissueReasons.join(' ')).toMatch(/multi-row version window/);
  });

  it('StripModel_BookkeepingOnlyRecord_MarksBookkeepingAsTheStory', () => {
    const model = stripModel(bookkeepingOnlyRecord(), meta());
    expect(model.bookkeepingOpen).toBe(true);
    expect(model.licensing).toEqual([]);
  });

  it('StripModel_RecordCitingAnUnknownDatasetIndex_FailsLoudNeverRendersUnattributed', () => {
    const broken: EventRecord = { e: [[1, '2018-12-20', [[99, 1]]]], f: [] };
    expect(() => stripModel(broken, meta())).toThrow(/dataset index 99/);
  });
});

describe('renderEventStripInto (issue #726)', { tags: ['ui'] }, () => {
  it('EventStrip_Finding_RendersStatementPlusCaveatsNeverABareRuleBadge', () => {
    const host = render(stableRecord());
    const findings = [...host.querySelectorAll('.evt-findings li')];
    expect(findings.length).toBeGreaterThan(0);
    for (const li of findings) {
      const text = li.textContent ?? '';
      // The statement is present in full...
      expect(text).toMatch(/asserted on or before 2026-06-23|consistent with a licence being in force/);
    }
    // ...and the in-force finding names its caveats beside it.
    const inForce = findings.find(li => (li.textContent ?? '').includes('consistent with a licence being in force'));
    expect(inForce?.textContent).toMatch(/Caveats: .*earliest surviving date/);
    expect(inForce?.textContent).toMatch(/absence of evidence is non-observation/);
    // The rule name may appear, but only alongside the statement - never as
    // the only content of a finding.
    const ruleOnly = findings.filter(li => (li.textContent ?? '').trim() === 'consistent-with-licence-in-force-at-t');
    expect(ruleOnly).toEqual([]);
  });

  it('EventStrip_EveryEventTimeLine_CarriesItsAssertionTimeProvenanceInline', () => {
    const host = render(stableRecord());
    const lines = [...host.querySelectorAll('.evt-lines li')];
    expect(lines.length).toBeGreaterThan(0);
    for (const li of lines) {
      const assert = li.querySelector('.evt-assert');
      expect(assert, 'every event-time line must carry an asserted-by run').not.toBeNull();
      expect(assert?.textContent).toMatch(/asserted by/);
      expect(assert?.querySelector('a')).not.toBeNull();
      expect(assert?.textContent).toMatch(/vintage/);
    }
  });

  it('EventStrip_SignalBearingRecord_AutoOpensTheReissueExplainerAndNamesItsSignals', () => {
    const host = render(signalRecord());
    const explainer = host.querySelector('details.evt-reissue');
    expect(explainer).not.toBeNull();
    expect(explainer?.hasAttribute('open')).toBe(true);
    expect(explainer?.textContent).toMatch(/directly relevant here/);
    expect(explainer?.textContent).toMatch(/vintages disagree/);
  });

  it('EventStrip_StableRecord_KeepsTheReissueExplainerPresentButFolded', () => {
    const host = render(stableRecord());
    const explainer = host.querySelector('details.evt-reissue');
    // Present-but-collapsed, never absent: the folded note passively answers
    // "what would a reissue look like?" on records that carry none.
    expect(explainer).not.toBeNull();
    expect(explainer?.hasAttribute('open')).toBe(false);
    expect(explainer?.textContent).toMatch(/would appear/);
    expect(explainer?.textContent).toMatch(/earliest start/);
  });

  it('EventStrip_Disagreement_ListsBothCampsWithDatasetsAndAdjudicatesNeither', () => {
    const host = render(signalRecord());
    const card = host.querySelector('.evt-disagree');
    expect(card).not.toBeNull();
    const text = card?.textContent ?? '';
    expect(text).toContain('1977');
    expect(text).toContain('2026');
    expect(text).toMatch(/vs/);
    expect(text).toMatch(/adjudicates none|neither/);
    // Each camp names at least one asserting dataset link.
    expect((card?.querySelectorAll('.evt-camps a') ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('EventStrip_BookkeepingBesideLicensingEvidence_StaysFolded', () => {
    const host = render(stableRecord());
    const fold = host.querySelector('details.evt-bookkeeping');
    expect(fold).not.toBeNull();
    expect(fold?.hasAttribute('open')).toBe(false);
    expect(fold?.textContent).toMatch(/never licensing events/);
  });

  it('EventStrip_BookkeepingOnlyRecord_OpensTheFoldBecauseItIsTheWholeStory', () => {
    const host = render(bookkeepingOnlyRecord());
    const fold = host.querySelector('details.evt-bookkeeping');
    expect(fold?.hasAttribute('open')).toBe(true);
    expect(host.textContent).toMatch(/No dated licensing evidence/);
    expect(host.textContent).toMatch(/never “was available” or “did not exist”/);
  });

  it('EventStrip_MassEpisodeLine_CarriesTheEpisodeAnnotation', () => {
    const host = render(stableRecord());
    expect(host.textContent).toMatch(/mass-update episode 2016-07-23 → 2016-08-12/);
    expect(host.textContent).toMatch(/one system episode, not a per-record event/);
  });

  it('EventStrip_NoRecordHeld_RendersNonObservationNeverAvailability', () => {
    const host = document.createElement('div');
    renderEventStripInto(host, 'Q1ZZZ', null, meta());
    const text = host.textContent ?? '';
    expect(text).toMatch(/No event-time claim/);
    expect(text).toMatch(/non-observation/);
    expect(text).toMatch(/not evidence the callsign was available/);
    const ledger = host.querySelector('a[href="ledger.html?c=Q1ZZZ"]');
    expect(ledger).not.toBeNull();
  });

  it('EventStrip_Findings_AreDatedAtTheCorpusCeilingNotToday', () => {
    const host = render(stableRecord());
    const heading = [...host.querySelectorAll('h3')].find(h => (h.textContent ?? '').includes('honestly be inferred'));
    expect(heading?.textContent).toMatch(/as at/);
    expect(host.textContent).toMatch(/latest assertion day the held corpus covers, not today/);
  });

  it('EventStrip_LegendAndCrosslinks_AreOneAffordanceAway', () => {
    const host = render(stableRecord());
    const legend = host.querySelector('#evt-legend');
    expect(legend).not.toBeNull();
    expect(legend?.hasAttribute('open')).toBe(false);
    expect(legend?.textContent).toMatch(/never a licensing event/);
    expect(host.querySelector('a[href="ledger.html?c=G3ZZZ"]')).not.toBeNull();
    expect(host.querySelector('a[href="on-this-day.html"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The fetch/error orchestration (renderEventStrip): the branch that must
// NEVER read as "no events". A failed or malformed fetch renders the
// could-not-load note (with the ledger escape hatch); only a successful
// fetch whose shard genuinely lacks the key renders the non-observation
// callout. Fetches are stubbed - no network, no timing.

type FetchStub = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

function okJson(payload: unknown) {
  return { ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(payload)) };
}

function notFound() {
  return { ok: false, status: 404, text: () => Promise.resolve('not found') };
}

function stubFetch(fn: FetchStub) {
  vi.stubGlobal('fetch', fn);
}

function hosts() {
  const host = document.createElement('div');
  const status = document.createElement('p');
  document.body.append(host, status);
  return { host, status };
}

const shardNameForStub = () => 'G3';

describe('renderEventStrip fetch orchestration (issue #726)', { tags: ['ui'] }, () => {
  beforeEach(() => {
    resetEventStripCaches();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('EventStrip_MetaFetchFails_RendersCouldNotLoadNeverTheNoEventsState', async () => {
    stubFetch(() => Promise.resolve(notFound()));
    const { host, status } = hosts();
    await renderEventStrip({ host, status, key: 'G3ZZZ', shardNameFor: shardNameForStub });
    expect(host.textContent).toMatch(/Could not load the event-time data/);
    expect(host.textContent).not.toMatch(/No event-time claim/);
    expect(host.querySelector('a[href="ledger.html?c=G3ZZZ"]')).not.toBeNull();
    expect(status.textContent).toBe('');
  });

  it('EventStrip_ShardFetchFails_RendersCouldNotLoadNeverTheNoEventsState', async () => {
    stubFetch(url => Promise.resolve(url.endsWith('meta.json') ? okJson(meta()) : notFound()));
    const { host, status } = hosts();
    await renderEventStrip({ host, status, key: 'G3ZZZ', shardNameFor: shardNameForStub });
    expect(host.textContent).toMatch(/Could not load the event-time data/);
    expect(host.textContent).toMatch(/HTTP 404/);
    expect(host.textContent).not.toMatch(/No event-time claim/);
    expect(status.textContent).toBe('');
  });

  it('EventStrip_MalformedShardJson_RendersCouldNotLoadNeverTheNoEventsState', async () => {
    stubFetch(url => Promise.resolve(url.endsWith('meta.json')
      ? okJson(meta())
      : { ok: true, status: 200, text: () => Promise.resolve('this is not json') }));
    const { host, status } = hosts();
    await renderEventStrip({ host, status, key: 'G3ZZZ', shardNameFor: shardNameForStub });
    expect(host.textContent).toMatch(/Could not load the event-time data/);
    expect(host.textContent).not.toMatch(/No event-time claim/);
    expect(status.textContent).toBe('');
  });

  it('EventStrip_FetchSucceedsButKeyAbsentFromShard_RendersTheNonObservationCallout', async () => {
    stubFetch(url => Promise.resolve(url.endsWith('meta.json')
      ? okJson(meta())
      : okJson({ shard: 'G3', callsigns: {} })));
    const { host, status } = hosts();
    await renderEventStrip({ host, status, key: 'G3ZZZ', shardNameFor: shardNameForStub });
    expect(host.textContent).toMatch(/No event-time claim/);
    expect(host.textContent).toMatch(/non-observation/);
    expect(host.textContent).not.toMatch(/Could not load/);
    expect(status.textContent).toMatch(/events\/G3\.json/);
  });

  it('EventStrip_FetchSucceedsWithRecord_RendersTheStripAndTheLoadedStatus', async () => {
    stubFetch(url => Promise.resolve(url.endsWith('meta.json')
      ? okJson(meta())
      : okJson({ shard: 'G3', callsigns: { G3ZZZ: stableRecord() } })));
    const { host, status } = hosts();
    await renderEventStrip({ host, status, key: 'G3ZZZ', shardNameFor: shardNameForStub });
    expect(host.querySelectorAll('.evt-findings li').length).toBeGreaterThan(0);
    expect(status.textContent).toMatch(/loaded after the instant answer/);
  });
});
