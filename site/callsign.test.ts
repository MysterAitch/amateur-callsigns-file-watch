import { describe, it, expect } from 'vitest';
import {
  shardNameFor,
  datasetClassLabel,
  describeCell,
  seenSummary,
  latestSummary,
  twinConflict,
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

describe('twinConflict (cleaned-key twin conflict annotation, issue #633)', { tags: ['ui'] }, () => {
  // A manifest whose legend and product vocabulary cover the twin cases: O is
  // Allocated (the on-disk letter the real build assigns), A Available, R
  // Reserved. The latest register snapshot is index 1.
  function twinManifest() {
    const base = manifest();
    return {
      ...base,
      legend: { statuses: { O: 'Allocated', A: 'Available', R: 'Reserved' }, markers: base.legend.markers },
      vocab: { ...base.vocab, product: ['Amateur Foundation Radio Licence', 'Amateur Full Radio Licence'] },
    };
  }

  it('TwinConflict_WhenAbnormalVariantHoldsActiveLicenceAndCanonicalIsPool_LeadsWithTheInversionAndPoolRowCaveat', () => {
    // The G6FMU shape: the abnormal 'G6 FMU' row holds the active Full licence
    // (dated), the canonical form sits in the pool (Available, undated).
    const record = {
      h: '.!', l: { d: 1, s: ['O', 'A'], p: [1] },
      tw: [{ r: 'G6 FMU', s: 'O', m: '2025-10-11', p: 1 }, { r: 'G6FMU', s: 'A' }],
    };
    const c = twinConflict(record, 'G6FMU', twinManifest());
    expect(c).not.toBeNull();
    if (c === null) return;
    // Normal-form primacy: the canonical form leads the presentation order.
    expect(c.variants[0].normal).toBe(true);
    expect(c.variants[0].raw).toBe('G6FMU');
    expect(c.normalitySplit).toBe(true);
    // The abnormal variant carries the active, dated Full licence.
    const abnormal = c.variants.find(v => !v.normal);
    expect(abnormal?.status).toBe('Allocated');
    expect(abnormal?.product).toBe('Amateur Full Radio Licence');
    expect(abnormal?.modified).toBe('2025-10-11');
    // One dated, one undated: recency takes the pool-row caveat, not staleness.
    expect(c.recency.kind).toBe('partial');
  });

  it('TwinConflict_WhenBothRowsDatedAndDistinct_NamesTheMostRecentlyModifiedRow', () => {
    const record = {
      h: '.!', l: { d: 1, s: ['O', 'R'] },
      tw: [{ r: 'X1ABC', s: 'R', m: '2019-01-01' }, { r: 'X1ABC ', s: 'O', m: '2024-06-30' }],
    };
    const c = twinConflict(record, 'X1ABC', twinManifest());
    expect(c).not.toBeNull();
    if (c === null) return;
    expect(c.recency.kind).toBe('ordered');
    expect(c.recency.newest?.raw).toBe('X1ABC ');
    expect(c.recency.newest?.modified).toBe('2024-06-30');
  });

  it('TwinConflict_WhenVariantsAgreeOnStatus_ReturnsNullSoNoDoubtIsManufactured', () => {
    // G0TQK: listed twice, both Reserved. A duplicate, not a conflict.
    const record = {
      h: '.!', l: { d: 1, s: ['R'] },
      tw: [{ r: 'G0TQK', s: 'R' }, { r: 'G0TQK ', s: 'R' }],
    };
    expect(twinConflict(record, 'G0TQK', twinManifest())).toBeNull();
  });

  it('TwinConflict_WhenNoRowCarriesADate_StaysAPlainFlaggedConflict', () => {
    const record = {
      h: '.!', l: { d: 1, s: ['O', 'R'] },
      tw: [{ r: 'Z9ZZZ', s: 'R' }, { r: 'Z9 ZZZ', s: 'O' }],
    };
    const c = twinConflict(record, 'Z9ZZZ', twinManifest());
    expect(c).not.toBeNull();
    if (c === null) return;
    expect(c.recency.kind).toBe('none');
    expect(c.recency.newest).toBeNull();
  });

  it('TwinConflict_WhenNoTwinBreakdownExists_ReturnsNull', () => {
    expect(twinConflict({ h: '.A', l: { d: 1, s: ['A'] } }, 'M7TEE', twinManifest())).toBeNull();
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
