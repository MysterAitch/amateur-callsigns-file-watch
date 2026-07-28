/**
 * Decide whether a benchmark actually moved, or whether it is jitter
 * (issue #1004).
 *
 * WHY NOT `vitest bench --compare`. That mechanism exists on paper: vitest
 * 4.1.10 accepts `--outputJson` and `--compare`. Verified on 2026-07-28, the
 * export writes `{"files":[]}` - an empty report - while the run prints results
 * to the terminal, and `--reporter=json` errors outright on a bench run. So the
 * built-in baseline path cannot be built on, and this drives tinybench directly
 * instead. tinybench is already present (it is what `vitest bench` runs on).
 *
 * WHY THE MARGIN OF ERROR RATHER THAN A PERCENTAGE BAND. Wall-clock CI arms need
 * a guessed noise band because nothing reports their uncertainty. In-process
 * benchmarks do better: tinybench yields `moe` (margin of error at 95%
 * confidence) per task, so two results differ only when their confidence
 * intervals DO NOT OVERLAP. That is a real test rather than a guess, and it
 * adapts automatically to a benchmark that happens to be noisy today.
 *
 * A SECOND, INDEPENDENT FLOOR on effect size. Statistical significance is not
 * practical significance: with tight error bars a 0.4% shift is measurable and
 * uninteresting, and reporting it buries the findings that matter. Both tests
 * must pass before anything is called a change.
 */

export interface BenchResult {
  name: string;
  /** Mean time per operation, in whatever unit tinybench reported (ms). */
  mean: number;
  /** Relative margin of error, as a PERCENTAGE (tinybench's `rme`). */
  rme: number;
  samples: number;
  hz: number;
}

export interface BenchDelta {
  name: string;
  ratio: number | null;
  direction: 'faster' | 'slower' | 'unchanged' | 'new' | 'missing';
  significant: boolean;
  /** False when the run is too noisy or too small to support any comparison. */
  reliable: boolean;
}

/** Below this many samples the distribution is not worth believing. */
const MIN_SAMPLES = 10;
/** A run whose own error bar exceeds this (%) cannot support a comparison. */
const MAX_USABLE_RME = 15;
/**
 * Minimum effect worth reporting. Chosen so a change has to be big enough that
 * someone would act on it, not merely big enough to detect.
 */
const MIN_EFFECT = 1.05;

export function classifyBenchDelta(baseline: BenchResult, current: BenchResult): BenchDelta {
  const reliable = current.samples >= MIN_SAMPLES
    && baseline.samples >= MIN_SAMPLES
    && current.rme <= MAX_USABLE_RME
    && baseline.rme <= MAX_USABLE_RME;

  const ratio = baseline.mean === 0 ? null : current.mean / baseline.mean;
  if (ratio === null) return { name: current.name, ratio: null, direction: 'unchanged', significant: false, reliable };

  // Absolute half-widths of each 95% interval, from the relative margins.
  const baselineMoe = baseline.mean * (baseline.rme / 100);
  const currentMoe = current.mean * (current.rme / 100);
  const separated = Math.abs(current.mean - baseline.mean) > baselineMoe + currentMoe;

  const effect = ratio >= 1 ? ratio : 1 / ratio;
  const significant = reliable && separated && effect >= MIN_EFFECT;

  const direction = !significant ? 'unchanged' as const
    : ratio > 1 ? 'slower' as const
      : 'faster' as const;

  return { name: current.name, ratio, direction, significant, reliable };
}

export function compareBenchRuns(current: readonly BenchResult[], baseline: readonly BenchResult[]): BenchDelta[] {
  const baseByName = new Map(baseline.map(b => [b.name, b]));
  const out: BenchDelta[] = [];

  for (const c of current) {
    const b = baseByName.get(c.name);
    if (b === undefined) {
      out.push({ name: c.name, ratio: null, direction: 'new', significant: false, reliable: true });
      continue;
    }
    out.push(classifyBenchDelta(b, c));
  }

  // A benchmark that has VANISHED is surfaced rather than silently dropped:
  // losing coverage of a hot path is exactly what a stored baseline is for.
  for (const b of baseline) {
    if (!current.some(c => c.name === b.name)) {
      out.push({ name: b.name, ratio: null, direction: 'missing', significant: false, reliable: true });
    }
  }
  return out;
}

export function renderBenchMarkdown(deltas: readonly BenchDelta[]): string {
  const lines: string[] = ['## Benchmarks vs baseline', ''];
  const notable = deltas.filter(d => d.significant || d.direction === 'missing' || !d.reliable);

  if (notable.length === 0) {
    lines.push(`No significant change across ${deltas.length} benchmark(s). Every difference sat inside the measured margin of error.`);
    lines.push('');
    return lines.join('\n');
  }

  lines.push('| benchmark | change | direction | note |', '|---|---:|---|---|');
  for (const d of notable) {
    const note = !d.reliable ? '**unreliable run — too noisy or too few samples to compare**'
      : d.direction === 'missing' ? '**present in the baseline, absent now**'
        : '';
    lines.push(`| ${d.name} | ${d.ratio === null ? '-' : `${d.ratio.toFixed(2)}x`} | ${d.direction} | ${note} |`);
  }
  lines.push('');
  return lines.join('\n');
}
