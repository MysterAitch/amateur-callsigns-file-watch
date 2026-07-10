import { describe, it, expect } from 'vitest';
import { parseCallsign, loadReferenceData, normaliseLicenceCategory, componentsFlagsForRows, cleanedCallsign, COMPONENT_COLUMNS, COMPONENTS_SCHEMA_VERSION } from './components.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The component parser splits register callsign values into constituent
// parts (prefix series, RSL, suffix) joined against reference-data/, and
// attaches per-row data-quality flags. Every fixture below reflects a value
// class observed in real Ofcom publications.

const REF = loadReferenceData();

function parsed(callsign: string, product = 'Amateur Foundation Radio Licence') {
  return parseCallsign(callsign, product, REF);
}

describe('parseCallsign', () => {
  it('Parse_WhenStandardFoundationCallsign_SplitsComponentsAndImpliesClass', () => {
    const r = parsed('M7TEE');
    expect(r).toMatchObject({
      parseStatus: 'parsed',
      prefixSeries: 'M7',
      rsl: '',
      suffix: 'TEE',
      impliedClass: 'Foundation',
      flags: [],
    });
  });

  it('Parse_WhenRegionalSecondaryLocatorPresent_ExtractedSeparately', () => {
    const r = parsed('MW7TEE');
    expect(r).toMatchObject({ parseStatus: 'parsed', prefixSeries: 'M7', rsl: 'W', suffix: 'TEE', placeholderForm: 'M#7TEE', impliedClass: 'Foundation' });
  });

  it('Parse_WhenIntermediateWithRsl_SeriesUsesPlaceholderForm', () => {
    const r = parsed('2E0ABC', 'Amateur Intermediate Radio Licence');
    expect(r).toMatchObject({ parseStatus: 'parsed', prefixSeries: '20', rsl: 'E', suffix: 'ABC', placeholderForm: '2#0ABC', impliedClass: 'Intermediate', flags: ['rsl-in-register'] });
  });

  it('Parse_WhenBareIntermediateWithoutRsl_NotFlaggedBecauseCoresAreTheNorm', () => {
    // Bare 20/21 values are RSL-less core callsigns - the register stores
    // cores by design, so absence of an RSL is the norm, never a flag.
    const r = parsed('20DLQ', 'Amateur Intermediate Radio Licence');
    expect(r).toMatchObject({ parseStatus: 'parsed', prefixSeries: '20', rsl: '', suffix: 'DLQ', placeholderForm: '2#0DLQ', impliedClass: 'Intermediate', flags: [] });
  });

  it('Parse_WhenUnknownRslLetter_Flagged', () => {
    // Temporary/special RSLs (e.g. Q in 2022, R for royal events) are not
    // enumerated in reference data - unknown letters are a reportable
    // signal, not an error.
    const r = parsed('MQ7TEE');
    expect(r).toMatchObject({ parseStatus: 'parsed', rsl: 'Q' });
    expect(r.flags).toContain('unknown-rsl');
  });

  it('Parse_WhenPrefixSeriesNotInReferenceData_Flagged', () => {
    // M2/M4/G9 are not in Ofcom's current Table 1 - honest unknown.
    const r = parsed('M2ABC', 'Amateur Full Radio Licence');
    expect(r).toMatchObject({ parseStatus: 'parsed', prefixSeries: 'M2', impliedClass: '' });
    expect(r.flags).toContain('unknown-prefix-series');
  });

  it('Parse_WhenVisitorFormat_HomeCallsignPreservedUnparsed', () => {
    const r = parsed('M/PT2FM', 'Amateur Full (Temporary Reciprocal) Radio Licence');
    expect(r).toMatchObject({ parseStatus: 'visitor', rsl: '', homeCallsign: 'PT2FM', prefixSeries: '', placeholderForm: 'M#/PT2FM', impliedClass: '' });
    expect(r.flags).not.toContain('malformed-home-callsign');
  });

  it('Parse_WhenVisitorRegionalSecondaryLocatorPresent_RslExtractedAndPlaceholderUnifies', () => {
    // MM/ (Scotland) and M/ (England) are the same visitor operating from
    // different UK nations - the RSL sits in position 2, exactly as in a
    // core callsign, so both render to the one M#/homecall placeholder.
    const r = parsed('MM/PT2FM', 'Amateur Full (Temporary Reciprocal) Radio Licence');
    expect(r).toMatchObject({ parseStatus: 'visitor', rsl: 'M', homeCallsign: 'PT2FM', placeholderForm: 'M#/PT2FM' });
    expect(r.flags).not.toContain('unknown-rsl');
  });

  it('Parse_WhenVisitorRegionalRenderingsDiffer_PlaceholderFormIsShared', () => {
    // The join key that unifies the register: every regional rendering of
    // the same reciprocal licence collapses to one placeholder_form.
    const forms = ['M/EI8DJ', 'MM/EI8DJ', 'MW/EI8DJ', 'MI/EI8DJ'].map(c => parsed(c, '').placeholderForm);
    expect(new Set(forms)).toEqual(new Set(['M#/EI8DJ']));
  });

  it('Parse_WhenVisitorRslNotAKnownLocator_UnknownRslFlagged', () => {
    const r = parsed('MZ/PT2FM', '');
    expect(r).toMatchObject({ parseStatus: 'visitor', rsl: 'Z' });
    expect(r.flags).toContain('unknown-rsl');
  });

  it('Parse_WhenReservedReciprocalHasHashAfterSlash_HomeParsesAndHashRecorded', () => {
    // The RSL sits before the slash (RSGB visitor examples M/F1ABC, MM/F1ABC,
    // MW/F1ABC), so a literal # after it (real Reserved value M/#YO3IES) is a
    // reserved-template placeholder - the home callsign parses normally and
    // the # is recorded, not mistaken for a malformed home callsign.
    const r = parsed('M/#YO3IES', 'Amateur Temporary Reciprocal Radio Licence');
    expect(r).toMatchObject({ parseStatus: 'visitor', homeCallsign: 'YO3IES', placeholderForm: 'M#/YO3IES' });
    expect(r.flags).toContain('hash-in-register');
    expect(r.flags).not.toContain('malformed-home-callsign');
  });

  it('Parse_WhenVisitorHomeIsAllDigits_MalformedHomeFlagged', () => {
    const r = parsed('M/1234', '');
    expect(r.parseStatus).toBe('visitor');
    expect(r.flags).toContain('malformed-home-callsign');
  });

  it('Parse_WhenVisitorHomeHasNoDigit_MalformedHomeFlagged', () => {
    const r = parsed('M/ABCDE', '');
    expect(r.flags).toContain('malformed-home-callsign');
  });

  it('Parse_WhenVisitorHomeIsNestedVisitorForm_MalformedHomeFlagged', () => {
    // Real register value: M/M/PT2FM - the home portion carries a stray '/'.
    const r = parsed('M/M/PT2FM', '');
    expect(r).toMatchObject({ parseStatus: 'visitor', homeCallsign: 'M/PT2FM' });
    expect(r.flags).toContain('malformed-home-callsign');
  });

  it('Parse_WhenVisitorHomeTooShort_MalformedHomeFlagged', () => {
    const r = parsed('M/AB', '');
    expect(r.flags).toContain('malformed-home-callsign');
  });

  it('Parse_WhenVisitorHomeStartsWithZeroOrOne_MalformedHomeFlagged', () => {
    // No ITU call-sign series begins with 0 or 1 (empirical:
    // reference-data/itu-call-sign-series.csv) - real register value 1CNB.
    const r = parsed('M/1CNB', '');
    expect(r.flags).toContain('malformed-home-callsign');
  });

  it('Parse_WhenVisitorHomeHasDigitFirstButValidSeries_NotFlagged', () => {
    // Digit-first home callsigns are legitimate (3DA0X, 5B4AHJ) - only
    // 0/1-first is outside every ITU series.
    const r = parsed('M/5B4AHJ', '');
    expect(r.parseStatus).toBe('visitor');
    expect(r.flags).not.toContain('malformed-home-callsign');
  });

  it('Parse_WhenGbPrefixed_ClassifiedSpecialEvent', () => {
    const r = parsed('GB100RSM', '');
    expect(r).toMatchObject({ parseStatus: 'special-event', prefixSeries: 'GB', suffix: '100RSM' });
  });

  it('Parse_WhenForbiddenSuffixAllocated_Flagged', () => {
    // ASS is on Ofcom's August 2019 FOI forbidden list; its presence in a
    // register row is exactly the anomaly the flag exists to surface.
    const r = parsed('M7ASS');
    expect(r.flags).toContain('forbidden-suffix');
  });

  it('Parse_WhenForbiddenSuffixIssuedAfterAugust2019_PostListFlagged', () => {
    // A forbidden suffix whose original start date post-dates the August 2019
    // withheld list is the interesting subset - it appears to contradict the
    // generator's stated exclusions, so it earns its own flag rather than
    // hiding inside the ~2,800 long-standing forbidden-suffix allocations.
    const r = parseCallsign('M7ASS', 'Amateur Foundation Radio Licence', REF, '2020-05-01');
    expect(r.flags).toContain('forbidden-suffix');
    expect(r.flags).toContain('forbidden-suffix-post-2019');
  });

  it('Parse_WhenForbiddenSuffixIssuedBeforeTheList_PostListNotFlagged', () => {
    // The bulk forbidden-suffix rows are long-standing allocations the list
    // never governed - a pre-2019 original start date is exactly this benign
    // case and must not gain the post-list flag.
    const r = parseCallsign('M7ASS', 'Amateur Foundation Radio Licence', REF, '2015-01-01');
    expect(r.flags).toContain('forbidden-suffix');
    expect(r.flags).not.toContain('forbidden-suffix-post-2019');
  });

  it('Parse_WhenForbiddenSuffixIssuedWithinAugust2019_PostListNotFlagged', () => {
    // The boundary is a month strictly after the list's disclosure; a date
    // within August 2019 itself cannot be shown to post-date the list, so the
    // conservative parser withholds the flag.
    const r = parseCallsign('M7ASS', 'Amateur Foundation Radio Licence', REF, '2019-08-31');
    expect(r.flags).not.toContain('forbidden-suffix-post-2019');
    expect(parseCallsign('M7ASS', 'Amateur Foundation Radio Licence', REF, '2019-09-01').flags)
      .toContain('forbidden-suffix-post-2019');
  });

  it('Parse_WhenForbiddenSuffixHasNoOriginalStartDate_PostListNotAsserted', () => {
    // Variants that carry no original-start-date column supply a blank date;
    // absence of a date is not evidence of a post-list issuance, so the flag
    // is honestly withheld (the default parameter reproduces those variants).
    expect(parseCallsign('M7ASS', 'Amateur Foundation Radio Licence', REF, '').flags)
      .not.toContain('forbidden-suffix-post-2019');
    expect(parsed('M7ASS').flags).not.toContain('forbidden-suffix-post-2019');
  });

  it('Parse_WhenSuffixAllowedButIssuedAfter2019_PostListNotAsserted', () => {
    // The post-list flag rides only on a forbidden suffix; a permitted suffix
    // issued after the list is unremarkable and gains neither flag.
    const r = parseCallsign('M7TEE', 'Amateur Foundation Radio Licence', REF, '2021-03-15');
    expect(r.flags).not.toContain('forbidden-suffix');
    expect(r.flags).not.toContain('forbidden-suffix-post-2019');
  });

  it('Parse_WhenSuffixLengthOutsideTwoToThree_Flagged', () => {
    expect(parsed('G5A', 'Amateur Full Radio Licence').flags).toContain('suffix-length-abnormal');
    expect(parsed('M7ABCD').flags).toContain('suffix-length-abnormal');
    expect(parsed('G5AB', 'Amateur Full Radio Licence').flags).not.toContain('suffix-length-abnormal');
  });

  it('Parse_WhenImpliedClassDisagreesWithProduct_Flagged', () => {
    const r = parsed('M7TEE', 'Amateur Full Radio Licence');
    expect(r.flags).toContain('class-product-mismatch');
    expect(parsed('M7TEE', 'Amateur Foundation Radio Licence').flags).not.toContain('class-product-mismatch');
  });

  it('Parse_WhenProductEmpty_NoMismatchJudgement', () => {
    // An empty product is common and asserts nothing about licensing; absence
    // of evidence is not a mismatch.
    expect(parsed('M7TEE', '').flags).not.toContain('class-product-mismatch');
  });

  it('CleanedCallsign_PublisherArtefacts_UnifyToOneJoinKey', () => {
    // The artefact-unifying join key (v5): NBSP, spaces, replacement
    // characters and case damage all clean away; / survives (visitor
    // callsigns). A join key, not an identity - G6 FMU and G6FMU
    // deliberately collide, and that visible collision is the
    // stripped-collision finding.
    expect(cleanedCallsign('2E1HON ')).toBe('2E1HON');
    expect(cleanedCallsign('G6 FMU')).toBe('G6FMU');
    expect(cleanedCallsign('G6FMU')).toBe('G6FMU');
    expect(cleanedCallsign('g0jrk')).toBe('G0JRK');
    expect(cleanedCallsign('G0TQK�')).toBe('G0TQK');
    expect(cleanedCallsign('M/EI-8-DJ')).toBe('M/EI8DJ');
    expect(cleanedCallsign('')).toBe('');
  });

  it('Parse_WhenLowercaseValue_ParsedCaseInsensitivelyAndFlagged', () => {
    const r = parsed('g0jrk', 'Amateur Full Radio Licence');
    expect(r).toMatchObject({ parseStatus: 'parsed', prefixSeries: 'G0', suffix: 'JRK', impliedClass: 'Full' });
    expect(r.flags).toContain('lowercase');
  });

  it('Parse_WhenWhitespaceBearing_ParsedOnCleanedValueAndFlagged', () => {
    const r = parsed('2E1HON\u00A0', 'Amateur Intermediate Radio Licence');
    expect(r).toMatchObject({ parseStatus: 'parsed', prefixSeries: '21', rsl: 'E', suffix: 'HON' });
    expect(r.flags).toContain('whitespace');
  });

  it('Parse_WhenEncodingFailureCharacter_ParsedOnCleanedValueAndFlagged', () => {
    const r = parsed('G0TQK\uFFFD', 'Amateur Full Radio Licence');
    expect(r).toMatchObject({ parseStatus: 'parsed', prefixSeries: 'G0', suffix: 'TQK' });
    expect(r.flags).toContain('encoding-failure');
  });

  it('Parse_WhenExcelDateShape_UnparseableWithDiagnosticFlag', () => {
    const r = parsed('20-Apr', 'Amateur Intermediate Radio Licence');
    expect(r.parseStatus).toBe('unparseable');
    expect(r.flags).toContain('excel-date-shape');
  });

  it('Parse_WhenEmptyValue_StatusEmpty', () => {
    expect(parsed('').parseStatus).toBe('empty');
  });

  it('Parse_WhenNoPatternMatches_Unparseable', () => {
    expect(parsed(',,').parseStatus).toBe('unparseable');
    expect(parsed('NANAAA').parseStatus).toBe('unparseable');
  });
});

describe('componentsFlagsForRows', () => {
  it('CrossRowFlags_WhenStrippedFormCoexists_FlaggedStrippedCollision', () => {
    // Confirmed double-listings: the junk-stripped form of an anomalous
    // value also exists as its own row.
    const rows = [
      ['G0TQK\u00A0', 'Amateur Full Radio Licence'],
      ['G0TQK', 'Amateur Full Radio Licence'],
      ['M7TEE', 'Amateur Foundation Radio Licence'],
    ];
    const parsedRows = componentsFlagsForRows(rows.map(([c, p]) => parseCallsign(c, p, REF)));
    expect(parsedRows[0].flags).toContain('stripped-collision');
    expect(parsedRows[1].flags).not.toContain('stripped-collision');
    expect(parsedRows[2].flags).not.toContain('stripped-collision');
  });
});

describe('reference data loading', () => {
  it('ReferenceData_LoadsFromRepoRootRegardlessOfCwd', () => {
    expect(REF.rslLetters.has('W')).toBe(true);
    expect(REF.prefixSeries.get('M7')?.stationLevel).toBe('Foundation');
    expect(REF.forbiddenSuffixes.has('ASS')).toBe(true);
    expect(REF.forbiddenSuffixes.size).toBe(1465);
  });
});

describe('normaliseLicenceCategory', () => {
  it('LicenceCategory_WhenSourceVintagesDiffer_CollapseToOneCategory', () => {
    // The same class written differently by source vintage maps to one
    // canonical category (the vocabulary-drift collapse).
    expect(normaliseLicenceCategory('Full', REF)).toBe('Full');
    expect(normaliseLicenceCategory('Amateur Full Radio Licence', REF)).toBe('Full');
    expect(normaliseLicenceCategory('Foundation', REF)).toBe('Foundation');
    expect(normaliseLicenceCategory('Amateur Foundation Radio Licence', REF)).toBe('Foundation');
  });

  it('LicenceCategory_WhenReciprocalVariants_KeptDistinct', () => {
    // A temporary visitor authorisation and a permanent full-on-reciprocal
    // licence are different products - they must not collapse together.
    expect(normaliseLicenceCategory('Amateur Temporary Reciprocal Radio Licence', REF)).toBe('Temporary Reciprocal');
    expect(normaliseLicenceCategory('Amateur Full (Reciprocal) Radio Licence', REF)).toBe('Full Reciprocal');
  });

  it('LicenceCategory_WhenBlank_IsNotACategory', () => {
    // A blank product asserts no class; it is not forced into a category.
    expect(normaliseLicenceCategory('', REF)).toBeNull();
    expect(normaliseLicenceCategory('   ', REF)).toBeNull();
  });

  it('LicenceCategory_WhenUnmappedNonBlank_ReturnsNullToSurface', () => {
    // An unrecognised non-blank product surfaces as null (fail loud) rather
    // than being silently bucketed into a category.
    expect(normaliseLicenceCategory('Amateur Novice Radio Licence', REF)).toBeNull();
  });
});

describe('schema constants', () => {
  it('ComponentColumns_StableContract', () => {
    expect(COMPONENT_COLUMNS).toEqual(['callsign', 'cleaned', 'parse_status', 'prefix_series', 'rsl', 'suffix', 'placeholder_form', 'home_callsign', 'implied_class', 'flags']);
    expect(COMPONENTS_SCHEMA_VERSION).toBe(5);
  });
});
