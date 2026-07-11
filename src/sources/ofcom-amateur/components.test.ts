import { describe, it, expect } from 'vitest';
import { parseCallsign, loadReferenceData, normaliseLicenceCategory, componentsFlagsForRows, cleanedCallsign, COMPONENT_COLUMNS, COMPONENTS_SCHEMA_VERSION } from './components.ts';
import { buildForbiddenSuffixHistory } from '../../ci/forbidden-suffix-history.ts';

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

  it('Parse_WhenSuffixInEverForbiddenUnion_Flagged', () => {
    // ASS is on every forbidden-list disclosure held; its presence in a
    // register row is exactly the anomaly the flag exists to surface. The flag
    // keys off the ever-forbidden UNION, not any single point-in-time list.
    const r = parsed('M7ASS');
    expect(r.flags).toContain('forbidden-suffix');
  });

  it('Parse_WhenSuffixDeListedByLaterDisclosure_StillFlaggedFromUnion', () => {
    // QNF and ZFJ appear on the 2016/2019 lists but are absent from the 2024
    // export (working theory: an artefact, not a deliberate de-listing). The
    // ever-forbidden union keeps them, so their rows stay flagged - robustness
    // to churn and to suspected omission errors is the whole point of the union.
    expect(parsed('M7QNF').flags).toContain('forbidden-suffix');
    expect(parsed('M7ZFJ').flags).toContain('forbidden-suffix');
  });

  it('Parse_WhenSuffixOnlyKnownFromLaterDisclosure_FlaggedFromUnion', () => {
    // JIZ was added by the 2024 export (first known forbidden 2020-12-10) and
    // is absent from the older lists; the union carries it, so it flags too.
    expect(parsed('M7JIZ').flags).toContain('forbidden-suffix');
  });

  it('Parse_WhenForbiddenSuffixIssuedAfterItsFirstKnownList_PostListFlagged', () => {
    // A forbidden suffix whose original start date post-dates THAT suffix's own
    // first-known-forbidden date is the interesting subset - it appears to
    // contradict the exclusions, so it earns its own flag rather than hiding
    // inside the long-standing forbidden-suffix allocations that predate the
    // list. ASS is first known forbidden 2016-07, so a 2020 issue is after it.
    const r = parseCallsign('M7ASS', 'Amateur Foundation Radio Licence', REF, '2020-05-01');
    expect(r.flags).toContain('forbidden-suffix');
    expect(r.flags).toContain('forbidden-suffix-issued-after-first-known-list');
  });

  it('Parse_WhenForbiddenSuffixIssuedBeforeAnyKnownList_PostListNotFlagged', () => {
    // The bulk forbidden-suffix rows are long-standing allocations that predate
    // the lists - a pre-2016 original start date is exactly this benign case
    // and must not gain the post-list flag. A callsign predating every known
    // list (here, a 1980 issue) is not the anomaly.
    const early = parseCallsign('M7ASS', 'Amateur Foundation Radio Licence', REF, '1980-01-01');
    expect(early.flags).toContain('forbidden-suffix');
    expect(early.flags).not.toContain('forbidden-suffix-issued-after-first-known-list');
  });

  it('Parse_WhenForbiddenSuffixIssuedWithinFirstKnownMonth_PostListNotFlagged', () => {
    // The boundary is a month strictly after the suffix's first-known-forbidden
    // month. ASS is first known 2016-07, so a date within that month cannot be
    // shown to post-date it and the conservative parser withholds the flag -
    // the following month does gain it.
    expect(parseCallsign('M7ASS', 'Amateur Foundation Radio Licence', REF, '2016-07-31').flags)
      .not.toContain('forbidden-suffix-issued-after-first-known-list');
    expect(parseCallsign('M7ASS', 'Amateur Foundation Radio Licence', REF, '2016-08-01').flags)
      .toContain('forbidden-suffix-issued-after-first-known-list');
  });

  it('Parse_WhenLateAddedSuffixIssuedBeforeItsOwnFirstKnownDate_PostListNotFlagged', () => {
    // JIZ is first known forbidden only from 2020-12-10, so a JIZ callsign
    // issued in 2019 - after the 2016 lists, but before JIZ itself was known
    // forbidden - is NOT the anomaly. The per-suffix date is what makes this
    // distinction possible; a single global 2016 boundary would misfire here.
    const before = parseCallsign('M7JIZ', 'Amateur Foundation Radio Licence', REF, '2019-01-01');
    expect(before.flags).toContain('forbidden-suffix');
    expect(before.flags).not.toContain('forbidden-suffix-issued-after-first-known-list');
    // Issued after JIZ's own first-known-forbidden month, it does gain the flag.
    const after = parseCallsign('M7JIZ', 'Amateur Foundation Radio Licence', REF, '2021-01-01');
    expect(after.flags).toContain('forbidden-suffix-issued-after-first-known-list');
  });

  it('Parse_WhenDeListedSuffixStraddlesIts2016Boundary_PostListReflectsFirstKnownMonth', () => {
    // QNF/ZFJ are known forbidden only from the 2016-09 disclosure vintage
    // (they carry no 2024 LastModifiedDate, being absent from that export), so
    // their boundary is 2016-09: an August 2016 issue is not the anomaly, an
    // October 2016 one is.
    expect(parseCallsign('M7QNF', 'Amateur Foundation Radio Licence', REF, '2016-08-01').flags)
      .not.toContain('forbidden-suffix-issued-after-first-known-list');
    expect(parseCallsign('M7QNF', 'Amateur Foundation Radio Licence', REF, '2016-10-01').flags)
      .toContain('forbidden-suffix-issued-after-first-known-list');
  });

  it('Parse_WhenForbiddenSuffixHasNoOriginalStartDate_PostListNotAsserted', () => {
    // Variants that carry no original-start-date column supply a blank date;
    // absence of a date is not evidence of a post-list issuance, so the flag
    // is honestly withheld (the default parameter reproduces those variants).
    expect(parseCallsign('M7ASS', 'Amateur Foundation Radio Licence', REF, '').flags)
      .not.toContain('forbidden-suffix-issued-after-first-known-list');
    expect(parsed('M7ASS').flags).not.toContain('forbidden-suffix-issued-after-first-known-list');
  });

  it('Parse_WhenSuffixAllowedButIssuedAfterTheList_PostListNotAsserted', () => {
    // The post-list flag rides only on a forbidden suffix; a permitted suffix
    // issued after the list is unremarkable and gains neither flag.
    const r = parseCallsign('M7TEE', 'Amateur Foundation Radio Licence', REF, '2021-03-15');
    expect(r.flags).not.toContain('forbidden-suffix');
    expect(r.flags).not.toContain('forbidden-suffix-issued-after-first-known-list');
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

  it('Parse_WhenSpreadsheetErrorToken_UnparseableWithVerbatimValueAndFlag', () => {
    // A failed workbook formula leaks its error literal into the callsign
    // column (real defect: #REF! in the ~2021 asset-210648 register). The
    // token is preserved verbatim and flagged, never treated as a callsign.
    const r = parsed('#REF!');
    expect(r.parseStatus).toBe('unparseable');
    expect(r.callsign).toBe('#REF!');
    expect(r.flags).toContain('spreadsheet-error-token');
  });

  it('Parse_WhenOtherSpreadsheetErrorLiterals_Flagged', () => {
    // The whole family of spreadsheet formula-error tokens is recognised, not
    // just #REF!, so any leaked error value surfaces rather than masquerading.
    for (const token of ['#N/A', '#VALUE!', '#DIV/0!', '#NAME?', '#NULL!', '#NUM!']) {
      const r = parsed(token);
      expect(r.parseStatus).toBe('unparseable');
      expect(r.callsign).toBe(token);
      expect(r.flags).toContain('spreadsheet-error-token');
    }
  });

  it('Parse_WhenValidCallsign_NotFlaggedAsSpreadsheetErrorToken', () => {
    // A genuine callsign must never gain the defect flag - including values
    // that merely contain the letters REF (G0REF is a real register row).
    expect(parsed('M7TEE').flags).not.toContain('spreadsheet-error-token');
    expect(parsed('G0REF', 'Amateur Club Radio Licence').flags).not.toContain('spreadsheet-error-token');
  });

  it('Parse_WhenAssetRegisterRefCells_EachFlaggedAndAllocatedRowsPreserved', () => {
    // Scenario reconstruction of the ~2021 asset-210648 defect (#335): 14
    // Status=Allocated callsign cells published as #REF! formula errors. Each
    // is kept verbatim, left unparseable and flagged; none is silently dropped.
    const refCells = Array.from({ length: 14 }, () => '#REF!');
    const rows = refCells.map(c => parseCallsign(c, 'Amateur Full Radio Licence', REF, '2021-01-15'));
    expect(rows).toHaveLength(14);
    expect(rows.every(r => r.parseStatus === 'unparseable')).toBe(true);
    expect(rows.every(r => r.callsign === '#REF!')).toBe(true);
    expect(rows.every(r => r.flags.includes('spreadsheet-error-token'))).toBe(true);
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
    // The ever-forbidden union: the 1,465 shared 2016/2019 set plus JIZ.
    expect(REF.forbiddenSuffixes.size).toBe(1466);
    expect(REF.forbiddenSuffixes.has('JIZ')).toBe(true);
  });

  it('ReferenceData_CarriesPerSuffixFirstKnownForbiddenDates', () => {
    // The per-suffix temporal anchor the after-first-known-list flag keys off:
    // the bulk sit at the 2024 export's 2016-07-29 origin; QNF/ZFJ are known
    // only from the 2016-09 disclosure vintage; JIZ from 2020-12-10.
    expect(REF.forbiddenSuffixFirstKnown.get('ASS')).toBe('2016-07-29');
    expect(REF.forbiddenSuffixFirstKnown.get('QNF')).toBe('2016-09');
    expect(REF.forbiddenSuffixFirstKnown.get('ZFJ')).toBe('2016-09');
    expect(REF.forbiddenSuffixFirstKnown.get('JIZ')).toBe('2020-12-10');
  });
});

describe('forbidden-suffix reference data vs disclosures', () => {
  // The curated reference-data/forbidden-suffixes.csv is derived one-time from
  // the forbidden-list disclosures held. This guard fails loudly if it ever
  // drifts from those disclosures: the ever-forbidden union and each suffix's
  // first-known-forbidden date must match what the disclosure history computes.
  const history = buildForbiddenSuffixHistory();

  it('ForbiddenReferenceData_UnionMatchesDisclosureDerivedUnion', () => {
    expect([...REF.forbiddenSuffixes].sort()).toEqual([...history.everForbiddenUnion].sort());
  });

  it('ForbiddenReferenceData_FirstKnownDatesMatchDisclosureDerivedDates', () => {
    const fromDisclosures = Object.fromEntries(
      history.everForbiddenUnion.map(s => [s, history.firstKnownForbidden[s].dateKey]),
    );
    const fromReference = Object.fromEntries(REF.forbiddenSuffixFirstKnown);
    expect(fromReference).toEqual(fromDisclosures);
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
