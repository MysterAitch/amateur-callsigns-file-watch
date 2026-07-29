/**
 * Collate a performance-matrix run into a markdown report and a candidate
 * baseline (issue #1004).
 *
 * Usage:
 *   node src/ci/perf-matrix-collate.ts <artefact-dir> [--baseline <file>] [--write-baseline <file>]
 *
 * Reads every `arm-result.txt` beneath <artefact-dir>, groups repetitions by
 * arm, and prints the report to stdout. `--baseline` compares against a stored
 * baseline; `--write-baseline` emits this run's medians for a later comparison.
 *
 * The baseline is written but never committed by CI: writeback to the repo is
 * PR-only (ADR 0001), and a baseline that updates itself silently would ratchet
 * whatever regression happened to land, which is the opposite of the point.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  parseArmResult,
  summariseArm,
  computeRatios,
  compareToBaseline,
  renderMatrixMarkdown,
  aggregateShardGroups,
  type ArmRun,
  type ComparisonSpec,
  type PerfBaseline,
} from './perf-matrix-report.ts';
import { parseJsonObject } from '../shared/json-shape.ts';

function findResultFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name === 'arm-result.txt') out.push(abs);
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const artefactDir = process.argv[2] ?? 'arms';
const armsSpecPath = argValue('--arms') ?? 'src/testing/perf-arms.json';

const runs: ArmRun[] = [];
for (const file of findResultFiles(artefactDir)) {
  const parsed = parseArmResult(fs.readFileSync(file, 'utf8'));
  if (parsed !== null) runs.push(parsed);
}

const byArm = new Map<string, ArmRun[]>();
for (const run of runs) {
  const list = byArm.get(run.arm) ?? [];
  list.push(run);
  byArm.set(run.arm, list);
}
const summaries = [...byArm.values()].map(summariseArm);

const spec = parseJsonObject(fs.readFileSync(armsSpecPath, 'utf8'), armsSpecPath) as {
  comparisons?: ComparisonSpec[];
  arms?: { id: string; shardGroup?: string }[];
};
// How many shards each group DECLARES, so a partial measurement is reported as
// incomplete rather than as a total that silently understates.
const expectedShards: Record<string, number> = {};
for (const a of spec.arms ?? []) if (a.shardGroup !== undefined) expectedShards[a.shardGroup] = (expectedShards[a.shardGroup] ?? 0) + 1;
const ratios = computeRatios(summaries, spec.comparisons ?? []);

const baselinePath = argValue('--baseline');
const deltas = baselinePath !== undefined && fs.existsSync(baselinePath)
  ? compareToBaseline(summaries, parseJsonObject(fs.readFileSync(baselinePath, 'utf8'), baselinePath) as unknown as PerfBaseline)
  : [];

process.stdout.write(renderMatrixMarkdown(summaries, ratios, deltas, aggregateShardGroups(summaries, expectedShards)));

const writePath = argValue('--write-baseline');
if (writePath !== undefined) {
  const arms: Record<string, number> = {};
  for (const s of summaries) if (s.medianS !== null) arms[s.arm] = Number(s.medianS.toFixed(1));
  const record: PerfBaseline = { recordedAt: new Date().toISOString(), node: process.version, arms };
  fs.writeFileSync(writePath, JSON.stringify(record, null, 2) + '\n');
}
