// Expand src/testing/perf-arms.json into the matrix inputs perf-matrix.yml
// consumes (issue #1004).
//
// A FILE rather than an inline `node -e` in the workflow: the script builds
// strings with JS template literals, and shellcheck reads `${...}` inside the
// single-quoted heredoc as a shell expansion that will not expand (SC2016).
// The single quotes are correct - shell expansion is exactly what must NOT
// happen there - so the warning is a false positive, and extracting the script
// removes the ambiguity rather than suppressing the warning. It also matches how
// the other CI helpers live under .github/scripts/.
//
// Reads REPETITIONS from the environment (a workflow_dispatch input, so it is
// user-controlled and is passed as DATA, never spliced into a script).
// Writes `arms` and `reps` to $GITHUB_OUTPUT.
import * as fs from 'node:fs';

// Overridable so the guards below can be exercised against fixtures rather
// than only asserted by reading them.
const SPEC_PATH = process.env.PERF_ARMS_SPEC ?? 'src/testing/perf-arms.json';
// Raised from 9 after a power analysis of the first 5-rep run (2026-07-28).
// Measured CVs put the reps needed for 80% power at 95% confidence at:
//   ~200% effect (the v8 coverage tax)      -> n = 1
//    ~20% effect                            -> n = 5
//    ~10% effect                            -> n = 12
//     ~5% effect                            -> n = 55
// The default of 5 is right-sized for what this matrix exists to decide, which
// is large-effect questions. Anything under ~20% needs a deliberate high-rep
// run, and the cap should not be what stops it.
const MAX_REPS = 25;

const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));

if (!Array.isArray(spec.arms) || spec.arms.length === 0) {
  throw new Error(`${SPEC_PATH} declares no arms`);
}

// Every comparison must name arms that exist. A comparison pointing at an absent
// arm is the commonest way a matrix reports a confident result about a lever it
// never varied, so it fails loudly here rather than silently producing no row.
const ids = new Set(spec.arms.map(a => a.id));
const dangling = (spec.comparisons ?? []).filter(c => !ids.has(c.baseline) || !ids.has(c.variant));
if (dangling.length > 0) {
  throw new Error(`${SPEC_PATH}: comparisons reference arms that do not exist: ${dangling.map(c => c.id).join(', ')}`);
}

// A control arm - one expected to show no difference - is what distinguishes a
// harness that measures from one that merely reports. Without it, noise is
// indistinguishable from signal.
if (!spec.arms.some(a => a.control !== undefined)) {
  throw new Error(`${SPEC_PATH}: no control arm declared. Add one arm with a "control" field naming the arm it should match.`);
}

// Round 1 accidentally shipped FOUR byte-identical arms, spending ~40 jobs on
// redundancy nobody intended. Duplicates are legitimate ONLY as a declared
// control - which is a deliberate noise-floor read, not an accident.
const bySignature = new Map();
for (const a of spec.arms) {
  const key = JSON.stringify([a.target ?? '', a.coverage ?? '', a.extraArgs ?? '', a.perf ?? '']);
  (bySignature.get(key) ?? bySignature.set(key, []).get(key)).push(a);
}
for (const [key, group] of bySignature) {
  if (group.length < 2) continue;
  const undeclared = group.filter(a => a.control === undefined);
  if (undeclared.length > 1) {
    throw new Error(`${SPEC_PATH}: arms ${undeclared.map(a => a.id).join(', ')} share an identical configuration ${key}. Declare one as a "control" of the other, or make them differ.`);
  }
}

const requested = Number.parseInt(process.env.REPETITIONS ?? '', 10);
const reps = Math.min(MAX_REPS, Math.max(1, Number.isInteger(requested) ? requested : (spec.defaultRepetitions ?? 5)));

const out = process.env.GITHUB_OUTPUT;
if (out !== undefined && out !== '') {
  fs.appendFileSync(out, `arms=${JSON.stringify(spec.arms)}\n`);
  fs.appendFileSync(out, `reps=${JSON.stringify(Array.from({ length: reps }, (_, i) => i + 1))}\n`);
}

console.log(`${spec.arms.length} arms x ${reps} reps = ${spec.arms.length * reps} jobs`);
