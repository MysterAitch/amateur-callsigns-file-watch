import { describe, it, expect } from 'vitest';
import { shouldRunNow } from './scheduled-run';

// Test names follow Subject_Scenario_Outcome per project convention. The
// scheduled-run decision function is pure - state and a Date in, decision out -
// so it's exhaustively testable without any environment setup.

describe('shouldRunNow', () => {
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
