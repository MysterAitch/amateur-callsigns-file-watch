import { describe, it, expect } from 'vitest';
import {
  shardNameFor,
  datasetClassLabel,
  describeCell,
  seenSummary,
  latestSummary,
} from './callsign.js';

// The instant per-callsign page's pure shaping layer (issue #594): the
// shard-resolution rule the client mirrors from the builder, and the
// manifest-driven humanisation of the compact record. All DOM-free, so they
// are pinned here without a browser. Test names follow Subject_Scenario_Outcome
// per project convention.

// A minimal manifest fixture in the builder's shape: four datasets spanning
// both lanes and the scope-declaration states the absence phrasing must
// distinguish.
function dataset(overrides: Record<string, unknown> = {}) {
  return {
    key: 'open-data--2026-01-01',
    lane: 'open-data' as const,
    entry: '2026-01-01',
    file: null,
    vintage: '2026-01-01',
    title: 'Ofcom open data, 2026-01-01',
    classes: ['register-snapshot'],
    href: 'datasets/open-data/2026-01-01/index.html',
    rows: 10,
    unkeyable: 0,
    intendedComplete: null,
    scopeNotes: '',
    coverageNote: '',
    ...overrides,
  };
}

function manifest() {
  return {
    schemaVersion: 1,
    counts: { datasets: 4, callsigns: 3, shards: 2, unkeyableRows: 0 },
    legend: {
      statuses: { A: 'Allocated', R: 'Reserved' },
      markers: { '.': '', '?': '', '-': '', '!': '' },
    },
    vocab: {
      product: ['Amateur Foundation Radio Licence', 'Amateur Full Radio Licence'],
      type: ['Call Sign - Amateur'],
      impliedClass: ['Foundation', 'Full', 'Intermediate'],
    },
    shards: ['M7', 'M7T', 'G0', 'irregular'],
    datasets: [
      dataset({ key: 'foi--pool', lane: 'foi' as const, vintage: '2014-01-01', classes: ['available-pool'], title: 'wdtk-pool' }),
      dataset({ key: 'foi--register', lane: 'foi' as const, vintage: '2016-09-20', classes: ['register-snapshot'], title: 'ofcom-2016' }),
      dataset({ key: 'open-data--2025-06-04', vintage: '2025-06-04', intendedComplete: true, coverageNote: 'Rows with a blank product field were omitted.' }),
      dataset({ intendedComplete: true }),
    ],
  };
}

describe('shardNameFor (client mirror of the builder rule)', { tags: ['ui'] }, () => {
  const shards = new Set(['M7', 'M7T', 'G0', 'irregular']);

  it('ShardResolution_WhenThreeCharChildExists_PrefersIt', () => {
    expect(shardNameFor('M7TEE', shards)).toBe('M7T');
  });

  it('ShardResolution_WhenOnlyTwoCharBucketExists_UsesIt', () => {
    expect(shardNameFor('M7AAA', shards)).toBe('M7');
    expect(shardNameFor('G0TQK', shards)).toBe('G0');
  });

  it('ShardResolution_WhenPrefixUnknownOrIrregular_FallsBackToIrregularBucket', () => {
    expect(shardNameFor('ZZ9ZZ', shards)).toBe('irregular');
    expect(shardNameFor('M/F1ABC', shards)).toBe('irregular');
    expect(shardNameFor('C', shards)).toBe('irregular');
    expect(shardNameFor('', shards)).toBe('irregular');
  });
});

describe('describeCell (scope-aware sighting phrasing)', { tags: ['ui'] }, () => {
  const m = manifest();

  it('Absence_InUndeclaredScopePublication_IsNotEvidence', () => {
    const cell = describeCell('.', m.datasets[1], m);
    expect(cell.kind).toBe('absent');
    expect(cell.detail).toMatch(/not evidence/i);
  });

  it('Absence_InDeclaredCompletePublication_IsALeadNotProof', () => {
    const cell = describeCell('.', m.datasets[3], m);
    expect(cell.kind).toBe('absent');
    expect(cell.detail).toMatch(/lead/i);
    expect(cell.detail).toMatch(/intent, not verified fact/i);
  });

  it('Absence_WhereAVerifiedObservationSaysRecordsWereOmitted_OverridesTheCompletenessDeclaration', () => {
    const cell = describeCell('.', m.datasets[2], m);
    expect(cell.detail).toMatch(/omits records/i);
    expect(cell.detail).toContain('Rows with a blank product field were omitted.');
  });

  it('Presence_InAnAvailabilityList_ReadsAsAvailableNotLicensed', () => {
    const cell = describeCell('?', m.datasets[0], m);
    expect(cell.text).toMatch(/available \(not licensed\)/i);
  });

  it('Presence_WithAStatusLetter_ResolvesThroughTheLegend', () => {
    const cell = describeCell('A', m.datasets[1], m);
    expect(cell.kind).toBe('status');
    expect(cell.text).toBe('Allocated');
  });

  it('Presence_WithDisagreeingStatuses_IsSurfacedAsAConflictNeverResolved', () => {
    const cell = describeCell('!', m.datasets[1], m);
    expect(cell.kind).toBe('conflict');
    expect(cell.detail).toMatch(/neither is picked/i);
  });
});

describe('seenSummary / latestSummary (record resolution)', { tags: ['ui'] }, () => {
  const m = manifest();

  it('SeenSummary_AcrossMixedSightings_CountsPresenceAndRegisterSnapshotsSeparately', () => {
    const record = { h: '?A.R' };
    const summary = seenSummary(record, m);
    expect(summary.present).toBe(3);
    expect(summary.registerPresent).toBe(2);
    expect(summary.first?.vintage).toBe('2014-01-01');
    expect(summary.last?.vintage).toBe('2026-01-01');
  });

  it('LatestSummary_WithARegisterObservation_ResolvesLegendAndVocabularies', () => {
    const record = { h: '.A.A', l: { d: 3, s: ['A'], p: [0], t: [0] } };
    const latest = latestSummary(record, m);
    expect(latest?.statuses).toEqual(['Allocated']);
    expect(latest?.products).toEqual(['Amateur Foundation Radio Licence']);
    expect(latest?.types).toEqual(['Call Sign - Amateur']);
    expect(latest?.dataset.vintage).toBe('2026-01-01');
  });

  it('LatestSummary_WhenNeverSeenInARegisterSnapshot_IsNull', () => {
    expect(latestSummary({ h: '?...' }, m)).toBeNull();
  });
});

describe('datasetClassLabel', { tags: ['ui'] }, () => {
  it('ClassLabel_KnownVocabulary_ReadsAsPlainEnglish', () => {
    const m = manifest();
    expect(datasetClassLabel(m.datasets[0])).toBe('availability list');
    expect(datasetClassLabel(m.datasets[1])).toBe('register snapshot');
  });

  it('ClassLabel_UnknownClass_FallsBackToItsOwnTokenNotAnInventedLabel', () => {
    expect(datasetClassLabel(dataset({ classes: ['some-new-class'] }))).toBe('some-new-class');
  });
});
