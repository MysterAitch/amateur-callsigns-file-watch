import { describe, it, expect } from 'vitest';
import { shouldRunNow, shouldNotifyDrift, shouldNotifyGitFailure } from './scheduled-run.ts';

// Test names follow Subject_Scenario_Outcome per project convention. The
// scheduled-run decision function is pure - state and a Date in, decision out -
// so it's exhaustively testable without any environment setup.

describe('shouldRunNow', { tags: ['unit'] }, () => {
  const emptyState = { consecutiveFailures: 0 };

  describe('scheduled-window boundaries', () => {
    it('ShouldRunNow_WhenExactlyAtScheduledTime_Runs', () => {
      const at03 = new Date('2026-07-04T03:00:00');
      const decision = shouldRunNow(emptyState, at03);
      expect(decision.action).toBe('run');
      expect(decision.windowId).toBe('2026-07-04T03:00');
    });

    it('ShouldRunNow_WhenWithinLeadingEdgeOfWindow_Runs', () => {
      // 5 minutes before scheduled 03:00 slot - inside +/- 15-min window.
      const at0255 = new Date('2026-07-04T02:55:00');
      expect(shouldRunNow(emptyState, at0255).action).toBe('run');
    });

    it('ShouldRunNow_WhenWithinTrailingEdgeOfWindow_Runs', () => {
      // 14 minutes after 10:00 - still inside +/- 15-min window.
      const at1014 = new Date('2026-07-04T10:14:00');
      expect(shouldRunNow(emptyState, at1014).action).toBe('run');
    });

    it('ShouldRunNow_WhenJustOutsideLeadingWindow_Skips', () => {
      // 16 minutes before 03:00 - just outside the tolerance.
      const at0244 = new Date('2026-07-04T02:44:00');
      const decision = shouldRunNow(emptyState, at0244);
      expect(decision.action).toBe('skip');
      expect(decision.reason).toMatch(/not within any scheduled window/);
    });

    it('ShouldRunNow_WhenJustOutsideTrailingWindow_Skips', () => {
      // 16 minutes after 10:00 - just outside the tolerance.
      const at1016 = new Date('2026-07-04T10:16:00');
      expect(shouldRunNow(emptyState, at1016).action).toBe('skip');
    });

    it('ShouldRunNow_WhenFarFromAnyScheduledSlot_Skips', () => {
      // Midday is nowhere near any scheduled slot.
      const atMidday = new Date('2026-07-04T12:00:00');
      expect(shouldRunNow(emptyState, atMidday).action).toBe('skip');
    });
  });

  describe('already-ran deduplication within a window', () => {
    it('ShouldRunNow_WhenInWindowButAlreadyRanThisWindow_Skips', () => {
      const at1005 = new Date('2026-07-04T10:05:00');
      const state = { consecutiveFailures: 0, lastRunWindowId: '2026-07-04T10:00' };
      const decision = shouldRunNow(state, at1005);
      expect(decision.action).toBe('skip');
      expect(decision.reason).toContain('already ran');
    });

    it('ShouldRunNow_WhenPreviousWindowWasSameSlotYesterday_Runs', () => {
      // Same 18:00 slot as prior day - windowId differs by date, so we run.
      const nextDay = new Date('2026-07-05T18:00:00');
      const state = { consecutiveFailures: 0, lastRunWindowId: '2026-07-04T18:00' };
      expect(shouldRunNow(state, nextDay).action).toBe('run');
    });

    it('ShouldRunNow_WhenPreviousWindowWasEarlierSlotSameDay_Runs', () => {
      // Ran at 03:00, now at 10:00 - different slots, different windowIds,
      // second slot still fires.
      const at10 = new Date('2026-07-04T10:00:00');
      const state = { consecutiveFailures: 0, lastRunWindowId: '2026-07-04T03:00' };
      const decision = shouldRunNow(state, at10);
      expect(decision.action).toBe('run');
      expect(decision.windowId).toBe('2026-07-04T10:00');
    });
  });

  describe('all four scheduled slots fire independently', () => {
    it.each([
      ['03:00', new Date('2026-07-04T03:00:00')],
      ['10:00', new Date('2026-07-04T10:00:00')],
      ['14:00', new Date('2026-07-04T14:00:00')],
      ['18:00', new Date('2026-07-04T18:00:00')],
    ])('ShouldRunNow_WhenAt%s_Runs', (_label, when) => {
      expect(shouldRunNow(emptyState, when).action).toBe('run');
    });
  });

  describe('14:00 slot specifically halves the 10:00-18:00 gap', () => {
    it('ShouldRunNow_WhenAtMidday_StillSkips', () => {
      // 12:00 is >15 min from both 10:00 and 14:00 so it's outside both windows.
      const at1200 = new Date('2026-07-04T12:00:00');
      expect(shouldRunNow(emptyState, at1200).action).toBe('skip');
    });

    it('ShouldRunNow_WhenAt14ColonLeadingEdge_Runs', () => {
      // 13:45 is exactly at the leading edge of the 14:00 window.
      const at1345 = new Date('2026-07-04T13:45:00');
      const decision = shouldRunNow(emptyState, at1345);
      expect(decision.action).toBe('run');
      expect(decision.windowId).toBe('2026-07-04T14:00');
    });
  });

  describe('windowId provenance in decision', () => {
    it('ShouldRunNow_WhenRunning_ReturnsCanonicalWindowId', () => {
      const at18 = new Date('2026-11-01T18:07:00');
      const decision = shouldRunNow(emptyState, at18);
      expect(decision.windowId).toBe('2026-11-01T18:00');
    });
  });
});

describe('shouldNotifyDrift', { tags: ['unit'] }, () => {
  const NOW = new Date('2026-07-06T12:00:00Z');
  const drift = { drifted: true, fingerprint: 'abc123', summary: 'foo.service' };

  it('ShouldNotifyDrift_WhenNotDrifted_DoesNotNotify', () => {
    const nodrift = { drifted: false, fingerprint: '', summary: '' };
    expect(shouldNotifyDrift(nodrift, undefined, undefined, NOW).notify).toBe(false);
    // Even if a prior notify exists, resolution = quiet
    expect(shouldNotifyDrift(nodrift, 'old', '2026-07-05T12:00:00Z', NOW).notify).toBe(false);
  });

  it('ShouldNotifyDrift_WhenDriftedForFirstTime_Notifies', () => {
    const decision = shouldNotifyDrift(drift, undefined, undefined, NOW);
    expect(decision.notify).toBe(true);
    expect(decision.reason).toMatch(/no prior notify recorded|new or changed/);
  });

  it('ShouldNotifyDrift_WhenFingerprintChanged_NotifiesEvenIfRecentlyNotified', () => {
    // We notified 1h ago about a different drift; now a fresh fingerprint
    // means a genuinely-new drift state - notify again immediately.
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60_000).toISOString();
    const decision = shouldNotifyDrift(drift, 'different-fp', oneHourAgo, NOW);
    expect(decision.notify).toBe(true);
    expect(decision.reason).toBe('new or changed drift state');
  });

  it('ShouldNotifyDrift_WhenSameFingerprintAndRecentlyNotified_Suppresses', () => {
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60_000).toISOString();
    const decision = shouldNotifyDrift(drift, 'abc123', oneHourAgo, NOW);
    expect(decision.notify).toBe(false);
    expect(decision.reason).toMatch(/< 24h/);
  });

  it('ShouldNotifyDrift_WhenSameFingerprintButLastNotifyOver24hAgo_Notifies', () => {
    const yesterday = new Date(NOW.getTime() - 25 * 60 * 60_000).toISOString();
    const decision = shouldNotifyDrift(drift, 'abc123', yesterday, NOW);
    expect(decision.notify).toBe(true);
    expect(decision.reason).toMatch(/since last notify/);
  });

  it('ShouldNotifyDrift_WhenExactly24hSinceLastNotify_Notifies', () => {
    // Boundary: >= 24h triggers.
    const exactly24h = new Date(NOW.getTime() - 24 * 60 * 60_000).toISOString();
    expect(shouldNotifyDrift(drift, 'abc123', exactly24h, NOW).notify).toBe(true);
  });

  it('ShouldNotifyDrift_WhenSlightlyUnder24h_Suppresses', () => {
    // Just under the boundary - still within suppression window.
    const almost24h = new Date(NOW.getTime() - 23.9 * 60 * 60_000).toISOString();
    expect(shouldNotifyDrift(drift, 'abc123', almost24h, NOW).notify).toBe(false);
  });
});

describe('shouldNotifyGitFailure', { tags: ['unit'] }, () => {
  const NOW = new Date('2026-07-06T12:00:00Z');
  const FP = 'a1b2c3d4e5f6';

  it('ShouldNotifyGitFailure_WhenFirstObservation_Notifies', () => {
    const decision = shouldNotifyGitFailure(FP, undefined, undefined, NOW);
    expect(decision.notify).toBe(true);
    expect(decision.reason).toMatch(/new or changed failure|no prior notify/);
  });

  it('ShouldNotifyGitFailure_WhenFingerprintChanged_NotifiesEvenIfRecentlyNotified', () => {
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60_000).toISOString();
    const decision = shouldNotifyGitFailure(FP, 'different-fp', oneHourAgo, NOW);
    expect(decision.notify).toBe(true);
    expect(decision.reason).toBe('new or changed failure');
  });

  it('ShouldNotifyGitFailure_WhenSameFingerprintAndRecentlyNotified_Suppresses', () => {
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60_000).toISOString();
    const decision = shouldNotifyGitFailure(FP, FP, oneHourAgo, NOW);
    expect(decision.notify).toBe(false);
    expect(decision.reason).toMatch(/< 24h/);
  });

  it('ShouldNotifyGitFailure_WhenSameFingerprintButOver24hSinceLastNotify_Notifies', () => {
    const yesterday = new Date(NOW.getTime() - 25 * 60 * 60_000).toISOString();
    const decision = shouldNotifyGitFailure(FP, FP, yesterday, NOW);
    expect(decision.notify).toBe(true);
    expect(decision.reason).toMatch(/since last notify/);
  });

  it('ShouldNotifyGitFailure_WhenExactly24h_Notifies', () => {
    const exactly24h = new Date(NOW.getTime() - 24 * 60 * 60_000).toISOString();
    expect(shouldNotifyGitFailure(FP, FP, exactly24h, NOW).notify).toBe(true);
  });
});
