import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildCallsignShards, shardNameFor, MARKERS, type ShardBuildSummary, type ShardDataset } from './build-callsign-shards.ts';
import { DIRS } from '../shared/constants.ts';
import { listArchiveKeys } from '../shared/archive.ts';
import { buildFoiObservations } from '../shared/foi-observations.ts';
import { defaultFoiDir } from '../shared/foi-archive.ts';
import { parseCsvCached } from '../shared/parse-cache.ts';
import { cleanedCallsign } from '../sources/ofcom-amateur/components.ts';
import { parseJsonObject } from '../shared/json-shape.ts';
import { assertNonEmpty } from '../testing/non-vacuity.ts';

// The instant per-callsign projection built over the REAL archive (issue
// #594): the self-check the proposal committed to - the shards are a
// deterministic projection of the same canonical inputs the databases fold,
// so this suite asserts byte-determinism, count parity against an
// independently-recomputed derivation-source union, structural integrity of
// every record, and known spot rows (a plain callsign, the month-suffix
// Intermediate oddity, an RSL form, a stripped-collision twin).

interface Manifest {
  schemaVersion: number;
  counts: { datasets: number; callsigns: number; shards: number; unkeyableRows: number };
  legend: { statuses: Record<string, string>; markers: Record<string, string> };
  vocab: { product: string[]; type: string[]; impliedClass: string[] };
  shards: string[];
  datasets: ShardDataset[];
}

interface Record594 {
  h: string;
  l?: { d: number; s?: string[]; p?: number[]; t?: number[] };
  d?: { c?: string; m?: string; o?: string };
  a?: { ps?: string; pre?: string; rsl?: string; sfx?: string; ph?: string; hc?: string; ic?: number };
  f?: string[];
  v?: string[];
  tw?: { r: string; s?: string; m?: string; p?: number }[];
  m?: number[];
}

let outA: string;
let outB: string;
let summary: ShardBuildSummary;
let manifest: Manifest;
const shardRecords = new Map<string, Record<string, Record594>>();

function readJson<T>(dir: string, name: string): T {
  const filePath = path.join(dir, name);
  return parseJsonObject(fs.readFileSync(filePath, 'utf8'), filePath) as T;
}

function findRecord(cleaned: string): Record594 | undefined {
  const shard = shardNameFor(cleaned, new Set(manifest.shards));
  return shardRecords.get(shard)?.[cleaned];
}

beforeAll(() => {
  outA = fs.mkdtempSync(path.join(os.tmpdir(), 'callsign-shards-a-'));
  outB = fs.mkdtempSync(path.join(os.tmpdir(), 'callsign-shards-b-'));
  summary = buildCallsignShards(outA);
  buildCallsignShards(outB);
  manifest = readJson<Manifest>(outA, 'datasets.json');
  for (const shard of manifest.shards) {
    shardRecords.set(shard, readJson<{ shard: string; callsigns: Record<string, Record594> }>(outA, `${shard}.json`).callsigns);
  }
});

describe('callsign shards over the real archive', { tags: ['data-validity'] }, () => {
  it('ShardBuild_RunTwiceOverTheSameArchive_IsByteIdentical', () => {
    const filesA = assertNonEmpty(fs.readdirSync(outA).sort(), 'callsign shard files');
    const filesB = fs.readdirSync(outB).sort();
    expect(filesA).toEqual(filesB);
    for (const file of filesA) {
      const a = fs.readFileSync(path.join(outA, file));
      const b = fs.readFileSync(path.join(outB, file));
      expect(a.equals(b), `${file} should be byte-identical across builds`).toBe(true);
    }
  });

  it('ShardBuild_WholeCorpus_CallsignCountMatchesTheDerivationSourceUnion', () => {
    // Recompute the expected entity universe straight from the derivation
    // sources: every archived open-data normalised.csv plus every
    // callsign-bearing FOI normalised file, keyed by the cleaned form (the
    // exact inputs the builder folds - count parity, per the issue's
    // committed self-check).
    const expected = new Set<string>();
    for (const key of listArchiveKeys()) {
      const rows = parseCsvCached(path.join(DIRS.archive, key, 'normalised.csv'), { columns: true, skip_empty_lines: true });
      for (const row of rows) {
        const cleaned = cleanedCallsign(row.callsign ?? '');
        if (cleaned !== '') expected.add(cleaned);
      }
    }
    for (const row of buildFoiObservations(defaultFoiDir())) {
      const cleaned = cleanedCallsign(row.callsign);
      if (cleaned !== '') expected.add(cleaned);
    }
    expect(manifest.counts.callsigns).toBe(expected.size);

    let total = 0;
    for (const records of shardRecords.values()) total += Object.keys(records).length;
    expect(total).toBe(expected.size);
  });

  it('Manifest_DatasetList_IsVintageOrderedAndAccountsForEveryRow', () => {
    expect(manifest.datasets.length).toBe(manifest.counts.datasets);
    for (let i = 1; i < manifest.datasets.length; i += 1) {
      const previous = manifest.datasets[i - 1].vintage ?? '';
      const current = manifest.datasets[i].vintage ?? '';
      expect(previous <= current, `datasets must be vintage-ordered (${previous} then ${current})`).toBe(true);
    }
    for (const dataset of manifest.datasets) {
      expect(dataset.rows + dataset.unkeyable, `${dataset.key} should have folded at least one row`).toBeGreaterThan(0);
    }
    const unkeyable = manifest.datasets.reduce((sum, d) => sum + d.unkeyable, 0);
    expect(manifest.counts.unkeyableRows).toBe(unkeyable);
    // The archive is known to carry unaddressable callsign cells (e.g. a ','
    // token); they must be counted, never silently dropped.
    expect(unkeyable).toBeGreaterThan(0);
  });

  it('ShardRecords_EveryRecord_IsStructurallySoundAndIndexable', () => {
    const legalChars = new Set([...Object.keys(manifest.legend.statuses), ...Object.keys(MARKERS)]);
    const shardNames = new Set(manifest.shards);
    expect(shardRecords.size, 'shard records').toBeGreaterThan(0);
    for (const [shard, records] of shardRecords) {
      for (const [key, record] of Object.entries(records)) {
        expect(shardNameFor(key, shardNames), `${key} must live in the shard the resolution rule picks`).toBe(shard);
        expect(record.h.length, `${key} history length`).toBe(manifest.counts.datasets);
        for (const ch of record.h) {
          expect(legalChars.has(ch), `${key} history character '${ch}' must be in the legend`).toBe(true);
        }
        if (record.l !== undefined) {
          const dataset = manifest.datasets[record.l.d];
          expect(dataset, `${key} latest dataset index`).toBeDefined();
          expect(dataset.classes, `${key} latest must be a register snapshot`).toContain('register-snapshot');
          expect(record.h[record.l.d], `${key} must be present in its latest dataset`).not.toBe('.');
          for (const p of record.l.p ?? []) expect(manifest.vocab.product[p], `${key} product index ${p}`).toBeDefined();
          for (const t of record.l.t ?? []) expect(manifest.vocab.type[t], `${key} type index ${t}`).toBeDefined();
          for (const s of record.l.s ?? []) expect(manifest.legend.statuses[s], `${key} status letter ${s}`).toBeDefined();
        }
        const ic = record.a?.ic;
        if (ic !== undefined) expect(manifest.vocab.impliedClass[ic], `${key} implied-class index ${ic}`).toBeDefined();
        for (const index of record.m ?? []) {
          expect(record.h[index], `${key} multi-listing index ${index} must mark a present dataset`).not.toBe('.');
        }
      }
    }
  });

  it('Lookup_PlainFoundationCallsign_RoundTripsWithParsedComponentsAndLatestState', () => {
    const record = findRecord('M7TEE');
    expect(record).toBeDefined();
    if (record === undefined) return;
    expect(record.a?.pre).toBe('M7');
    expect(record.a?.sfx).toBe('TEE');
    expect(record.a?.ph).toBe('M#7TEE');
    expect(record.a?.ps).toBeUndefined(); // 'parsed' is the omitted default
    const ic = record.a?.ic;
    expect(ic).toBeDefined();
    if (ic !== undefined) expect(manifest.vocab.impliedClass[ic]).toBe('Foundation');
    expect(record.l).toBeDefined();
    const statuses = (record.l?.s ?? []).map(s => manifest.legend.statuses[s]);
    expect(statuses).toContain('Allocated');
    // The latest register observation must come from the newest register
    // dataset the callsign is present in.
    const latestIndex = record.l?.d ?? -1;
    for (let i = latestIndex + 1; i < record.h.length; i += 1) {
      if (manifest.datasets[i].classes.includes('register-snapshot')) {
        expect(record.h[i], `a register sighting after the declared latest (${manifest.datasets[i].key})`).toBe('.');
      }
    }
  });

  it('Lookup_MonthSuffixIntermediateOddity_KeepsTheSpreadsheetRenderedVariantVisible', () => {
    // 20APR is the known month-suffix Intermediate: spreadsheets have
    // published it re-rendered as the date "20-Apr". The projection keys the
    // canonical form and keeps the damaged rendering visible as a variant.
    const record = findRecord('20APR');
    expect(record).toBeDefined();
    if (record === undefined) return;
    expect(record.a?.pre).toBe('20');
    expect(record.a?.sfx).toBe('APR');
    expect(record.a?.ph).toBe('2#0APR');
    const ic = record.a?.ic;
    if (ic !== undefined) expect(manifest.vocab.impliedClass[ic]).toBe('Intermediate');
    expect(record.v).toContain('20-Apr');
  });

  it('Lookup_RslCarryingForm_KeepsTheLocatorComponentAndItsFlag', () => {
    // 2E0ADR: an Intermediate form published WITH its Regional Secondary
    // Locator (the register normally stores the RSL-less core), so the parse
    // carries rsl=E on series 20 and the rsl-in-register flag.
    const record = findRecord('2E0ADR');
    expect(record).toBeDefined();
    if (record === undefined) return;
    expect(record.a?.rsl).toBe('E');
    expect(record.a?.pre).toBe('20');
    expect(record.f).toContain('rsl-in-register');
  });

  it('Lookup_StrippedCollisionTwin_SurfacesVariantsAndMultiplicity', () => {
    // G6FMU coexists with its 'G6 FMU' twin row in real publications; both
    // clean to one key, and the projection surfaces the variant form and the
    // datasets that list the form more than once - never silently one winner.
    const record = findRecord('G6FMU');
    expect(record).toBeDefined();
    if (record === undefined) return;
    expect(record.v ?? []).toContain('G6 FMU');
    expect((record.m ?? []).length).toBeGreaterThan(0);
  });

  it('Lookup_StrippedCollisionTwin_CarriesTheLatestSnapshotConflictBreakdown', () => {
    // The twin breakdown (issue #633) records the latest register snapshot's
    // per-variant rows so the page can annotate the conflict: the abnormal
    // 'G6 FMU' spelling holds an Allocated Full licence with a modified date,
    // while the canonical form sits in the pool (Available) and is undated.
    const record = findRecord('G6FMU');
    expect(record).toBeDefined();
    if (record === undefined) return;
    const tw = record.tw ?? [];
    expect(tw.length).toBe(2);
    const abnormal = tw.find(t => t.r === 'G6 FMU');
    const normal = tw.find(t => t.r === 'G6FMU');
    expect(abnormal).toBeDefined();
    expect(normal).toBeDefined();
    if (abnormal === undefined || normal === undefined) return;
    // The abnormal twin is the Allocated, dated, Full-licence-bearing row.
    expect(abnormal.s !== undefined && manifest.legend.statuses[abnormal.s]).toBe('Allocated');
    expect(abnormal.m).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(abnormal.p !== undefined && manifest.vocab.product[abnormal.p]).toBe('Amateur Full Radio Licence');
    // The canonical form is the pool row: Available, undated (no `m`).
    expect(normal.s !== undefined && manifest.legend.statuses[normal.s]).toBe('Available');
    expect(normal.m).toBeUndefined();
  });

  it('Lookup_SecondLiveDisagreeingTwin_SurfacesTheSameInversion', () => {
    // G7IWE is the second currently-disagreeing group: the trailing-space
    // spelling holds the Allocated licence (dated) while the canonical form is
    // Reserved (a pool status, undated) - the same abnormal-holds-the-licence
    // shape as G6FMU.
    const record = findRecord('G7IWE');
    expect(record).toBeDefined();
    if (record === undefined) return;
    const tw = record.tw ?? [];
    const abnormal = tw.find(t => t.r !== 'G7IWE');
    const normal = tw.find(t => t.r === 'G7IWE');
    expect(abnormal).toBeDefined();
    expect(normal).toBeDefined();
    if (abnormal === undefined || normal === undefined) return;
    expect(abnormal.s !== undefined && manifest.legend.statuses[abnormal.s]).toBe('Allocated');
    expect(abnormal.m).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(normal.s !== undefined && manifest.legend.statuses[normal.s]).toBe('Reserved');
  });

  it('Lookup_AgreeingTwin_CarriesTheBreakdownButNoStatusDisagreement', () => {
    // G0TQK lists its cleaned form twice but both rows agree (Reserved): the
    // breakdown is present, yet the page must read no conflict from it (no
    // manufactured doubt).
    const record = findRecord('G0TQK');
    expect(record).toBeDefined();
    if (record === undefined) return;
    const tw = record.tw ?? [];
    expect(tw.length).toBeGreaterThan(1);
    const statuses = new Set(tw.map(t => (t.s !== undefined ? manifest.legend.statuses[t.s] : '')));
    expect([...statuses]).toEqual(['Reserved']);
  });

  it('Lookup_SingleMemberCallsign_HasNoTwinBreakdown', () => {
    // A callsign listed once in its latest snapshot carries no twin breakdown -
    // there is nothing to annotate.
    const record = findRecord('M7TEE');
    expect(record).toBeDefined();
    if (record === undefined) return;
    expect(record.tw).toBeUndefined();
  });

  it('ShardSizing_LargestShard_StaysFetchSized', () => {
    // The reason this page exists: one fetch must stay small. The largest
    // shard is bounded well under a megabyte raw (a few tens of KB gzipped).
    expect(summary.largestShard.bytes).toBeLessThan(1_000_000);
    expect(summary.shards).toBe(manifest.counts.shards);
  });
});
