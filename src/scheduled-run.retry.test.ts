import { describe, it, expect, vi } from 'vitest';
import { retryOnce } from './scheduled-run.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// retryOnce guards the tick-start `git pull --ff-only` against the transient
// concurrent-pull race seen on 2026-07-10: a one-off failure is retried and
// swallowed, while a persistent failure still surfaces after one retry.

describe('retryOnce', { tags: ['unit'] }, () => {
  it('RetryOnce_WhenFirstCallSucceeds_ReturnsResultAndDoesNotRetry', () => {
    const onRetry = vi.fn();

    const result = retryOnce(() => 'ok', onRetry);

    expect(result).toBe('ok');
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('RetryOnce_WhenFirstFailsThenSecondSucceeds_ReturnsSecondResultAfterOneRetry', () => {
    const onRetry = vi.fn();
    let calls = 0;

    const result = retryOnce(() => {
      calls += 1;
      if (calls === 1) throw new Error('fetch updated the current branch head');
      return 'recovered';
    }, onRetry);

    expect(result).toBe('recovered');
    expect(calls).toBe(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('RetryOnce_WhenBothCallsFail_PropagatesSecondErrorAfterOneRetry', () => {
    const onRetry = vi.fn();
    let calls = 0;

    expect(() =>
      retryOnce(() => {
        calls += 1;
        throw new Error(`persistent failure ${calls}`);
      }, onRetry),
    ).toThrow('persistent failure 2');

    expect(calls).toBe(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
