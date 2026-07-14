import { describe, it, expect } from 'vitest';
import {
  deriveSourceAuthority,
  authorityRank,
  AUTHORITY_ORDER,
} from './source-authority.ts';

// The canonical trust model, axis 2: authority is a pure, mechanical function
// of the lane a source lives in, and it never guesses UP when a provenance is
// ambiguous. Scenarios follow the Subject_Scenario_Outcome convention.

describe('deriveSourceAuthority', { tags: ['unit'] }, () => {
  it('OpenDataLane_WhenDateKeyedEntryDeclaresOfcomSource_ResolvesToOfficial', () => {
    const resolution = deriveSourceAuthority({ location: '2025-06-04', sourceKey: 'ofcom-amateur-callsigns' });
    expect(resolution).toEqual({ ok: true, lane: 'open-data', authority: 'Official' });
  });

  it('OpenDataLane_WhenLedgerSourceFile_ResolvesToOfficial', () => {
    // A ledger claim's sourceFile (opendata/<date>/raw.csv) names the same lane
    // as the archive directory, so one classifier serves metas and claims alike.
    const resolution = deriveSourceAuthority({ location: 'opendata/2026-06-23/raw.csv' });
    expect(resolution).toEqual({ ok: true, lane: 'open-data', authority: 'Official' });
  });

  it('FoiLane_WhenOfcomDisclosureLogEntry_ResolvesToFoi', () => {
    const resolution = deriveSourceAuthority({ location: 'foi/ofcom-2016-09-20--callsign-database', sourceKey: 'ofcom-foi' });
    expect(resolution).toEqual({ ok: true, lane: 'foi', authority: 'FOI' });
  });

  it('FoiLane_WhenWhatDoTheyKnowThread_ResolvesToFoi', () => {
    const resolution = deriveSourceAuthority({ location: 'foi/wdtk-1180568--licence-breakdown', sourceKey: 'wdtk-foi' });
    expect(resolution).toEqual({ ok: true, lane: 'foi', authority: 'FOI' });
  });

  it('ReferenceLane_WhenReferenceDataFile_ResolvesToReference', () => {
    const resolution = deriveSourceAuthority({ location: 'reference-data/itu-call-sign-series.csv' });
    expect(resolution).toEqual({ ok: true, lane: 'reference-data', authority: 'Reference' });
  });

  it('ProjectDerivedLane_WhenProjectDerivedLocation_ResolvesToSelf', () => {
    const resolution = deriveSourceAuthority({ location: 'project-derived/some-computed-view.csv' });
    expect(resolution).toEqual({ ok: true, lane: 'project-derived', authority: 'Self' });
  });

  it('CommunityLane_WhenCommunityLocation_ResolvesToCommunity', () => {
    const resolution = deriveSourceAuthority({ location: 'community/contributed-list.csv' });
    expect(resolution).toEqual({ ok: true, lane: 'community', authority: 'Community' });
  });

  // --- The anti-inflation guards: ambiguity is FLAGGED, never resolved up. ---

  it('OpenDataLane_WhenForeignSourceKeySmuggledIn_FlagsRatherThanRatingOfficial', () => {
    // A community CSV dropped into a date-keyed directory must NOT inherit the
    // open-data lane's Official rung. This is the specific inflation the net
    // exists to catch.
    const resolution = deriveSourceAuthority({ location: '2025-06-04', sourceKey: 'community-contributed' });
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.reason).toMatch(/inflate to Official/);
  });

  it('FoiLane_WhenUnrecognisedSourceKey_FlagsRatherThanGuessing', () => {
    const resolution = deriveSourceAuthority({ location: 'foi/some-entry', sourceKey: 'ofcom-amateur-callsigns' });
    expect(resolution.ok).toBe(false);
  });

  it('AnyLane_WhenLocationMatchesNoLane_FlagsAsUnclassified', () => {
    const resolution = deriveSourceAuthority({ location: 'mystery/entry' });
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.reason).toMatch(/no known lane/);
  });

  it('AnyLane_WhenLocationBlank_FlagsAsUnclassified', () => {
    expect(deriveSourceAuthority({ location: '' }).ok).toBe(false);
  });
});

describe('authorityRank', { tags: ['unit'] }, () => {
  it('Rungs_WhenRanked_OrderOfficialHighestSelfLowest', () => {
    expect(authorityRank('Official')).toBeLessThan(authorityRank('FOI'));
    expect(authorityRank('FOI')).toBeLessThan(authorityRank('Reference'));
    expect(authorityRank('Reference')).toBeLessThan(authorityRank('Community'));
    expect(authorityRank('Community')).toBeLessThan(authorityRank('Self'));
    expect(AUTHORITY_ORDER).toEqual(['Official', 'FOI', 'Reference', 'Community', 'Self']);
  });
});
