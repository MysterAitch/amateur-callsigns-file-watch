import { describe, it, expect } from 'vitest';
import {
  decideVersionCheckPath,
  extractVersionParam,
} from './scrape';
import type { ScrapeOptions } from '../../shared/utils';

describe('extractVersionParam', () => {
  it('ExtractV_WhenTypicalOfcomUrl_ReturnsVValue', () => {
    const url = 'https://www.ofcom.org.uk/siteassets/resources/documents/manage-your-licence/amateur/amateur-callsign-list.csv?v=419818';
    expect(extractVersionParam(url)).toBe('419818');
  });

  it('ExtractV_WhenUrlHasMultipleQueryParams_ReturnsVValueOnly', () => {
    expect(extractVersionParam('https://example.com/x.csv?foo=bar&v=abc123&baz=quux')).toBe('abc123');
    expect(extractVersionParam('https://example.com/x.csv?v=abc123&other=stuff')).toBe('abc123');
  });

  it('ExtractV_WhenUrlHasNoVParam_ReturnsUndefined', () => {
    expect(extractVersionParam('https://example.com/x.csv')).toBeUndefined();
    expect(extractVersionParam('https://example.com/x.csv?other=thing')).toBeUndefined();
  });

  it('ExtractV_WhenUrlUndefined_ReturnsUndefined', () => {
    expect(extractVersionParam(undefined)).toBeUndefined();
  });
});

describe('decideVersionCheckPath', () => {
  const NOW = new Date('2026-07-05T12:00:00Z');

  describe('no prior state', () => {
    it('DecideVersion_WhenNoStateFields_ReturnsDownloadNew', () => {
      expect(decideVersionCheckPath('419818', undefined, NOW)).toBe('download-new');
      expect(decideVersionCheckPath('419818', {}, NOW)).toBe('download-new');
    });

    it('DecideVersion_WhenPartialState_ReturnsDownloadNew', () => {
      // All three lastKnown fields must be set for the fast-path to be trusted.
      const partial: ScrapeOptions = { lastKnownV: '419818' };
      expect(decideVersionCheckPath('419818', partial, NOW)).toBe('download-new');
    });
  });

  describe('v matches state', () => {
    const freshState: ScrapeOptions = {
      lastKnownV: '419818',
      lastKnownVContentHash: 'abc123',
      lastKnownVVerifiedAt: '2026-07-04T12:00:00Z', // 1 day ago
    };

    it('DecideVersion_WhenVMatchesAndRecentlyVerified_ReturnsSkipFastPath', () => {
      expect(decideVersionCheckPath('419818', freshState, NOW)).toBe('skip-fast-path');
    });

    it('DecideVersion_WhenVMatchesAndVerificationOlderThanInterval_ReturnsDownloadAndVerify', () => {
      const staleState: ScrapeOptions = {
        ...freshState,
        lastKnownVVerifiedAt: '2026-06-27T12:00:00Z', // 8 days ago, past default 7-day interval
      };
      expect(decideVersionCheckPath('419818', staleState, NOW)).toBe('download-and-verify');
    });

    it('DecideVersion_WhenVMatchesAndVerificationExactlyAtInterval_ReturnsDownloadAndVerify', () => {
      // Boundary: >= intervalDays should trigger verification.
      const boundaryState: ScrapeOptions = {
        ...freshState,
        lastKnownVVerifiedAt: '2026-06-28T12:00:00Z', // exactly 7 days
      };
      expect(decideVersionCheckPath('419818', boundaryState, NOW)).toBe('download-and-verify');
    });

    it('DecideVersion_WhenCustomIntervalSet_HonoursIt', () => {
      // 3-day interval should treat 4-day-old verification as stale.
      const state: ScrapeOptions = {
        ...freshState,
        lastKnownVVerifiedAt: '2026-07-01T12:00:00Z', // 4 days ago
        verificationIntervalDays: 3,
      };
      expect(decideVersionCheckPath('419818', state, NOW)).toBe('download-and-verify');
    });

    it('DecideVersion_WhenIntervalZero_AlwaysVerifies', () => {
      // A 0-day interval means "always verify" - useful for testing / paranoid mode.
      const state: ScrapeOptions = {
        ...freshState,
        lastKnownVVerifiedAt: NOW.toISOString(), // just verified
        verificationIntervalDays: 0,
      };
      expect(decideVersionCheckPath('419818', state, NOW)).toBe('download-and-verify');
    });
  });

  describe('v differs from state', () => {
    const state: ScrapeOptions = {
      lastKnownV: '419818',
      lastKnownVContentHash: 'abc123',
      lastKnownVVerifiedAt: '2026-07-04T12:00:00Z',
    };

    it('DecideVersion_WhenObservedVDiffersFromState_ReturnsDownloadNew', () => {
      expect(decideVersionCheckPath('419819', state, NOW)).toBe('download-new');
    });

    it('DecideVersion_WhenObservedVMissing_ReturnsDownloadNew', () => {
      // We can't fast-path if we don't know what v the current page is on.
      expect(decideVersionCheckPath(undefined, state, NOW)).toBe('download-new');
    });
  });
});
