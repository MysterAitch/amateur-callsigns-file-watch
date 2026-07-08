import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { renderFoiSchemas, SCHEMAS_FILE } from './foi-schemas.ts';
import { FOI_ENTRY_CONVERSIONS } from '../shared/foi-normalise.ts';
import { FOI_DATASET_CLASSES } from '../shared/foi-archive.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// docs/foi-schemas.md is the published FOI schema registry (issue #149
// Phase A), generated from the same authored values validation enforces.
// The freshness check makes "the schemas doc is always current" a CI
// property, exactly like dataset-status.md.

describe('FOI schema registry doc', () => {
  it('FoiSchemas_CommittedFile_MatchesRegenerationExactly', () => {
    const committed = fs.readFileSync(SCHEMAS_FILE, 'utf8');
    expect(
      committed,
      'docs/foi-schemas.md is stale for this registry - run `npm run foi:schemas` and commit the regenerated file',
    ).toBe(renderFoiSchemas());
  });

  it('FoiSchemas_Rendering_ListsEveryRegistryVariant', () => {
    const rendered = renderFoiSchemas();
    for (const variant of Object.keys(FOI_ENTRY_CONVERSIONS)) {
      expect(rendered).toContain(`### \`${variant}\``);
    }
  });

  it('FoiSchemas_Rendering_ListsDatasetClassVocabulary', () => {
    const rendered = renderFoiSchemas();
    for (const cls of Object.keys(FOI_DATASET_CLASSES)) {
      expect(rendered).toContain(`| \`${cls}\` |`);
    }
  });

  it('FoiSchemas_VariantSections_CarryOutputColumnsAndRowOrderRationale', () => {
    const rendered = renderFoiSchemas();
    // Anchor: the tier-1 pattern-setter's extension column and its rationale.
    expect(rendered).toContain('`reserved_to_date`');
    expect(rendered).toContain('sorted by callsign for diffability');
  });
});
