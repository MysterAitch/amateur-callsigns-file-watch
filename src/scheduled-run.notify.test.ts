import { describe, it, expect } from 'vitest';
import { lxcServiceCommand, summariseGitError } from './scheduled-run.ts';

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
