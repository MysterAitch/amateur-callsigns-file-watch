import { describe, it, expect } from 'vitest';
import { FOI_DATASET_CLASSES } from '../shared/foi-archive.ts';
import {
  isDatasetClassLabel,
  datasetClassLabelDescription,
  deriveLabelsForClasses,
  collectDatasetClassesFromMeta,
  reconcileDatasetClassLabels,
} from './dataset-class-labels.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// These cover the pure derivation core of issue #158: turning an FOI entry's
// `datasetClasses` (the single vocabulary in FOI_DATASET_CLASSES) into the set
// of GitHub labels a data PR should carry, and reconciling that desired set
// against the labels a PR already has - never crashing on messy input, since a
// half-labelled corpus is worse than none.

describe('dataset-class label derivation', { tags: ['unit'] }, () => {
  describe('isDatasetClassLabel', () => {
    it('IsDatasetClassLabel_VocabularyKey_ReturnsTrue', () => {
      expect(isDatasetClassLabel('register-snapshot')).toBe(true);
      expect(isDatasetClassLabel('issuance-events')).toBe(true);
    });

    it('IsDatasetClassLabel_NonVocabularyLabel_ReturnsFalse', () => {
      // Cross-cutting labels (triage, workflow) must never be mistaken for the
      // dataset-class axis, or reconciliation could strip them.
      expect(isDatasetClassLabel('chore')).toBe(false);
      expect(isDatasetClassLabel('enhancement')).toBe(false);
      expect(isDatasetClassLabel('up-next')).toBe(false);
    });

    it('IsDatasetClassLabel_PrototypePollutantName_ReturnsFalse', () => {
      // Guard against inherited Object properties masquerading as vocabulary
      // members (the lookup must be own-property only).
      expect(isDatasetClassLabel('toString')).toBe(false);
      expect(isDatasetClassLabel('constructor')).toBe(false);
    });
  });

  describe('datasetClassLabelDescription', () => {
    it('DatasetClassLabelDescription_KnownClass_MirrorsVocabularyProse', () => {
      // The label description is the vocabulary's own prose so the label and
      // the glossary say the same thing - one vocabulary everywhere.
      const prose = FOI_DATASET_CLASSES['statistics-aggregate'];
      expect(datasetClassLabelDescription('statistics-aggregate')).toBe(prose);
    });

    it('DatasetClassLabelDescription_LongProse_FitsGitHubHundredCharLimit', () => {
      for (const cls of Object.keys(FOI_DATASET_CLASSES)) {
        expect(datasetClassLabelDescription(cls).length).toBeLessThanOrEqual(100);
      }
    });

    it('DatasetClassLabelDescription_UnknownClass_ReturnsEmptyString', () => {
      expect(datasetClassLabelDescription('not-a-real-class')).toBe('');
    });
  });

  describe('deriveLabelsForClasses', () => {
    it('DeriveLabels_SingleKnownClass_ReturnsThatLabel', () => {
      const result = deriveLabelsForClasses(['register-snapshot']);
      expect(result.labels).toEqual(['register-snapshot']);
      expect(result.unknownClasses).toEqual([]);
    });

    it('DeriveLabels_MultipleClasses_ReturnsSortedDedupedLabels', () => {
      const result = deriveLabelsForClasses([
        'issuance-events',
        'attribute-addendum',
        'issuance-events',
      ]);
      expect(result.labels).toEqual(['attribute-addendum', 'issuance-events']);
      expect(result.unknownClasses).toEqual([]);
    });

    it('DeriveLabels_EmptyClasses_ReturnsNoLabels', () => {
      const result = deriveLabelsForClasses([]);
      expect(result.labels).toEqual([]);
      expect(result.unknownClasses).toEqual([]);
    });

    it('DeriveLabels_ClassOutsideVocabulary_SkippedAndReportedNotCrashed', () => {
      // A class not in the vocabulary is skipped (never invented as a label)
      // and surfaced so the caller can warn - it must not throw.
      const result = deriveLabelsForClasses(['register-snapshot', 'mystery-class']);
      expect(result.labels).toEqual(['register-snapshot']);
      expect(result.unknownClasses).toEqual(['mystery-class']);
    });
  });

  describe('collectDatasetClassesFromMeta', () => {
    const metaWith = (classes: unknown): string =>
      JSON.stringify({ schemaVersion: 1, datasetClasses: classes });

    it('CollectClasses_SingleMeta_ReturnsItsClasses', () => {
      const result = collectDatasetClassesFromMeta([metaWith(['register-snapshot'])]);
      expect(result.datasetClasses.sort()).toEqual(['register-snapshot']);
      expect(result.parseErrors).toEqual([]);
    });

    it('CollectClasses_MultipleMetaFiles_UnionsTheirClasses', () => {
      const result = collectDatasetClassesFromMeta([
        metaWith(['register-snapshot']),
        metaWith(['issuance-events', 'attribute-addendum']),
        metaWith(['register-snapshot']),
      ]);
      expect(result.datasetClasses.sort()).toEqual([
        'attribute-addendum',
        'issuance-events',
        'register-snapshot',
      ]);
      expect(result.parseErrors).toEqual([]);
    });

    it('CollectClasses_MetaWithoutDatasetClassesField_ContributesNothing', () => {
      // Register-snapshot archive entries carry a meta.json with no
      // datasetClasses field; they simply contribute no dataset-class labels
      // rather than erroring.
      const result = collectDatasetClassesFromMeta([
        JSON.stringify({ schemaVersion: 1, sourceKey: 'ofcom-amateur-callsigns' }),
      ]);
      expect(result.datasetClasses).toEqual([]);
      expect(result.parseErrors).toEqual([]);
    });

    it('CollectClasses_MalformedJson_ReportedAsParseErrorNotCrashed', () => {
      const result = collectDatasetClassesFromMeta(['{ this is not json']);
      expect(result.datasetClasses).toEqual([]);
      expect(result.parseErrors).toHaveLength(1);
    });

    it('CollectClasses_NonStringClassEntries_Ignored', () => {
      const result = collectDatasetClassesFromMeta([metaWith(['register-snapshot', 42, null])]);
      expect(result.datasetClasses.sort()).toEqual(['register-snapshot']);
    });
  });

  describe('reconcileDatasetClassLabels', () => {
    it('Reconcile_MissingDesiredLabel_ScheduledForAddition', () => {
      const result = reconcileDatasetClassLabels(['chore'], ['register-snapshot']);
      expect(result.toAdd).toEqual(['register-snapshot']);
      expect(result.toRemove).toEqual([]);
    });

    it('Reconcile_StaleDatasetClassLabel_ScheduledForRemoval', () => {
      // The meta no longer implies 'issuance-events'; that (vocabulary) label
      // is removed so the labels stay a faithful derived surface.
      const result = reconcileDatasetClassLabels(
        ['issuance-events', 'register-snapshot'],
        ['register-snapshot'],
      );
      expect(result.toAdd).toEqual([]);
      expect(result.toRemove).toEqual(['issuance-events']);
    });

    it('Reconcile_NonDatasetClassLabels_LeftUntouched', () => {
      // Cross-cutting labels are never removed even when absent from the
      // desired dataset-class set - reconciliation owns only its own axis.
      const result = reconcileDatasetClassLabels(
        ['chore', 'enhancement', 'up-next'],
        ['register-snapshot'],
      );
      expect(result.toAdd).toEqual(['register-snapshot']);
      expect(result.toRemove).toEqual([]);
    });

    it('Reconcile_AlreadyCorrect_NoChanges', () => {
      const result = reconcileDatasetClassLabels(
        ['chore', 'register-snapshot'],
        ['register-snapshot'],
      );
      expect(result.toAdd).toEqual([]);
      expect(result.toRemove).toEqual([]);
    });

    it('Reconcile_AddAndRemoveTogether_BothReportedSorted', () => {
      const result = reconcileDatasetClassLabels(
        ['forbidden-list', 'register-snapshot'],
        ['attribute-addendum', 'register-snapshot'],
      );
      expect(result.toAdd).toEqual(['attribute-addendum']);
      expect(result.toRemove).toEqual(['forbidden-list']);
    });

    it('Reconcile_EmptyDesired_RemovesOnlyDatasetClassLabels', () => {
      const result = reconcileDatasetClassLabels(['chore', 'register-snapshot'], []);
      expect(result.toAdd).toEqual([]);
      expect(result.toRemove).toEqual(['register-snapshot']);
    });
  });
});
