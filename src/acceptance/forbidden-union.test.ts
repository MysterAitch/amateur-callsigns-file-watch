import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { loadReferenceData, parseCallsign } from '../sources/ofcom-amateur/components.ts';

// Independent acceptance criteria for the forbidden-suffix union a rebuild
// MUST satisfy (v2 reference, section F1 / F3 / E10). The union basis is what
// keeps a suffix flagged even after a later disclosure drops it, so it is
// robust to list churn and to suspected omission errors.

const REF = loadReferenceData();
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

describe('ever-forbidden union (acceptance criterion F1)', { tags: ['data-validity'] }, () => {
  it('ForbiddenUnion_WhenLoadedFromReferenceData_HasExactly1466DistinctSuffixes', () => {
    // 1,465 shared across the 2016 and 2019 lists, plus JIZ from 2024.
    expect(REF.forbiddenSuffixes.size).toBe(1466);
  });

  it('ForbiddenReferenceData_WhenCounted_Holds1466DataRows', () => {
    // The curated table carries one row per distinct union member (header
    // excluded).
    const raw = fs.readFileSync(path.join(REPO_ROOT, 'reference-data', 'forbidden-suffixes.csv'), 'utf8');
    const dataRows = raw.split('\n').filter(l => l.trim() !== '').length - 1;
    expect(dataRows).toBe(1466);
  });

  it('ForbiddenUnion_WhenChurnedAcrossDisclosures_RetainsAddedAndDelistedSuffixes', () => {
    // JIZ was added only by the 2024 export; QNF and ZFJ appear on the
    // 2016/2019 lists but are absent from 2024. The union keeps all three.
    expect(REF.forbiddenSuffixes.has('JIZ')).toBe(true);
    expect(REF.forbiddenSuffixes.has('QNF')).toBe(true);
    expect(REF.forbiddenSuffixes.has('ZFJ')).toBe(true);
    expect(REF.forbiddenSuffixes.has('ASS')).toBe(true);
  });
});

describe('per-suffix first-known-forbidden dates (acceptance criterion F3)', { tags: ['data-validity'] }, () => {
  it('ForbiddenFirstKnown_WhenPerSuffixDatesRead_MatchDisclosureVintages', () => {
    // The bulk sit at the 2024 export's 2016-07-29 origin; QNF/ZFJ are known
    // only from the 2016-09 vintage; JIZ from 2020-12-10.
    expect(REF.forbiddenSuffixFirstKnown.get('ASS')).toBe('2016-07-29');
    expect(REF.forbiddenSuffixFirstKnown.get('QNF')).toBe('2016-09');
    expect(REF.forbiddenSuffixFirstKnown.get('ZFJ')).toBe('2016-09');
    expect(REF.forbiddenSuffixFirstKnown.get('JIZ')).toBe('2020-12-10');
  });
});

describe('forbidden-suffix flag rides on the union (acceptance criterion E10)', { tags: ['data-validity'] }, () => {
  it('Parse_WhenSuffixDelistedByLaterDisclosure_StillFlaggedFromUnion', () => {
    // A de-listed suffix stays flagged because membership is union-based, not
    // point-in-time.
    expect(parseCallsign('M7QNF', 'Amateur Foundation Radio Licence', REF).flags).toContain('forbidden-suffix');
    expect(parseCallsign('M7ZFJ', 'Amateur Foundation Radio Licence', REF).flags).toContain('forbidden-suffix');
  });

  it('Parse_WhenSuffixKnownOnlyFromLaterDisclosure_FlaggedFromUnion', () => {
    expect(parseCallsign('M7JIZ', 'Amateur Foundation Radio Licence', REF).flags).toContain('forbidden-suffix');
  });

  it('Parse_WhenForbiddenSuffixIssuedAfterItsOwnFirstKnownMonth_PostListFlagged', () => {
    // The candidate-for-scrutiny subset: a forbidden suffix whose original
    // start date post-dates THAT suffix's own first-known-forbidden month.
    // Keyed per suffix, so JIZ is judged against 2020, not 2016.
    const jizBefore = parseCallsign('M7JIZ', 'Amateur Foundation Radio Licence', REF, '2019-01-01');
    expect(jizBefore.flags).not.toContain('forbidden-suffix-issued-after-first-known-list');
    const jizAfter = parseCallsign('M7JIZ', 'Amateur Foundation Radio Licence', REF, '2021-01-01');
    expect(jizAfter.flags).toContain('forbidden-suffix-issued-after-first-known-list');
  });

  it('Parse_WhenForbiddenSuffixHasNoOriginalStartDate_PostListWithheld', () => {
    // Absence of a date asserts nothing - the post-list flag is honestly
    // withheld rather than guessed.
    expect(parseCallsign('M7ASS', 'Amateur Foundation Radio Licence', REF, '').flags)
      .not.toContain('forbidden-suffix-issued-after-first-known-list');
  });
});
