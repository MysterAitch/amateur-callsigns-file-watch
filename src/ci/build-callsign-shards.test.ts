import { describe, it, expect } from 'vitest';
import { shardBucketOf, shardNameFor, partitionShards, MARKERS, SHARD_SPLIT_THRESHOLD, foiSources } from './build-callsign-shards.ts';
import { defaultFoiDir } from '../shared/foi-archive.ts';

// The sharding rules of the instant per-callsign projection (issue #594),
// pinned on fixtures: the two-character bucket, the hot-bucket subdivision,
// and the longest-prefix resolution the client mirrors. The full-corpus build
// (determinism, count parity, spot rows) lives in
// build-callsign-shards.corpus.test.ts, in the heavy pool.

describe('callsign shard partitioning', { tags: ['unit'] }, () => {
  it('ShardBucket_RegularCallsign_IsItsFirstTwoCharacters', () => {
    expect(shardBucketOf('M7TEE')).toBe('M7');
    expect(shardBucketOf('2E0ADR')).toBe('2E');
    expect(shardBucketOf('G0TQK')).toBe('G0');
  });

  it('ShardBucket_IrregularForm_FallsBackToTheIrregularBucket', () => {
    expect(shardBucketOf('M/F1ABC')).toBe('irregular'); // visitor rendering: '/' in position 2
    expect(shardBucketOf('C')).toBe('irregular'); // single character
    expect(shardBucketOf('')).toBe('irregular');
  });

  it('Partition_BucketWithinThreshold_StaysOneShard', () => {
    const keys = ['G0AAA', 'G0AAB', 'G0AAC'].sort();
    const shards = partitionShards(keys, 5);
    expect([...shards.keys()]).toEqual(['G0']);
    expect(shards.get('G0')).toEqual(keys);
  });

  it('Partition_HotBucket_SplitsByThirdCharacterWithResidueInTheParent', () => {
    const keys = ['M7', 'M7AAA', 'M7AAB', 'M7BAA', 'M7BAB', 'M7CAA'].sort();
    const shards = partitionShards(keys, 3);
    // The two-character residue keeps the parent name; children carry the
    // third character.
    expect(shards.get('M7')).toEqual(['M7']);
    expect(shards.get('M7A')).toEqual(['M7AAA', 'M7AAB']);
    expect(shards.get('M7B')).toEqual(['M7BAA', 'M7BAB']);
    expect(shards.get('M7C')).toEqual(['M7CAA']);
  });

  it('Partition_IrregularBucket_IsNeverSubdivided', () => {
    const keys = Array.from({ length: 10 }, (_, i) => `M/HOME${i}`).sort();
    const shards = partitionShards(keys, 3);
    expect([...shards.keys()]).toEqual(['irregular']);
  });

  it('ShardResolution_EveryPartitionedKey_ResolvesBackToItsOwnShard', () => {
    const keys = ['M7', 'M7AAA', 'M7AAB', 'M7BAA', 'G0TQK', 'M/F1ABC', 'C'].sort();
    const shards = partitionShards(keys, 2);
    const names = new Set(shards.keys());
    for (const [shard, members] of shards) {
      for (const key of members) {
        expect(shardNameFor(key, names), `${key} should resolve to ${shard}`).toBe(shard);
      }
    }
  });

  it('Markers_ReservedCharacters_StayDisjointFromAnyPlausibleStatusLetter', () => {
    // The history string's marker characters are outside [A-Z0-9], the space
    // status letters are assigned from, so a status can never collide with a
    // marker.
    for (const marker of Object.keys(MARKERS)) {
      expect(/[A-Z0-9]/.test(marker)).toBe(false);
    }
  });

  it('SplitThreshold_IsSizedForInstantFetches', () => {
    // A guard against accidental order-of-magnitude regressions: the whole
    // point of the sharding is that one fetch stays small.
    expect(SHARD_SPLIT_THRESHOLD).toBeLessThanOrEqual(5000);
  });
});

describe('FOI dataset titles over the real archive (issue #954)', { tags: ['unit'] }, () => {
  // A disagreement narrative or an event's assertion-time provenance fold
  // names the publication a reader recognises, never the raw archive entry
  // key it is filed under (canonical-at-rest / presentation-at-the-edge). The
  // key itself stays the traceable `entry`/`href` identifier.
  const sources = foiSources(defaultFoiDir());

  it('FoiSources_KnownEntry_TitleIsTheFriendlyPublicationNameNotTheRawEntryKey', () => {
    const wdtk1180568 = sources.filter(s => s.dataset.entry === 'wdtk-1180568--licence-breakdown-duration-age');
    expect(wdtk1180568.length).toBeGreaterThan(0);
    for (const source of wdtk1180568) {
      expect(source.dataset.title).toBe('Radio amateur licence breakdown by duration held and age');
    }
  });

  it('FoiSources_EveryEntry_TitleNeverEqualsTheRawEntryKey', () => {
    for (const source of sources) {
      expect(source.dataset.title, `entry "${source.dataset.entry}" should carry a friendly title, not its raw key`).not.toBe(source.dataset.entry);
    }
  });
});
