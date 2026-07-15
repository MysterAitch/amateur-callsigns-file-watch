/**
 * Dataset-class PR labels (issue #158): the pure derivation core.
 *
 * GitHub labels on data PRs mirror the dataset-class vocabulary one-for-one -
 * the label NAME is the `FOI_DATASET_CLASSES` key itself (`register-snapshot`,
 * `issuance-events`, ...), so there is one vocabulary everywhere and no
 * label-specific naming to drift. A label rename in repo settings then
 * cascades to every historical PR by ID, so the labels cannot go stale under a
 * vocabulary rename the way a PR title would.
 *
 * This module is deliberately free of any I/O or GitHub knowledge: it turns an
 * entry's declared `datasetClasses` into a desired label set and reconciles
 * that against a PR's current labels. The scheduled-lane reconciler
 * (src/ci/pr-dataset-labels.ts) reads the meta.json contents as pure data and
 * applies the decisions this module returns. Keeping the vocabulary handling
 * here means the retro-labelling one-off and the ongoing reconcile share it.
 */

import { FOI_DATASET_CLASSES } from '../shared/foi-archive.ts';
import { errorMessage } from '../shared/utils.ts';

// The single colour every dataset-class label carries (hex without '#', as the
// GitHub API and `gh label` expect), so the axis reads as one visual group in
// the labels list. Chosen distinct from the default triage-label palette.
export const DATASET_CLASS_LABEL_COLOUR = '5319e7';

// GitHub truncates label descriptions at 100 characters. The vocabulary's own
// prose is the description so the label and the generated glossary say the same
// thing; a rare over-length definition is trimmed with an ellipsis rather than
// rejected.
const GITHUB_LABEL_DESCRIPTION_MAX = 100;

export interface LabelDerivation {
  // Known dataset-class labels, sorted and de-duplicated.
  labels: string[];
  // Classes present in the input but absent from the vocabulary: skipped (never
  // invented as a label) and surfaced so the caller can warn loudly.
  unknownClasses: string[];
}

export interface MetaClassCollection {
  // The union of every string in every meta's `datasetClasses`, de-duplicated.
  datasetClasses: string[];
  // Human-readable messages for meta blobs that would not parse as JSON.
  parseErrors: string[];
}

export interface LabelReconciliation {
  toAdd: string[];
  toRemove: string[];
}

// True only for labels that ARE dataset-class vocabulary members. Reconcile
// uses this to confine removals to its own axis, so cross-cutting labels
// (chore, enhancement, up-next, ...) are never stripped. Own-property lookup so
// inherited Object members (toString, constructor) are not treated as classes.
export function isDatasetClassLabel(labelName: string): boolean {
  return Object.prototype.hasOwnProperty.call(FOI_DATASET_CLASSES, labelName);
}

// The description a dataset-class label should carry: the vocabulary prose,
// trimmed to GitHub's limit. Empty for an unknown class.
export function datasetClassLabelDescription(datasetClass: string): string {
  const prose = isDatasetClassLabel(datasetClass) ? FOI_DATASET_CLASSES[datasetClass] : '';
  if (prose.length <= GITHUB_LABEL_DESCRIPTION_MAX) return prose;
  return prose.slice(0, GITHUB_LABEL_DESCRIPTION_MAX - 1) + '…';
}

// Turn a set of dataset classes into the labels a PR should carry. Unknown
// classes are skipped and reported, never thrown on: a half-labelled corpus is
// worse than none, but a crash mid-sweep would leave the corpus half-labelled.
export function deriveLabelsForClasses(datasetClasses: Iterable<string>): LabelDerivation {
  const labels = new Set<string>();
  const unknown = new Set<string>();
  for (const cls of datasetClasses) {
    if (isDatasetClassLabel(cls)) labels.add(cls);
    else unknown.add(cls);
  }
  return {
    labels: [...labels].sort(),
    unknownClasses: [...unknown].sort(),
  };
}

// Read `datasetClasses` out of a batch of meta.json contents (the changed
// `archive/**/meta.json` blobs on a PR) as pure data - no branch code runs.
// A meta without the field (register snapshots) contributes nothing; a meta
// that will not parse is recorded as a parse error rather than aborting the
// batch.
export function collectDatasetClassesFromMeta(metaContents: Iterable<string>): MetaClassCollection {
  const classes = new Set<string>();
  const parseErrors: string[] = [];
  for (const content of metaContents) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      parseErrors.push(errorMessage(err));
      continue;
    }
    if (parsed === null || typeof parsed !== 'object') continue;
    const declared = (parsed as { datasetClasses?: unknown }).datasetClasses;
    if (!Array.isArray(declared)) continue;
    for (const cls of declared) {
      if (typeof cls === 'string') classes.add(cls);
    }
  }
  return { datasetClasses: [...classes], parseErrors };
}

// Given the labels a PR currently has and the labels it should have, decide the
// minimal edit. Additions are any desired label the PR lacks. Removals are
// confined to dataset-class labels the desired set no longer contains - every
// other label the PR carries is left exactly as it is.
export function reconcileDatasetClassLabels(
  current: Iterable<string>,
  desired: Iterable<string>,
): LabelReconciliation {
  const currentSet = new Set(current);
  const desiredSet = new Set(desired);
  const toAdd = [...desiredSet].filter((label) => !currentSet.has(label)).sort();
  const toRemove = [...currentSet]
    .filter((label) => isDatasetClassLabel(label) && !desiredSet.has(label))
    .sort();
  return { toAdd, toRemove };
}
