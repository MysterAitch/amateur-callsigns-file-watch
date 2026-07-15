import { describe, it, expect } from 'vitest';
import { FOI_DATASET_CLASSES } from '../shared/foi-archive.ts';
import { GLOSSARY_ANCHORS } from './render/glossary.ts';
import {
  DATASET_CLASS_OVERVIEWS,
  datasetClassOverview,
  humaniseClassKey,
} from './dataset-class-overviews.ts';

// Test names follow Subject_Scenario_Outcome per project convention. These pin
// the authored per-type overview content (issue #470) to the vocabulary and the
// glossary so a drift — a new dataset type without an overview, a link to a
// retired sibling, or a glossary anchor that no longer exists — fails CI rather
// than shipping a half-explained or dangling page.

describe('dataset-type overview content', { tags: ['unit'] }, () => {
  it('DatasetTypeOverviews_EveryVocabularyClass_HasAnAuthoredOverview', () => {
    // The overview keys and the vocabulary keys must be exactly the same set:
    // no dataset type ships without an overview, and no overview describes a
    // type the vocabulary does not define.
    expect(Object.keys(DATASET_CLASS_OVERVIEWS).sort()).toEqual(Object.keys(FOI_DATASET_CLASSES).sort());
  });

  it('DatasetTypeOverviews_EveryOverview_CarriesShapeProvenanceAndAtLeastOneRelation', () => {
    for (const [cls, overview] of Object.entries(DATASET_CLASS_OVERVIEWS)) {
      expect(overview.shape.trim().length, `${cls} has no shape prose`).toBeGreaterThan(0);
      expect(overview.provenanceAndQuirks.trim().length, `${cls} has no provenance prose`).toBeGreaterThan(0);
      expect(overview.relatedTypes.length, `${cls} relates to no other type`).toBeGreaterThan(0);
    }
  });

  it('DatasetTypeOverviews_EveryRelatedType_IsAKnownVocabularyMemberAndNotItself', () => {
    for (const [cls, overview] of Object.entries(DATASET_CLASS_OVERVIEWS)) {
      for (const rt of overview.relatedTypes) {
        expect(Object.prototype.hasOwnProperty.call(FOI_DATASET_CLASSES, rt.cls), `${cls} relates to unknown type ${rt.cls}`).toBe(true);
        expect(rt.cls, `${cls} relates to itself`).not.toBe(cls);
        expect(rt.relation.trim().length, `${cls} → ${rt.cls} has no relation note`).toBeGreaterThan(0);
      }
    }
  });

  it('DatasetTypeOverviews_EveryGlossaryAnchor_ResolvesToARegisteredTerm', () => {
    for (const [cls, overview] of Object.entries(DATASET_CLASS_OVERVIEWS)) {
      for (const anchor of overview.glossary) {
        expect(Object.prototype.hasOwnProperty.call(GLOSSARY_ANCHORS, anchor), `${cls} links unknown glossary anchor ${anchor}`).toBe(true);
      }
    }
  });

  it('DatasetClassOverview_KnownKey_ReturnsContentAndUnknownKey_ReturnsUndefined', () => {
    expect(datasetClassOverview('register-snapshot')).toBeDefined();
    expect(datasetClassOverview('not-a-real-type')).toBeUndefined();
    // Inherited Object members must not be mistaken for a type's overview.
    expect(datasetClassOverview('toString')).toBeUndefined();
  });

  it('HumaniseClassKey_KebabCaseKey_BecomesSentenceCase', () => {
    expect(humaniseClassKey('register-snapshot')).toBe('Register snapshot');
    expect(humaniseClassKey('available-pool')).toBe('Available pool');
    expect(humaniseClassKey('attribute-addendum')).toBe('Attribute addendum');
    // A single-word key is simply capitalised.
    expect(humaniseClassKey('statistics')).toBe('Statistics');
  });
});
