import { describe, it, expect } from 'vitest';
import { parseCallsign, loadReferenceData, componentsFlagsForRows, COMPONENT_COLUMNS, COMPONENTS_SCHEMA_VERSION } from './components.ts';

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
    expect(r).toMatchObject({ parseStatus: 'parsed', prefixSeries: '2#0', rsl: 'E', suffix: 'ABC', placeholderForm: '2#0ABC', impliedClass: 'Intermediate', flags: ['rsl-in-register'] });
  });

  it('Parse_WhenBareIntermediateWithoutRsl_NotFlaggedBecauseCoresAreTheNorm', () => {
    // Bare 20/21 values are RSL-less core callsigns - the register stores
    // cores by design, so absence of an RSL is the norm, never a flag.
    const r = parsed('20DLQ', 'Amateur Intermediate Radio Licence');
    expect(r).toMatchObject({ parseStatus: 'parsed', prefixSeries: '2#0', rsl: '', suffix: 'DLQ', placeholderForm: '2#0DLQ', impliedClass: 'Intermediate', flags: [] });
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
    expect(r).toMatchObject({ parseStatus: 'visitor', homeCallsign: 'PT2FM', prefixSeries: '', placeholderForm: '', impliedClass: '' });
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

  it('Parse_WhenLowercaseValue_ParsedCaseInsensitivelyAndFlagged', () => {
    const r = parsed('g0jrk', 'Amateur Full Radio Licence');
    expect(r).toMatchObject({ parseStatus: 'parsed', prefixSeries: 'G0', suffix: 'JRK', impliedClass: 'Full' });
    expect(r.flags).toContain('lowercase');
  });

  it('Parse_WhenWhitespaceBearing_ParsedOnCleanedValueAndFlagged', () => {
    const r = parsed('2E1HON\u00A0', 'Amateur Intermediate Radio Licence');
    expect(r).toMatchObject({ parseStatus: 'parsed', prefixSeries: '2#1', rsl: 'E', suffix: 'HON' });
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

describe('schema constants', () => {
  it('ComponentColumns_StableContract', () => {
    expect(COMPONENT_COLUMNS).toEqual(['callsign', 'parse_status', 'prefix_series', 'rsl', 'suffix', 'placeholder_form', 'home_callsign', 'implied_class', 'flags']);
    expect(COMPONENTS_SCHEMA_VERSION).toBe(4);
  });
});
