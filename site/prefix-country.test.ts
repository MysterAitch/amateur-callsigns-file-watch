import { describe, it, expect } from 'vitest';
import { countryForCallsign, stripVisitorPrefix, parseSeries } from './prefix-country.js';

// The prefix-country resolver names the ITU-allocated holder of a visitor call
// sign's international series, from the Appendix 42 series ranges. These pin the
// resolution logic - the visitor-prefix strip, longest-prefix range matching,
// and the honest "we cannot tell" outcomes - independently of any DOM or
// database. Test names follow Subject_Scenario_Outcome per project convention.

// A miniature slice of reference-data/itu-call-sign-series.csv: every real row
// pins the first two characters and spans the third A-Z, so the fixture does
// too. It includes a block split on the third letter (3D: Eswatini/Fiji), the
// two-row Ireland allocation, and a whole-first-letter block (N: USA).
const ITU = [
  { series: 'EIA - EIZ', allocated_to: 'Ireland' },
  { series: 'EJA - EJZ', allocated_to: 'Ireland' },
  { series: 'EAA - EAZ', allocated_to: 'Spain' },
  { series: '3DA - 3DM', allocated_to: 'Eswatini (Kingdom of)' },
  { series: '3DN - 3DZ', allocated_to: 'Fiji (Republic of)' },
  { series: 'NAA - NAZ', allocated_to: 'United States of America' },
  { series: 'NBA - NBZ', allocated_to: 'United States of America' },
  { series: 'PPA - PYZ', allocated_to: 'Brazil (Federative Republic of)' },
  { series: 'PTA - PTZ', allocated_to: 'Brazil (Federative Republic of)' },
];

describe('stripVisitorPrefix', () => {
  it('StripVisitorPrefix_WhenPlainMPrefix_RemovesIt', () => {
    expect(stripVisitorPrefix('M/EI8DJ')).toBe('EI8DJ');
  });
  it('StripVisitorPrefix_WhenRegionalPrefixVariants_RemovesEachForm', () => {
    // The RSL rides in the second position: M/ MM/ MW/ MI/ MD/ MJ/ MU/.
    for (const p of ['M/', 'MM/', 'MW/', 'MI/', 'MD/', 'MJ/', 'MU/']) {
      expect(stripVisitorPrefix(`${p}EI8DJ`)).toBe('EI8DJ');
    }
  });
  it('StripVisitorPrefix_WhenNoVisitorPrefix_ReturnsUnchanged', () => {
    // A bare home call, or a UK call whose leading M is not a visitor prefix.
    expect(stripVisitorPrefix('EI8DJ')).toBe('EI8DJ');
    expect(stripVisitorPrefix('MM0ABC')).toBe('MM0ABC');
  });
  it('StripVisitorPrefix_WhenPortableSuffixPresent_LeavesTrailingSlash', () => {
    // Only the leading visitor prefix is stripped; a portable suffix survives.
    expect(stripVisitorPrefix('M/EI8DJ/P')).toBe('EI8DJ/P');
  });
});

describe('parseSeries', () => {
  it('ParseSeries_WhenRangeCell_SplitsStartAndEnd', () => {
    expect(parseSeries('EIA - EIZ')).toEqual({ start: 'EIA', end: 'EIZ' });
  });
  it('ParseSeries_WhenMalformed_ReturnsNull', () => {
    expect(parseSeries('not a range')).toBeNull();
  });
});

describe('countryForCallsign', () => {
  it('VisitorCallsign_WhenIrishHomeCall_ResolvesToIreland', () => {
    // The worked example: M/EI8DJ -> EI8DJ -> EI block -> Ireland.
    const r = countryForCallsign('M/EI8DJ', ITU);
    expect(r.status).toBe('resolved');
    expect(r.country).toBe('Ireland');
    expect(r.home).toBe('EI8DJ');
    expect(r.visitorPrefix).toBe('M/');
  });

  it('VisitorCallsign_WhenRegionalPrefix_ResolvesSameCountry', () => {
    // MW/ (Wales) is the same visitor operating from a different UK nation.
    const r = countryForCallsign('MW/EI8DJ', ITU);
    expect(r.status).toBe('resolved');
    expect(r.country).toBe('Ireland');
    expect(r.visitorPrefix).toBe('MW/');
  });

  it('NonVisitorCallsign_WhenNoSlash_StillResolvesItsOwnSeries', () => {
    // A bare home call (no visitor prefix, no '/') resolves its own prefix.
    const r = countryForCallsign('EA4ABC', ITU);
    expect(r.status).toBe('resolved');
    expect(r.country).toBe('Spain');
    expect(r.visitorPrefix).toBe('');
  });

  it('SingleLetterPrefix_WhenDigitInSecondPosition_UsesWholeFirstLetterBlock', () => {
    // N1AA has a single-letter N prefix; the whole N block is USA here.
    const r = countryForCallsign('M/N1AA', ITU);
    expect(r.status).toBe('resolved');
    expect(r.country).toBe('United States of America');
    expect(r.basis).toContain('whole N block');
  });

  it('SplitBlock_WhenThirdCharIsLetter_LongestPrefixMatchWins', () => {
    // 3DM falls in the Eswatini sub-range, 3DN in the Fiji sub-range - the
    // specific three-character range wins over the broader two-character block.
    expect(countryForCallsign('M/3DMAB', ITU).country).toBe('Eswatini (Kingdom of)');
    expect(countryForCallsign('M/3DNAB', ITU).country).toBe('Fiji (Republic of)');
  });

  it('SplitBlock_WhenThirdCharIsDigit_IsAmbiguousNotGuessed', () => {
    // 3D2AB (Fiji in practice) has a digit third char, so the series table
    // alone cannot choose between Eswatini and Fiji - list both, never guess.
    const r = countryForCallsign('M/3D2AB', ITU);
    expect(r.status).toBe('ambiguous');
    expect(r.candidates.map((c) => c.country).sort()).toEqual(['Eswatini (Kingdom of)', 'Fiji (Republic of)']);
  });

  it('OverlappingRanges_WhenBroadAndNarrowBothContain_NarrowerWins', () => {
    // Robustness beyond the real (non-overlapping) table: given a broad range
    // and a narrower one that both contain the key, the more specific (longer
    // shared prefix) allocation wins.
    const overlapping = [
      { series: 'AAA - AZZ', allocated_to: 'Wideland' },
      { series: 'ABA - ABZ', allocated_to: 'Narrowia' },
    ];
    expect(countryForCallsign('ABX', overlapping).country).toBe('Narrowia');
  });

  it('MultiLetterPrefix_WhenTwoLetterBlock_ResolvesFromTwoCharBlock', () => {
    // PT2FM (Brazil): a two-letter prefix with a digit third char resolves via
    // the PT two-character block.
    const r = countryForCallsign('M/PT2FM', ITU);
    expect(r.status).toBe('resolved');
    expect(r.country).toBe('Brazil (Federative Republic of)');
    expect(r.basis).toContain('PT block');
  });

  it('UnallocatedPrefix_WhenFirstCharAbsentFromTable_ReportsUnallocated', () => {
    const r = countryForCallsign('M/QZ1ABC', ITU);
    expect(r.status).toBe('unallocated');
    expect(r.country).toBeNull();
  });

  it('MalformedInput_WhenNoAlphanumerics_ReportsMalformed', () => {
    const r = countryForCallsign('M//', ITU);
    expect(r.status).toBe('malformed');
    expect(r.country).toBeNull();
  });
});
