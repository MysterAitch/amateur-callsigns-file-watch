import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildCallsignEventShards,
  KIND_LABELS,
  CAVEAT_LABELS,
  kindLabelOf,
  caveatLabelOf,
} from './build-callsign-event-shards.ts';
import { foldEventTimeProjection, type EventTimeProjection } from './event-time-projection.ts';
import { deriveStateAtT, CAVEAT_GLOSSES, RULE_GLOSSES, EMPTY_STATE_CONTEXT } from './state-at-t.ts';
import { EVENT_DATE_KINDS } from '../v2/claim.ts';
import type { ResolvedLedgerSource } from '../v2/collectors/types.ts';
import type { SourceObservationSet } from '../v2/claim.ts';
import { parseJsonObject } from '../shared/json-shape.ts';

// The per-callsign event-shard builder (issue #726): fixtures run the REAL
// S1 emit + S3 derivation end to end (foldEventTimeProjection over synthetic
// sources, deriveStateAtT inside the builder), so what these tests pin is the
// same machinery the deploy runs. Test names follow Subject_Scenario_Outcome.

function fixtureSource(spec: {
  sourceFile: string;
  vintage: string;
  rows: { callsign: string; start?: string; cancel?: string }[];
}): ResolvedLedgerSource {
  const set: SourceObservationSet = {
    sourceFile: spec.sourceFile,
    vintage: spec.vintage,
    columns: ['Call Sign', 'Original Start Date', 'Licence Cancel Date'],
    subjectColumn: 'Call Sign',
    rows: spec.rows.map(row => ({
      'Call Sign': row.callsign,
      'Original Start Date': row.start ?? '',
      'Licence Cancel Date': row.cancel ?? '',
    })),
    columnInterpretations: [
      { type: 'callsign-token' },
      { type: 'date', format: 'DD/MM/YYYY' },
      { type: 'date', format: 'DD/MM/YYYY' },
    ],
    eventDateColumns: [
      { source: 'Original Start Date', kind: 'licence-version-original-start' },
      { source: 'Licence Cancel Date', kind: 'licence-cancelled' },
    ],
  };
  const [, dataset] = spec.sourceFile.split('/');
  return {
    family: 'foi-register',
    subjectKind: 'callsign',
    entry: dataset,
    sourceFile: spec.sourceFile,
    jsonlStem: dataset,
    load: () => set,
  };
}

// A small mixed corpus: M7AAA stable and corroborated across two vintages;
// G3SDS-shaped G3ZZZ revised wholesale by the later vintage (a vintages-
// disagree signal); G3YYY with a multi-row version window in one vintage.
function fixtureProjection(): EventTimeProjection {
  return foldEventTimeProjection({
    sources: [
      fixtureSource({
        sourceFile: 'foi/entry-a/reg.csv',
        vintage: '2020-05-01',
        rows: [
          { callsign: 'M7AAA', start: '20/12/2018' },
          { callsign: 'G3ZZZ', start: '09/07/1977' },
          { callsign: 'G3YYY', start: '01/03/1985' },
          { callsign: 'G3YYY', start: '15/06/1992' },
        ],
      }),
      fixtureSource({
        sourceFile: 'foi/entry-b/reg.csv',
        vintage: '2021-06-01',
        rows: [
          { callsign: 'M7AAA', start: '20/12/2018' },
          { callsign: 'G3ZZZ', start: '23/02/2021' },
        ],
      }),
    ],
  });
}

interface EventsMeta {
  schemaVersion: number;
  asAt: string;
  counts: { datasets: number; subjects: number; shards: number; unkeyableEventClaims: number };
  datasets: { lane: string; key: string; vintage: string; title: string; href: string }[];
  kinds: { id: string; label: string; contribution: string }[];
  rules: { id: string; gloss: string }[];
  caveats: { id: string; label: string; gloss: string }[];
  episodes: { start: string; end: string }[];
  seriesIntro: Record<string, string>;
  shards: string[];
}

type EventRecord = {
  e: [number, string, [number, number][], number?][];
  f: [number, string, number[], number[]][];
  g?: [number, [string, number[]][]][];
  w?: number;
};

function build(projection: EventTimeProjection): { dir: string; meta: EventsMeta; records: Map<string, EventRecord> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'event-shards-'));
  buildCallsignEventShards(projection, dir);
  const meta = parseJsonObject(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'), 'meta.json') as EventsMeta;
  const records = new Map<string, EventRecord>();
  for (const shard of meta.shards) {
    const parsed = parseJsonObject(fs.readFileSync(path.join(dir, `${shard}.json`), 'utf8'), `${shard}.json`) as { callsigns: Record<string, EventRecord> };
    for (const [key, record] of Object.entries(parsed.callsigns)) records.set(key, record);
  }
  return { dir, meta, records };
}

describe('callsign event shards (issue #726)', { tags: ['unit'] }, () => {
  it('EventShards_StableCorroboratedRecord_CarriesNoReissueSignals', () => {
    const { records } = build(fixtureProjection());
    const record = records.get('M7AAA');
    expect(record).toBeDefined();
    expect(record?.g).toBeUndefined();
    expect(record?.w).toBeUndefined();
  });

  it('EventShards_VintagesDisagreeOnAPastEvent_RecordListsBothCampsWithTheirDatasets', () => {
    const { meta, records } = build(fixtureProjection());
    const record = records.get('G3ZZZ');
    expect(record?.g).toBeDefined();
    const disagreements = record?.g ?? [];
    expect(disagreements).toHaveLength(1);
    const [kindIdx, camps] = disagreements[0];
    expect(meta.kinds[kindIdx].id).toBe('licence-version-original-start');
    expect(camps.map(([day]) => day)).toEqual(['1977-07-09', '2021-02-23']);
    // Both camps name their asserting datasets - surfaced, never resolved.
    expect(camps[0][1].map(idx => meta.datasets[idx].key)).toEqual(['entry-a']);
    expect(camps[1][1].map(idx => meta.datasets[idx].key)).toEqual(['entry-b']);
  });

  it('EventShards_OneVintageAssertsSeveralVersionRows_SetsTheMultiRowWindowSignal', () => {
    const { records } = build(fixtureProjection());
    expect(records.get('G3YYY')?.w).toBe(1);
  });

  it('EventShards_EveryFinding_ShipsANonEmptyStatementWithResolvableCaveats', () => {
    const { meta, records } = build(fixtureProjection());
    expect(records.size).toBeGreaterThan(0);
    for (const [key, record] of records) {
      expect(record.f.length, `${key} should carry findings`).toBeGreaterThan(0);
      for (const [ruleIdx, statement, caveatIdxs] of record.f) {
        expect(meta.rules[ruleIdx], `${key}: rule index ${ruleIdx}`).toBeDefined();
        expect(statement.trim().length, `${key}: statement must never be empty (issue #861 item 4)`).toBeGreaterThan(0);
        for (const caveatIdx of caveatIdxs) {
          expect(meta.caveats[caveatIdx], `${key}: caveat index ${caveatIdx}`).toBeDefined();
        }
      }
    }
  });

  it('EventShards_Findings_AreTheEngineOutputVerbatim', () => {
    const projection = fixtureProjection();
    const { meta, records } = build(projection);
    const rows = projection.rows.get('G3ZZZ');
    expect(rows).toBeDefined();
    const answer = deriveStateAtT(rows ?? [], { subject: 'G3ZZZ', t: meta.asAt }, EMPTY_STATE_CONTEXT);
    const record = records.get('G3ZZZ');
    expect(record?.f.map(([ruleIdx, statement]) => `${meta.rules[ruleIdx].id}: ${statement}`))
      .toEqual(answer.findings.map(f => `${f.rule}: ${f.statement}`));
    expect(record?.f.map(([, , caveatIdxs]) => caveatIdxs.map(idx => meta.caveats[idx].id)))
      .toEqual(answer.findings.map(f => [...f.caveats]));
  });

  it('EventShards_EvidenceLines_CarryAssertionTimeProvenancePerLine', () => {
    const { meta, records } = build(fixtureProjection());
    for (const [key, record] of records) {
      for (const [kindIdx, day, assertedBy] of record.e) {
        expect(meta.kinds[kindIdx], `${key}: kind index`).toBeDefined();
        expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(assertedBy.length, `${key}: every event-time line must name at least one asserting dataset`).toBeGreaterThan(0);
        for (const [dsIdx, nrows] of assertedBy) {
          expect(meta.datasets[dsIdx], `${key}: dataset index`).toBeDefined();
          expect(nrows).toBeGreaterThan(0);
        }
      }
    }
  });

  it('EventShards_BuiltTwiceOverTheSameProjection_AreByteIdentical', () => {
    const a = build(fixtureProjection());
    const b = build(fixtureProjection());
    const filesA = fs.readdirSync(a.dir).sort();
    expect(filesA).toEqual(fs.readdirSync(b.dir).sort());
    for (const file of filesA) {
      expect(fs.readFileSync(path.join(a.dir, file)).equals(fs.readFileSync(path.join(b.dir, file))), `${file} should be byte-identical`).toBe(true);
    }
  });

  it('EventShardsMeta_CoversEveryRuleCaveatAndKindWithNonEmptyGlosses', () => {
    const { meta } = build(fixtureProjection());
    expect(meta.kinds.map(k => k.id)).toEqual([...EVENT_DATE_KINDS]);
    expect(meta.rules.map(r => r.id)).toEqual([...RULE_GLOSSES.keys()]);
    expect(meta.caveats.map(c => c.id)).toEqual([...CAVEAT_GLOSSES.keys()]);
    for (const kind of meta.kinds) expect(kind.label.trim().length, kind.id).toBeGreaterThan(0);
    for (const rule of meta.rules) expect(rule.gloss.trim().length, rule.id).toBeGreaterThan(0);
    for (const caveat of meta.caveats) {
      expect(caveat.label.trim().length, caveat.id).toBeGreaterThan(0);
      expect(caveat.gloss.trim().length, caveat.id).toBeGreaterThan(0);
    }
  });

  it('EventShardsMeta_SeriesIntroMap_CarriesEachRecordedSeriesIntroductionMonth', () => {
    // Issue #921: the dial's series-introduction context marker reads meta.json,
    // so the builder must ship each prefix series' introduction month from
    // reference-data/prefix-formats.csv. Series with a recorded month appear;
    // series without one (the long-standing prefixes) are absent, never blank.
    const { meta } = build(fixtureProjection());
    expect(meta.seriesIntro.M7).toBe('2018-10');
    expect(meta.seriesIntro.M8).toBe('2025-10');
    expect(meta.seriesIntro.M9).toBe('2025-10');
    expect(meta.seriesIntro).not.toHaveProperty('M0');
    expect(meta.seriesIntro).not.toHaveProperty('G4');
    // Every recorded value is an ISO year-month, and the map is sorted so the
    // meta stays byte-deterministic across builds.
    for (const month of Object.values(meta.seriesIntro)) expect(month).toMatch(/^\d{4}-\d{2}$/);
    const keys = Object.keys(meta.seriesIntro);
    expect(keys).toEqual([...keys].sort());
  });

  it('KindAndCaveatLabels_AreTotalOverTheAuthoredVocabularies', () => {
    // Drift guards: adding an S1 kind or an engine caveat forces an authored
    // reader-facing label before the surfaces can ship it.
    for (const kind of EVENT_DATE_KINDS) expect(kindLabelOf(kind).length).toBeGreaterThan(0);
    expect([...KIND_LABELS.keys()].sort()).toEqual([...EVENT_DATE_KINDS].sort());
    for (const caveat of CAVEAT_GLOSSES.keys()) expect(caveatLabelOf(caveat).length).toBeGreaterThan(0);
    expect([...CAVEAT_LABELS.keys()].sort()).toEqual([...CAVEAT_GLOSSES.keys()].sort());
  });

  it('EventShards_BookkeepingNeverFeedsALicensingKindLabel', () => {
    // The kind labels must keep the epistemic ceiling inline: every
    // system-presence kind says "bookkeeping", and no licensing kind does.
    const { meta } = build(fixtureProjection());
    for (const kind of meta.kinds) {
      if (kind.contribution === 'system-presence') expect(kind.label).toMatch(/bookkeeping/);
      else expect(kind.label).not.toMatch(/bookkeeping/);
    }
  });
});
