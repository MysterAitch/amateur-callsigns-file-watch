/**
 * Turn repeated CI timings into claims that carry their own uncertainty
 * (issue #1004).
 *
 * WHY THIS EXISTS. Performance conclusions in this repo have twice been wrong in
 * ways that looked solid at the time:
 *
 *   - a per-fold memory cap was believed protective and was measured to be
 *     CAUSING the failures it was added to prevent (ADR 0023);
 *   - the test suite's coverage cost was attributed to "coverage" on three
 *     mutually consistent readings, none of which varied the PROVIDER - which
 *     turned out to be the actual variable, worth 2.3x.
 *
 * Neither error was a bad measurement. Both were sound numbers carrying an
 * unstated assumption, presented without their spread. So this module is built
 * around REFUSING to state things:
 *
 *   - the median, never the mean, because a single outlier run is routine here;
 *   - the spread alongside every median, because two reps 1.7x apart have been
 *     observed on identical configuration;
 *   - `reliable` and `settled` flags, so a ratio drawn from a noisy arm is
 *     rendered as indicative rather than quoted flatly;
 *   - a baseline comparison that still runs across a Node upgrade but marks
 *     itself not-comparable, because "what did the new runtime change?" is the
 *     main reason to keep baselines at all.
 *
 * Deliberately pure and dependency-free: everything here is unit-tested without
 * running a single benchmark, so the reporting cannot drift from what the
 * numbers support.
 */

export interface ArmRun {
  arm: string;
  rep: number;
  elapsedS: number;
  peakRssKb: number;
  /** Process exit status. Non-zero runs time the FAILURE, not the work. */
  status: number;
}

export interface ArmSummary {
  arm: string;
  /** Null when every repetition failed - no timing is better than a wrong one. */
  medianS: number | null;
  minS: number | null;
  maxS: number | null;
  /** max/min. 1.0 is perfectly repeatable; the real runners have produced 1.7. */
  spreadRatio: number | null;
  peakRssKb: number;
  /** Successful repetitions only. */
  reps: number;
  failures: number;
  reliable: boolean;
}

export interface ComparisonSpec {
  id: string;
  baseline: string;
  variant: string;
}

export interface RatioResult {
  id: string;
  baseline: string;
  variant: string;
  ratio: number;
  /** False when either side is unreliable: render as indicative, not as fact. */
  settled: boolean;
}

export interface PerfBaseline {
  recordedAt: string;
  node: string;
  /** Arm id -> median seconds. */
  arms: Record<string, number>;
}

export interface BaselineDelta {
  arm: string;
  delta: number | null;
  direction: 'faster' | 'slower' | 'unchanged' | 'new';
  /** False when the baseline was recorded on a different Node build. */
  comparable: boolean;
}

/** At least this many good reps before an arm is allowed to look trustworthy. */
const MIN_RELIABLE_REPS = 2;
/** Above this max/min ratio, more repetitions do not buy confidence. */
const MAX_RELIABLE_SPREAD = 1.25;
/**
 * Movement smaller than this is runner variation, not a change. Calling routine
 * noise a regression is how a report teaches its readers to ignore it.
 */
const NOISE_BAND = 1.1;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function summariseArm(runs: readonly ArmRun[]): ArmSummary {
  const arm = runs[0]?.arm ?? 'unknown';
  const good = runs.filter(r => r.status === 0);
  const failures = runs.length - good.length;

  if (good.length === 0) {
    return { arm, medianS: null, minS: null, maxS: null, spreadRatio: null, peakRssKb: 0, reps: 0, failures, reliable: false };
  }

  const times = good.map(r => r.elapsedS);
  const minS = Math.min(...times);
  const maxS = Math.max(...times);
  const spreadRatio = minS > 0 ? maxS / minS : null;

  return {
    arm,
    medianS: median(times),
    minS,
    maxS,
    spreadRatio,
    peakRssKb: Math.max(...good.map(r => r.peakRssKb)),
    reps: good.length,
    failures,
    reliable: good.length >= MIN_RELIABLE_REPS && spreadRatio !== null && spreadRatio <= MAX_RELIABLE_SPREAD,
  };
}

/**
 * Do the two arms' observed ranges separate entirely? Requires at least two
 * repetitions each: a single run has no range, so separation is unmeasurable
 * however far apart the two points happen to sit.
 */
function rangesSeparate(a: ArmSummary, b: ArmSummary): boolean {
  if (a.reps < 2 || b.reps < 2) return false;
  if (a.minS === null || a.maxS === null || b.minS === null || b.maxS === null) return false;
  return a.maxS < b.minS || b.maxS < a.minS;
}

export function computeRatios(summaries: readonly ArmSummary[], specs: readonly ComparisonSpec[]): RatioResult[] {
  const byArm = new Map(summaries.map(s => [s.arm, s]));
  const out: RatioResult[] = [];

  for (const spec of specs) {
    const base = byArm.get(spec.baseline);
    const variant = byArm.get(spec.variant);
    // A comparison naming an arm that did not run is dropped, not guessed at:
    // an absent arm is the single commonest way a matrix reports a confident
    // result about a lever it never varied.
    if (base?.medianS == null || variant?.medianS == null || base.medianS === 0) continue;

    out.push({
      id: spec.id,
      baseline: spec.baseline,
      variant: spec.variant,
      ratio: variant.medianS / base.medianS,
      // SETTLED IS JUDGED AGAINST THE EFFECT, not against a fixed spread.
      //
      // The first real run (2026-07-28) marked a 3.18x effect "indicative only"
      // because one arm spread 1.26x against a 1.25 threshold - the exact
      // cry-wolf behaviour this module exists to prevent. The old test asked "is
      // each arm tight?" when the question is "is THIS effect resolvable given
      // this much noise?". A 26% spread genuinely blocks a 4% finding and has no
      // bearing on a 218% one.
      //
      // The replacement is the same idea as the benchmark comparator's
      // confidence-interval test, at the resolution repeated CI arms allow: the
      // arms' observed ranges must not overlap. It needs no threshold, it scales
      // automatically with each arm's own noise, and it is interpretable - "no
      // run of either arm came near the other".
      settled: rangesSeparate(base, variant),
    });
  }
  return out;
}

export function compareToBaseline(summaries: readonly ArmSummary[], baseline: PerfBaseline, node = process.version): BaselineDelta[] {
  const comparable = baseline.node === node;

  return summaries.map(s => {
    const previous = baseline.arms[s.arm];
    if (previous === undefined || s.medianS === null) {
      return { arm: s.arm, delta: null, direction: 'new' as const, comparable };
    }
    const delta = s.medianS / previous;
    const direction = delta > NOISE_BAND ? 'slower' as const
      : delta < 1 / NOISE_BAND ? 'faster' as const
        : 'unchanged' as const;
    return { arm: s.arm, delta, direction, comparable };
  });
}

function fmt(n: number | null, digits = 1): string {
  return n === null ? '-' : n.toFixed(digits);
}

export function renderMatrixMarkdown(
  summaries: readonly ArmSummary[],
  ratios: readonly RatioResult[],
  deltas: readonly BaselineDelta[],
): string {
  if (summaries.length === 0) return '## Performance matrix\n\nNo arms produced a result.\n';

  const lines: string[] = ['## Performance matrix', ''];
  lines.push('| arm | median s | min | max | spread | peak RSS MB | reps | failures |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const s of [...summaries].sort((a, b) => (b.medianS ?? 0) - (a.medianS ?? 0))) {
    // The warning travels WITH the number. A caveat kept in the data and left
    // out of the table is a caveat nobody reads.
    const spread = s.spreadRatio === null ? '-'
      : s.reliable ? `${fmt(s.spreadRatio, 2)}x`
        : `**${fmt(s.spreadRatio, 2)}x wide spread**`;
    lines.push(`| ${s.arm} | ${fmt(s.medianS)} | ${fmt(s.minS)} | ${fmt(s.maxS)} | ${spread} | ${(s.peakRssKb / 1024).toFixed(0)} | ${s.reps} | ${s.failures} |`);
  }

  if (ratios.length > 0) {
    lines.push('', '### Ratios', '', '| comparison | variant / baseline | status |', '|---|---:|---|');
    for (const r of ratios) {
      lines.push(`| ${r.id} (${r.variant} vs ${r.baseline}) | ${r.ratio.toFixed(2)}x | ${r.settled ? 'settled' : '**indicative only - a noisy arm**'} |`);
    }
  }

  if (deltas.length > 0) {
    const moved = deltas.filter(d => d.direction === 'slower' || d.direction === 'faster');
    lines.push('', '### Against the stored baseline', '');
    if (!deltas[0].comparable) {
      lines.push('> Baseline recorded on a DIFFERENT Node build. The comparison is still shown - a runtime change is the main reason to keep baselines - but it is not like-for-like.', '');
    }
    if (moved.length === 0) {
      lines.push('No arm moved outside the noise band.');
    } else {
      lines.push('| arm | delta | direction |', '|---|---:|---|');
      for (const d of moved) lines.push(`| ${d.arm} | ${d.delta === null ? '-' : `${d.delta.toFixed(2)}x`} | ${d.direction} |`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Parse the `key=value` result files each arm writes. Tolerant by design: a
 * crashed arm may leave a partial file, and losing the whole report because one
 * arm died is how evidence gets discarded at exactly the moment it matters.
 */
export function parseArmResult(text: string): ArmRun | null {
  const fields = new Map<string, string>();
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) fields.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  const arm = fields.get('arm');
  const elapsed = Number(fields.get('elapsed_s'));
  if (arm === undefined || arm === '' || !Number.isFinite(elapsed)) return null;
  return {
    arm,
    rep: Number(fields.get('rep')) || 0,
    elapsedS: elapsed,
    peakRssKb: Number(fields.get('peak_rss_kb')) || 0,
    status: Number(fields.get('status')) || 0,
  };
}
