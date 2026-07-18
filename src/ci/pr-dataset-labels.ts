#!/usr/bin/env node

/**
 * Dataset-class PR labels (issue #158): the scheduled-lane reconciler.
 *
 * Labels are a DERIVED surface, like the generated docs: a data PR's
 * dataset-class labels are computed from the `datasetClasses` its changed
 * `archive/**\/meta.json` declares, and reconciled on every pass, so a meta
 * edit updates the labels automatically and there is no decoupled state to keep
 * in step by hand.
 *
 * Write posture (ADR 0001 / 0002): this runs in the SCHEDULED lane on reviewed
 * code from `main`, never in a push-triggered workflow holding a write token
 * over unreviewed branch content. It reads each open PR's changed meta.json via
 * the GitHub *contents* API as pure JSON data (`gh api .../contents/<path>?ref=
 * <headSha>`); it never checks out or executes the branch. The only writes it
 * makes are label create-if-missing and `gh pr edit --add-label/--remove-label`.
 *
 * The retro-labelling one-off uses this same code path over already-merged PRs:
 * `node src/ci/pr-dataset-labels.ts --state merged`. `--dry-run` reports the
 * plan without creating labels or editing any PR.
 *
 * Usage:
 *   node src/ci/pr-dataset-labels.ts [--state open|merged|all] [--dry-run] [--limit N]
 */

import { execFileSync } from 'child_process';
import {
  DATASET_CLASS_LABEL_COLOUR,
  datasetClassLabelDescription,
  collectDatasetClassesFromMeta,
  deriveLabelsForClasses,
  reconcileDatasetClassLabels,
} from './dataset-class-labels.ts';
import { errorMessage } from '../shared/utils.ts';
import { parseJsonArray, parseJsonObject } from '../shared/json-shape.ts';

// A thin seam over the `gh` CLI: given an argument vector, return its stdout.
// Injected in tests so the whole orchestration is exercised without touching
// the live repository.
export type GhRunner = (args: string[]) => string;

export const defaultGhRunner: GhRunner = (args) =>
  execFileSync('gh', args, { encoding: 'utf8' });

export interface ReconcileOptions {
  state?: 'open' | 'merged' | 'all';
  limit?: number;
  dryRun?: boolean;
  log?: (message: string) => void;
}

export interface PrActionReport {
  number: number;
  metaPaths: string[];
  desiredLabels: string[];
  unknownClasses: string[];
  parseErrors: string[];
  added: string[];
  removed: string[];
}

export interface ReconcileReport {
  labelsCreated: string[];
  pullRequests: PrActionReport[];
}

interface PullRequestSummary {
  number: number;
  headRefOid: string;
  labels: string[];
}

// Only meta.json files under the archive tree carry `datasetClasses`; that is
// the pure data this reconciler reads. Matches both the FOI lane
// (`archive/foi/<entry>/meta.json`) and any other archive entry meta.
function isArchiveMetaPath(filePath: string): boolean {
  return /^archive\/.*\/meta\.json$/.test(filePath);
}

function listPullRequests(gh: GhRunner, state: string, limit: number): PullRequestSummary[] {
  const raw = gh([
    'pr', 'list',
    '--state', state,
    '--limit', String(limit),
    '--json', 'number,headRefOid,labels',
  ]);
  const parsed = parseJsonArray(raw, 'gh pr list --json output') as Array<{
    number: number;
    headRefOid: string;
    labels?: Array<{ name: string }>;
  }>;
  return parsed.map((pr) => ({
    number: pr.number,
    headRefOid: pr.headRefOid,
    labels: (pr.labels ?? []).map((label) => label.name),
  }));
}

function changedMetaPaths(gh: GhRunner, prNumber: number): string[] {
  const raw = gh(['pr', 'view', String(prNumber), '--json', 'files']);
  const parsed = parseJsonObject(raw, `gh pr view ${prNumber} --json files output`) as { files?: Array<{ path: string }> };
  return (parsed.files ?? []).map((file) => file.path).filter(isArchiveMetaPath);
}

// Read a file's contents at a specific ref via the GitHub contents API - pure
// data, no branch checkout or execution. The API returns base64; decode to the
// UTF-8 JSON text.
function readFileAtRef(gh: GhRunner, filePath: string, ref: string): string {
  const base64 = gh([
    'api',
    `repos/{owner}/{repo}/contents/${filePath}`,
    '-f', `ref=${ref}`,
    '--jq', '.content',
  ]);
  return Buffer.from(base64, 'base64').toString('utf8');
}

function existingLabelNames(gh: GhRunner): Set<string> {
  const raw = gh(['label', 'list', '--limit', '500', '--json', 'name', '--jq', '.[].name']);
  return new Set(raw.split('\n').map((line) => line.trim()).filter(Boolean));
}

function createLabel(gh: GhRunner, name: string): void {
  gh([
    'label', 'create', name,
    '--description', datasetClassLabelDescription(name),
    '--color', DATASET_CLASS_LABEL_COLOUR,
    '--force', // idempotent: update in place rather than fail if it raced in
  ]);
}

function applyLabelEdit(gh: GhRunner, prNumber: number, toAdd: string[], toRemove: string[]): void {
  const args = ['pr', 'edit', String(prNumber)];
  if (toAdd.length > 0) args.push('--add-label', toAdd.join(','));
  if (toRemove.length > 0) args.push('--remove-label', toRemove.join(','));
  gh(args);
}

// The whole scheduled-lane pass. Enumerates PRs in the requested state, derives
// each one's desired dataset-class labels from its changed archive meta.json,
// ensures those labels exist, and reconciles them onto the PR. A single messy
// PR (unparseable meta, unknown class) is reported and skipped, never fatal -
// a half-finished sweep would leave a half-labelled corpus.
export function reconcilePullRequests(
  gh: GhRunner,
  options: ReconcileOptions = {},
): ReconcileReport {
  const state = options.state ?? 'open';
  const limit = options.limit ?? 200;
  const dryRun = options.dryRun ?? false;
  const log = options.log ?? ((message: string) => console.log(message));

  const report: ReconcileReport = { labelsCreated: [], pullRequests: [] };
  const knownLabels = existingLabelNames(gh);

  for (const pr of listPullRequests(gh, state, limit)) {
    const metaPaths = changedMetaPaths(gh, pr.number);
    if (metaPaths.length === 0) continue; // not a data PR - nothing to label

    const metaContents: string[] = [];
    const readErrors: string[] = [];
    for (const metaPath of metaPaths) {
      try {
        metaContents.push(readFileAtRef(gh, metaPath, pr.headRefOid));
      } catch (err) {
        readErrors.push(`${metaPath}: ${errorMessage(err)}`);
      }
    }

    const collected = collectDatasetClassesFromMeta(metaContents);
    const derivation = deriveLabelsForClasses(collected.datasetClasses);
    const parseErrors = [...collected.parseErrors, ...readErrors];

    for (const unknown of derivation.unknownClasses) {
      log(`PR #${pr.number}: WARNING dataset class '${unknown}' is not in the vocabulary - no label applied.`);
    }
    for (const parseError of parseErrors) {
      log(`PR #${pr.number}: WARNING could not read meta - ${parseError}`);
    }

    // Ensure every desired label exists before applying it. In dry-run we still
    // record which labels WOULD be created so the plan is complete.
    for (const label of derivation.labels) {
      if (knownLabels.has(label)) continue;
      knownLabels.add(label);
      report.labelsCreated.push(label);
      if (dryRun) {
        log(`Would create label '${label}'.`);
      } else {
        createLabel(gh, label);
        log(`Created label '${label}'.`);
      }
    }

    const { toAdd, toRemove } = reconcileDatasetClassLabels(pr.labels, derivation.labels);
    if ((toAdd.length > 0 || toRemove.length > 0) && !dryRun) {
      applyLabelEdit(gh, pr.number, toAdd, toRemove);
    }
    if (toAdd.length > 0 || toRemove.length > 0) {
      log(`PR #${pr.number}: ${dryRun ? 'would apply' : 'applied'} +[${toAdd.join(', ')}] -[${toRemove.join(', ')}]`);
    }

    report.pullRequests.push({
      number: pr.number,
      metaPaths,
      desiredLabels: derivation.labels,
      unknownClasses: derivation.unknownClasses,
      parseErrors,
      added: toAdd,
      removed: toRemove,
    });
  }

  return report;
}

function parseArgs(argv: string[]): ReconcileOptions {
  const options: ReconcileOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--state') {
      const value = argv[i + 1];
      if (value !== 'open' && value !== 'merged' && value !== 'all') {
        throw new Error(`--state must be open|merged|all, got '${value ?? ''}'`);
      }
      options.state = value;
      i += 1;
    } else if (arg === '--limit') {
      options.limit = Number(argv[i + 1]);
      i += 1;
    } else {
      throw new Error(`unknown argument '${arg}'`);
    }
  }
  return options;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const report = reconcilePullRequests(defaultGhRunner, options);
  const editedCount = report.pullRequests.filter((pr) => pr.added.length > 0 || pr.removed.length > 0).length;
  console.log(
    `Dataset-class label reconcile complete: ${report.pullRequests.length} data PR(s) inspected, ` +
    `${editedCount} edited, ${report.labelsCreated.length} label(s) ${options.dryRun ? 'to create' : 'created'}.`,
  );
}

if (import.meta.main) {
  try {
    main();
  } catch (err: unknown) {
    console.error(`pr-dataset-labels failed: ${errorMessage(err)}`);
    process.exit(1);
  }
}
