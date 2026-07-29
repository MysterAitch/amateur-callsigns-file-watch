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
  /** Present when this run is one shard of a split (see aggregateShardGroups). */
  shardGroup?: string;
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
  /** Set when this arm is one shard of a split; groups are aggregated. */
  shardGroup?: string;
  /**
   * How many separated clusters the samples fall into. 1 is the normal case.
   * >1 means the median describes NO actual population, which is worse than a
   * wide error bar because it looks precise.
   */
  modes: number;
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

/**
 * Count separated clusters in a sample set, so a bimodal or trimodal arm is not
 * summarised by a median that sits between its populations.
 *
 * Detection is a GAP RULE rather than a kernel-density or dip test: sort the
 * samples and split wherever a consecutive gap dwarfs the typical gap. It needs
 * no distributional assumption, works at the sample counts CI runs actually
 * produce (5-25), and is interpretable - "there is a hole here and nothing
 * landed in it".
 *
 * Deliberately conservative in two ways. A merely WIDE but continuous spread
 * must report ONE mode: noise is not structure, and inventing clusters would be
 * the mirror of the cry-wolf failure this module already carries scars from.
 * And fewer than four samples always reports one mode, because two or three
 * points cannot distinguish a gap from a sparse sample.
 */
function countModes(values: readonly number[]): number {
  if (values.length < 4) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const gaps = sorted.slice(1).map((v, i) => v - sorted[i]);
  const range = sorted[sorted.length - 1] - sorted[0];
  if (range === 0) return 1;

  // A cluster boundary is a gap far larger than the TYPICAL gap. The median gap
  // is the right yardstick rather than the mean or an even-spread estimate:
  // those are themselves inflated by the very boundaries being looked for, which
  // makes three clusters harder to detect than two - the bug this replaces.
  //
  // The range floor guards the degenerate case where most samples are identical,
  // so the median gap is 0 and every difference would otherwise look infinite.
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const mid = sortedGaps.length >> 1;
  const medianGap = sortedGaps.length % 2 === 0 ? (sortedGaps[mid - 1] + sortedGaps[mid]) / 2 : sortedGaps[mid];
  const threshold = Math.max(medianGap * 5, range * 0.15);
  return gaps.filter(g => g > threshold).length + 1;
}

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
    return { arm, medianS: null, minS: null, maxS: null, spreadRatio: null, peakRssKb: 0, reps: 0, failures, reliable: false, modes: 1, shardGroup: runs[0]?.shardGroup };
  }

  const times = good.map(r => r.elapsedS);
  const modes = countModes(times);
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
    shardGroup: runs[0]?.shardGroup,
    modes,
    // A multimodal arm is never reliable however tight each cluster is: the
    // summary statistic does not describe any population that exists.
    reliable: modes === 1 && good.length >= MIN_RELIABLE_REPS && spreadRatio !== null && spreadRatio <= MAX_RELIABLE_SPREAD,
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

export interface ShardGroupSummary {
  group: string;
  /** Sum across shards: what the split costs in RUNNER MINUTES. */
  totalS: number;
  /** Max across shards: what the split costs in WALL CLOCK. */
  wallS: number;
  /** slowest / fastest shard. 1.0 is perfect balance. */
  imbalance: number;
  shards: number;
  /** False when fewer shards were measured than the split declares. */
  complete: boolean;
}

/**
 * Aggregate the shards of a split.
 *
 * A split has TWO costs and they trade against each other: the SUM across shards
 * is runner-minutes, the MAX is wall clock. Reporting one without the other is
 * how a sharding decision gets made on the wrong axis.
 *
 * `expected` maps a group to how many shards it should have. Supplying it turns
 * a partial measurement into an explicit `complete: false` rather than a total
 * that silently understates. Round 1 of the slicing matrix measured only shard 1
 * and multiplied by N - invalid, because vitest shards by FILE COUNT while file
 * durations are wildly uneven, so no single shard represents the split.
 */
export function aggregateShardGroups(
  summaries: readonly ArmSummary[],
  expected: Readonly<Record<string, number>> = {},
): ShardGroupSummary[] {
  const groups = new Map<string, ArmSummary[]>();
  for (const s of summaries) {
    if (s.shardGroup === undefined || s.medianS === null) continue;
    const list = groups.get(s.shardGroup) ?? [];
    list.push(s);
    groups.set(s.shardGroup, list);
  }

  const out: ShardGroupSummary[] = [];
  for (const [group, members] of groups) {
    const times = members.map(m => m.medianS as number);
    const wallS = Math.max(...times);
    const fastest = Math.min(...times);
    out.push({
      group,
      totalS: times.reduce((a, b) => a + b, 0),
      wallS,
      imbalance: fastest > 0 ? wallS / fastest : 1,
      shards: members.length,
      complete: expected[group] === undefined ? true : members.length === expected[group],
    });
  }
  return out.sort((a, b) => a.group.localeCompare(b.group));
}

export function renderMatrixMarkdown(
  summaries: readonly ArmSummary[],
  ratios: readonly RatioResult[],
  deltas: readonly BaselineDelta[],
  groups: readonly ShardGroupSummary[] = [],
): string {
  if (summaries.length === 0) return '## Performance matrix\n\nNo arms produced a result.\n';

  const lines: string[] = ['## Performance matrix', ''];
  lines.push('| arm | median s | min | max | spread | peak RSS MB | reps | failures |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const s of [...summaries].sort((a, b) => (b.medianS ?? 0) - (a.medianS ?? 0))) {
    // The warning travels WITH the number. A caveat kept in the data and left
    // out of the table is a caveat nobody reads.
    const spread = s.spreadRatio === null ? '-'
      : s.modes > 1 ? `**${fmt(s.spreadRatio, 2)}x — ${s.modes === 2 ? 'BIMODAL' : s.modes === 3 ? 'TRIMODAL' : `${s.modes}-MODAL`}, median describes no population**`
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

  if (groups.length > 0) {
    lines.push('', '### Shard groups', '',
      '| split | shards | wall clock (max) | runner minutes (sum) | imbalance |', '|---|---:|---:|---:|---:|');
    for (const g of groups) {
      const flag = g.complete ? '' : ' **INCOMPLETE — some shards missing, totals understate**';
      lines.push(`| ${g.group}${flag} | ${g.shards} | ${(g.wallS / 60).toFixed(2)} min | ${(g.totalS / 60).toFixed(2)} min | ${g.imbalance.toFixed(2)}x |`);
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
    shardGroup: fields.get('shard_group') || undefined,
  };
}
