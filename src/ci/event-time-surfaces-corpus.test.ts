import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { foldEventTimeProjection, type EventTimeProjection } from './event-time-projection.ts';
import { buildCallsignEventShards, type EventShardBuildSummary } from './build-callsign-event-shards.ts';
import { computeOnThisDayEntries, type OnThisDayEntry } from './build-on-this-day.ts';
import { foldSubjectEvents, foldSubjectUniverse } from './state-at-t.ts';
import { shardNameFor } from './build-callsign-shards.ts';
import { acquireClaimsSource, type ClaimsSourceHandle } from './event-time-coherency.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';
import { parseJsonObject } from '../shared/json-shape.ts';

// The issue #726 surfaces over the REAL corpus. The load-bearing assertion is
// PARITY: the in-process projection (collectLedgerSources +
// emitEventDateClaims, the S1 emit path run at site-build time) must yield
// exactly the evidence rows the ledger fold (foldSubjectEvents) yields for the
// same subjects — the site surfaces and the committed state-at-t report must
// never disagree about what the corpus asserts. Exemplars are issue #800's
// recorded ground truth (G3ATI mechanism A, G3SDS mechanism B) plus the
// reservation exemplar GB0SNB. Test names follow Subject_Scenario_Outcome.

interface EventsMeta {
  asAt: string;
  counts: { subjects: number };
  datasets: { lane: string; key: string; vintage: string }[];
  kinds: { id: string }[];
  episodes: { start: string; end: string }[];
  shards: string[];
}

type EventRecord = {
  e: [number, string, [number, number][], number?][];
  f: [number, string, number[], number[]][];
  g?: [number, [string, number[]][]][];
  w?: number;
};

let projection: EventTimeProjection;
let outDir: string;
let summary: EventShardBuildSummary;
let meta: EventsMeta;
let entries: OnThisDayEntry[];

function readRecord(cleaned: string): EventRecord | undefined {
  const shard = shardNameFor(cleaned, new Set(meta.shards));
  const parsed = parseJsonObject(fs.readFileSync(path.join(outDir, `${shard}.json`), 'utf8'), `${shard}.json`) as { callsigns: Record<string, EventRecord> };
  return parsed.callsigns[cleaned];
}

describe('event-time surfaces over the real corpus (issue #726)', { tags: ['data-validity'] }, () => {
  beforeAll(() => {
    // One projection for the whole suite: the corpus parse is the expensive
    // step, and byte-determinism of the emit stage is pinned separately below
    // (the fixture suite pins the fold's own ordering rules).
    projection = foldEventTimeProjection();
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'event-surfaces-corpus-'));
    summary = buildCallsignEventShards(projection, outDir);
    meta = parseJsonObject(fs.readFileSync(path.join(outDir, 'meta.json'), 'utf8'), 'meta.json') as EventsMeta;
    entries = computeOnThisDayEntries(projection);
  }, 600_000);

  it('EventShards_RebuiltFromTheSameProjection_AreByteIdentical', () => {
    const again = fs.mkdtempSync(path.join(os.tmpdir(), 'event-surfaces-corpus-b-'));
    buildCallsignEventShards(projection, again);
    const files = fs.readdirSync(outDir).sort();
    expect(fs.readdirSync(again).sort()).toEqual(files);
    for (const file of files) {
      expect(fs.readFileSync(path.join(outDir, file)).equals(fs.readFileSync(path.join(again, file))), `${file} should be byte-identical`).toBe(true);
    }
  }, 600_000);

  it('EpisodeWindows_DetectedFromTheInProcessHistogram_AreTheTwoRecordedEpisodes', () => {
    expect(meta.episodes.map(e => `${e.start}..${e.end}`)).toEqual([
      '2016-07-23..2016-08-12',
      '2025-10-11..2025-10-30',
    ]);
  });

  it('AsAt_IsTheLatestProvenAssertionDayOfTheCorpus_NeverTheBuildClock', () => {
    expect(meta.asAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const latest = projection.datasets.map(d => d.vintage).sort().at(-1) ?? '';
    expect(meta.asAt >= latest.slice(0, 10)).toBe(true);
  });

  it('G3SDS_MechanismBExemplar_CarriesTheBothCampsDisagreement', () => {
    // Issue #800's recorded ground truth: four vintages assert 1977-07-09 and
    // the 2026-06-23 vintage asserts 2026-02-23 (a sole-row replacement).
    const record = readRecord('G3SDS');
    expect(record?.g).toBeDefined();
    const startKindIdx = meta.kinds.findIndex(k => k.id === 'licence-version-original-start');
    const disagreement = (record?.g ?? []).find(([kindIdx]) => kindIdx === startKindIdx);
    expect(disagreement).toBeDefined();
    const camps = disagreement === undefined ? [] : disagreement[1];
    expect(camps.map(([day]) => day)).toContain('1977-07-09');
    expect(camps.map(([day]) => day)).toContain('2026-02-23');
  });

  it('G3ATI_MechanismAExemplar_CarriesTheMultiRowWindowSignal', () => {
    const record = readRecord('G3ATI');
    expect(record?.w).toBe(1);
    expect(record?.g).toBeDefined();
  });

  it('StableRecord_WithSingleCorroboratedHistory_CarriesNoReissueSignals', () => {
    // M7TEE (the maintainer's own callsign, present since 2018 with one
    // consistent start date): the majority shape - the explainer stays folded.
    const record = readRecord('M7TEE');
    expect(record).toBeDefined();
    expect(record?.g).toBeUndefined();
    expect(record?.w).toBeUndefined();
  });

  it('EveryFindingInTheExemplarShards_ShipsStatementPlusResolvableCaveats', () => {
    for (const subject of ['G3ATI', 'G3SDS', 'GB0SNB', 'M7TEE']) {
      const record = readRecord(subject);
      expect(record, subject).toBeDefined();
      for (const [, statement, caveatIdxs] of record?.f ?? []) {
        expect(statement.trim().length, `${subject}: statement (issue #861 item 4)`).toBeGreaterThan(0);
        for (const idx of caveatIdxs) expect(idx).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('OnThisDay_RealCorpus_YieldsEntriesWithCitationsAndCaveats', () => {
    expect(entries.length).toBeGreaterThan(0);
    const m7 = entries.find(e => e.series === 'M7' && e.event === 'first-start');
    expect(m7).toBeDefined();
    expect(m7?.datasetIdxs.length).toBeGreaterThan(0);
    expect(m7?.caveats).toContain('earliest-surviving');
    for (const entry of entries) {
      expect(entry.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.callsigns.length).toBeGreaterThan(0);
      expect(entry.datasetIdxs.length, `${entry.series}/${entry.event} must cite its asserting datasets`).toBeGreaterThan(0);
    }
  });

  describe.skipIf(!duckDbAvailable())('parity against the claim ledger', () => {
    let handle: ClaimsSourceHandle;
    beforeAll(() => { handle = acquireClaimsSource(); }, 600_000);
    afterAll(() => { handle.dispose(); });

    it('Projection_ForTheRecordedExemplars_MatchesTheLedgerFoldRowForRow', () => {
      for (const subject of ['G3ATI', 'G3SDS', 'GB0SNB', 'M7TEE']) {
        const ledgerRows = foldSubjectEvents(handle.source, subject)
          .map(row => ({ ...row, nrows: Number(row.nrows) }));
        const projectionRows = projection.rows.get(subject) ?? [];
        expect(projectionRows, subject).toEqual(ledgerRows);
      }
    }, 600_000);

    it('ProjectionSubjectCount_MatchesTheLedgerSubjectUniverse', () => {
      const universe = foldSubjectUniverse(handle.source);
      expect(projection.rows.size).toBe(universe.eventSubjects);
      expect(summary.subjects).toBe(universe.eventSubjects);
    }, 600_000);
  });
});
