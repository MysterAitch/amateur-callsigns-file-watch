import { describe, it, expect } from 'vitest';
import { runBounded, runTaskInWorker } from './report-sweep-pool.ts';

// The report sweep's worker-pool scheduling (issue #929). runBounded is the pure
// bounded-concurrency core (no worker specifics), so its bounding, ordering and
// error propagation are tested here with plain async functions; runTaskInWorker's
// worker-lifecycle contract is exercised against a trivial fixture worker rather
// than the real (DuckDB-backed, minutes-long) sweep generators. Test names follow
// Subject_Scenario_Outcome.

const FIXTURE_WORKER = new URL('./report-sweep-pool.fixture-worker.ts', import.meta.url);

// A deferred promise plus a manual delay, to control exactly when each fake task
// settles and observe how many run at once.
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('report sweep worker pool', { tags: ['unit'] }, () => {
  it('RunBounded_MoreItemsThanLanes_RunsEveryItemExactlyOnce', async () => {
    const items = [10, 20, 30, 40, 50];
    const seen: number[] = [];
    const results = await runBounded(items, 2, async (item) => {
      seen.push(item);
      await delay(1);
      return item * 2;
    });
    // Every item ran once (order of starts is not asserted - concurrency reorders
    // it), and results are returned in ITEM order regardless of finish order.
    expect(seen.sort((a, b) => a - b)).toEqual(items);
    expect(results).toEqual([20, 40, 60, 80, 100]);
  });

  it('RunBounded_ConcurrencyCap_IsNeverExceeded', async () => {
    let active = 0;
    let peak = 0;
    await runBounded(Array.from({ length: 12 }, (_unused, i) => i), 3, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await delay(5);
      active -= 1;
    });
    // Three lanes requested over twelve items: at most three ever run together.
    expect(peak).toBe(3);
  });

  it('RunBounded_ConcurrencyAboveItemCount_UsesOneLanePerItemNotMore', async () => {
    let active = 0;
    let peak = 0;
    await runBounded([1, 2], 16, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await delay(5);
      active -= 1;
    });
    // Lanes clamp to the item count, so two items never spawn sixteen lanes.
    expect(peak).toBe(2);
  });

  it('RunBounded_EmptyItems_ResolvesToEmptyWithoutRunningTheWorker', async () => {
    let calls = 0;
    const results = await runBounded([], 4, () => {
      calls += 1;
      return Promise.resolve(1);
    });
    expect(results).toEqual([]);
    expect(calls).toBe(0);
  });

  it('RunBounded_AWorkerRejects_SurfacesThatErrorAndStopsStartingNewItems', async () => {
    const started: number[] = [];
    await expect(
      runBounded([1, 2, 3, 4, 5, 6], 1, async (item) => {
        started.push(item);
        if (item === 2) throw new Error('item two failed');
        await delay(1);
      }),
    ).rejects.toThrow('item two failed');
    // Single lane, fail on the second item: the later items are never started.
    expect(started).toEqual([1, 2]);
  });

  it('RunTaskInWorker_SuccessfulTask_ResolvesWithThePostedPerfSnapshot', async () => {
    const result = await runTaskInWorker(FIXTURE_WORKER, 'reports:example');
    expect(result.taskId).toBe('reports:example');
    expect(result.perf).toEqual([{ label: 'reports:example', calls: 1, totalMs: 1, size: 0 }]);
  });

  it('RunTaskInWorker_TaskThrows_RejectsNamingTheTask', async () => {
    await expect(runTaskInWorker(FIXTURE_WORKER, 'boom')).rejects.toThrow(/report task 'boom' failed/);
  });

  it('RunTaskInWorker_WorkerExitsNonZero_RejectsWithTheExitCode', async () => {
    await expect(runTaskInWorker(FIXTURE_WORKER, 'nonzero')).rejects.toThrow(/worker exited with code 3/);
  });
});
