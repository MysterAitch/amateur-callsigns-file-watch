import { describe, it, expect } from 'vitest';
import {
  composeHeldReminder,
  decideHeldReminder,
  lxcServiceCommand,
  summariseGitError,
} from './scheduled-run.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// These cover the two failure-notification helpers: the operator-facing
// command an alert tells you to run, and the message an alert shows for a
// failed git op. Both were wrong for the 2026-07-10 concurrent-pull race -
// the suggested command ran git in the wrong directory, and the message
// surfaced a benign warning instead of the real cause.

describe('lxcServiceCommand', { tags: ['unit'] }, () => {
  it('LxcServiceCommand_WhenBuildingInvestigationCommand_PutsCdInsideLoginShell', () => {
    const command = lxcServiceCommand('git status');

    // `su - <user>` is a login shell that resets cwd to the user's home, so the
    // cd must be inside -c. A cd placed before `su` would run in the caller's
    // shell and be discarded, leaving git in the wrong directory.
    expect(command).toBe(
      "su -s /bin/bash - callsign-data-mirror -c 'cd /opt/amateur-callsigns-file-watch && git status'",
    );
  });

  it('LxcServiceCommand_WhenBuildingInvestigationCommand_DoesNotCdBeforeSu', () => {
    const command = lxcServiceCommand('git pull --ff-only');

    // Regression guard for the original bug: the cd must not sit ahead of `su`.
    expect(command.startsWith('cd ')).toBe(false);
    expect(command.indexOf('cd /opt')).toBeGreaterThan(command.indexOf(' -c '));
  });
});

describe('summariseGitError', { tags: ['unit'] }, () => {
  it('SummariseGitError_WhenStderrLeadsWithWarnings_SurfacesTheFatalLine', () => {
    // The exact shape of the 2026-07-10 race: git prints the warning first,
    // then the real reason. The alert must show the reason, not the warning.
    const stderr = [
      'warning: fetch updated the current branch head.',
      'warning: fast-forwarding your working tree from',
      'fatal: Not possible to fast-forward, aborting.',
    ].join('\n');

    expect(summariseGitError(stderr)).toBe('fatal: Not possible to fast-forward, aborting.');
  });

  it('SummariseGitError_WhenErrorLinePresent_PrefersItOverWarnings', () => {
    const stderr =
      'warning: something benign\nerror: Your local changes would be overwritten by merge';

    expect(summariseGitError(stderr)).toBe(
      'error: Your local changes would be overwritten by merge',
    );
  });

  it('SummariseGitError_WhenOnlyWarnings_FallsBackToLastNonEmptyLine', () => {
    const stderr = 'warning: fetch updated the current branch head.\n\n';

    expect(summariseGitError(stderr)).toBe('warning: fetch updated the current branch head.');
  });

  it('SummariseGitError_WhenEmpty_ReturnsPlaceholder', () => {
    expect(summariseGitError('')).toBe('(no error message)');
    expect(summariseGitError('   \n  \n')).toBe('(no error message)');
  });
});

// The reminder for a publication that has not reached main. Every scenario
// names its own clock, so the expected outcome is decided before the call.
describe('decideHeldReminder', { tags: ['unit'] }, () => {
  const authoredAt = new Date('2026-09-22T16:00:00Z');
  const held = { count: 1, oldestSubject: 'Update amateur callsigns CSV', oldestAuthoredAt: authoredAt };
  const hoursAfter = (hours: number): Date => new Date(authoredAt.getTime() + hours * 3_600_000);

  it('HeldReminder_WhenNothingIsHeld_StaysSilent', () => {
    expect(decideHeldReminder({ count: 0 }, undefined, hoursAfter(500)).notify).toBe(false);
  });

  it('HeldReminder_WhenDetectionDidNotApply_StaysSilent', () => {
    expect(decideHeldReminder(null, undefined, hoursAfter(500)).notify).toBe(false);
  });

  it('HeldReminder_WhenHeldLessThanADay_StaysSilent', () => {
    // The landing itself was announced; a pull request that merges within the
    // day needs no second message.
    expect(decideHeldReminder(held, undefined, hoursAfter(23.9)).notify).toBe(false);
  });

  it('HeldReminder_WhenHeldExactlyADay_RemindsAtDefaultPriority', () => {
    expect(decideHeldReminder(held, undefined, hoursAfter(24))).toMatchObject({
      notify: true,
      priority: 'default',
    });
  });

  it('HeldReminder_WhenHeldJustUnderThreeDays_IsStillDefaultPriority', () => {
    expect(decideHeldReminder(held, undefined, hoursAfter(71.9))).toMatchObject({
      notify: true,
      priority: 'default',
    });
  });

  it('HeldReminder_WhenHeldThreeDays_EscalatesToHighPriority', () => {
    expect(decideHeldReminder(held, undefined, hoursAfter(72))).toMatchObject({
      notify: true,
      priority: 'high',
    });
  });

  it('HeldReminder_WhenRemindedLessThanADayAgo_StaysSilent', () => {
    const lastReminded = hoursAfter(24).toISOString();

    expect(decideHeldReminder(held, lastReminded, hoursAfter(47.9)).notify).toBe(false);
  });

  it('HeldReminder_WhenRemindedADayAgo_RemindsAgain', () => {
    const lastReminded = hoursAfter(24).toISOString();

    expect(decideHeldReminder(held, lastReminded, hoursAfter(48)).notify).toBe(true);
  });

  it('HeldReminder_WhenHeldForTwoMonths_IsStillRemindingAtHighPriority', () => {
    // 22 September to 24 November 2026: the wait this reminder exists for.
    const lastReminded = hoursAfter(63 * 24 - 24).toISOString();

    expect(decideHeldReminder(held, lastReminded, hoursAfter(63 * 24))).toMatchObject({
      notify: true,
      priority: 'high',
    });
  });

  it('HeldReminder_WhenTheStoredReminderTimeIsUnreadable_RemindsRatherThanStaySilent', () => {
    expect(decideHeldReminder(held, 'not a timestamp', hoursAfter(30)).notify).toBe(true);
  });

  it('HeldReminder_WhenTheHostClockIsBehindTheCommit_StaysSilent', () => {
    expect(decideHeldReminder(held, undefined, hoursAfter(-5)).notify).toBe(false);
  });
});

describe('composeHeldReminder', { tags: ['unit'] }, () => {
  const authoredAt = new Date('2026-09-22T16:00:00Z');
  const hoursAfter = (hours: number): Date => new Date(authoredAt.getTime() + hours * 3_600_000);

  it('HeldReminderMessage_WhenOnePublicationHeldThreeDays_NamesItAndTheWait', () => {
    const message = composeHeldReminder(
      { count: 1, oldestSubject: 'Update amateur callsigns CSV (Ofcom updated: 2026-09-22)', oldestAuthoredAt: authoredAt },
      hoursAfter(75),
    );

    expect(message.title).toBe('Ofcom publication not on main after 3 days');
    expect(message.body).toContain('"Update amateur callsigns CSV (Ofcom updated: 2026-09-22)"');
    expect(message.body).toContain('3 days 3 hours');
  });

  it('HeldReminderMessage_WhenHeldJustOverOneDay_UsesTheSingular', () => {
    const message = composeHeldReminder(
      { count: 1, oldestSubject: 'a publication', oldestAuthoredAt: authoredAt },
      hoursAfter(25),
    );

    expect(message.title).toBe('Ofcom publication not on main after 1 day');
    expect(message.body).toContain('1 day 1 hour');
  });

  it('HeldReminderMessage_WhenSeveralAreHeld_SaysHowManyAndNamesTheOldest', () => {
    const message = composeHeldReminder(
      { count: 3, oldestSubject: 'the oldest publication', oldestAuthoredAt: authoredAt },
      hoursAfter(240),
    );

    expect(message.title).toBe('3 Ofcom publications not on main, the oldest after 10 days');
    expect(message.body).toContain('"the oldest publication"');
  });
});
