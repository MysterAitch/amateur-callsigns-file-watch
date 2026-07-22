import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Issue #904: the row-level forbidden-suffix flag is keyed off the ever-forbidden
// union (2016 ∪ 2019 ∪ 2024 = 1,466 suffixes in reference-data/forbidden-suffixes.csv),
// NOT any single dated disclosure. Three reader surfaces previously attributed
// it to "Ofcom's August 2019 FOI withheld-suffixes list" — false for union
// members that appear on no 2019 list (e.g. JIZ, first forbidden 2020-12-10).
// These guards pin the corrected union framing and assert the single-disclosure
// wording is gone, from BOTH the hand-authored glossary and the lookup app.

const SITE_DIR = import.meta.dirname;
const read = (name: string): string => fs.readFileSync(path.join(SITE_DIR, name), 'utf8');

const FALSE_ATTRIBUTION = /August 2019 FOI withheld-suffixes list/;

describe('Forbidden-suffix flag attribution — union, not a single disclosure (#904)', { tags: ['unit'] }, () => {
  it('Glossary_ForbiddenSuffixDefinition_AttributesTheUnionNotAugust2019', () => {
    const html = read('glossary.html');
    const dd = html.slice(html.indexOf('id="forbidden-suffix"'));
    const definition = dd.slice(0, dd.indexOf('</dd>'));
    expect(definition).toContain('ever-forbidden union');
    expect(definition).not.toMatch(FALSE_ATTRIBUTION);
  });

  it('LookupApp_ForbiddenSuffixCards_AttributeTheUnionNotAugust2019', () => {
    const js = read('app.js');
    // Both the suffix-lookup "Withheld suffix" card and the register-row flag
    // note now name the union across the held disclosures (2016-2024).
    const unionMentions = js.match(/ever-forbidden union/g) ?? [];
    expect(unionMentions.length).toBeGreaterThanOrEqual(2);
    expect(js).not.toMatch(FALSE_ATTRIBUTION);
  });

  it('LookupApp_ForbiddenSuffixCards_KeepTheExistingAllocationsStandCaveat', () => {
    // The correction narrows the strength of the attribution; it must NOT drop
    // the still-correct caveat that existing allocations are unaffected.
    const js = read('app.js');
    expect(js).toContain('existing allocations stand');
    expect(js).toContain('governs new issuance, not existing holdings');
  });
});
