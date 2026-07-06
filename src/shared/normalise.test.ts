import { describe, it, expect } from 'vitest';
import { parseUkDateTime, renderCsv } from './normalise';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The shared normalisation core: a STRICT dd/mm/yyyy parser (UK order is
// empirically proven in the raw data by day>12 values; strictness makes a
// wholesale mm/dd flip fail loudly file-wide) and a byte-deterministic CSV
// renderer (LF endings, minimal RFC-4180 quoting, no library dependence so
// dependency bumps cannot churn golden-master outputs).

describe('parseUkDateTime', () => {
  it('UkDate_WhenDateOnly_ReturnsIsoDate', () => {
    expect(parseUkDateTime('20/01/2019')).toBe('2019-01-20');
  });

  it('UkDate_WhenDateWithTime_ReturnsIsoDateTimeMinutePrecision', () => {
    expect(parseUkDateTime('20/01/2019 17:07')).toBe('2019-01-20 17:07');
  });

  it('UkDate_WhenHourUnpadded_ZeroPadsOutput', () => {
    // Observed in real data: the same record renders as '8:22' in one
    // publication and '08:22' in another. Canonical output is padded.
    expect(parseUkDateTime('03/08/2024 8:22')).toBe('2024-08-03 08:22');
  });

  it('UkDate_WhenSecondsPresent_KeepsSeconds', () => {
    expect(parseUkDateTime('20/01/2019 17:07:33')).toBe('2019-01-20 17:07:33');
  });

  it('UkDate_WhenEmpty_ReturnsEmpty', () => {
    expect(parseUkDateTime('')).toBe('');
    expect(parseUkDateTime('  ')).toBe('');
  });

  it('UkDate_WhenMonthGreaterThanTwelve_Throws', () => {
    // The mm/dd-flip alarm: in a month-first file, real days >12 land in the
    // month position and must explode rather than misparse.
    expect(() => parseUkDateTime('05/26/2019')).toThrow(/month/i);
  });

  it('UkDate_WhenDayInvalidForMonth_Throws', () => {
    expect(() => parseUkDateTime('31/02/2019')).toThrow();
    expect(() => parseUkDateTime('00/01/2019')).toThrow();
  });

  it('UkDate_WhenFormatUnrecognised_Throws', () => {
    expect(() => parseUkDateTime('2019-01-20')).toThrow(); // already ISO - not raw's format
    expect(() => parseUkDateTime('20 Jan 2019')).toThrow();
    expect(() => parseUkDateTime('20/01/19')).toThrow(); // two-digit year
  });

  it('UkDate_WhenLeapDayValid_Parses', () => {
    expect(parseUkDateTime('29/02/2024')).toBe('2024-02-29');
    expect(() => parseUkDateTime('29/02/2023')).toThrow();
  });
});

describe('renderCsv', () => {
  it('RenderCsv_WhenSimpleRows_ProducesLfTerminatedOutput', () => {
    const out = renderCsv(['a', 'b'], [['1', '2'], ['3', '4']]);
    expect(out).toBe('a,b\n1,2\n3,4\n');
  });

  it('RenderCsv_WhenValueContainsCommaQuoteOrNewline_QuotesMinimally', () => {
    const out = renderCsv(['col'], [['plain'], ['has,comma'], ['has"quote'], ['has\nnewline']]);
    expect(out).toBe('col\nplain\n"has,comma"\n"has""quote"\n"has\nnewline"\n');
  });

  it('RenderCsv_WhenCalledTwiceWithSameInput_ByteIdentical', () => {
    const rows = [['M7TEE', 'Allocated'], ['G5ABC', 'Available']];
    expect(renderCsv(['callsign', 'status'], rows)).toBe(renderCsv(['callsign', 'status'], rows));
  });

  it('RenderCsv_WhenEmptyCells_RendersEmptyUnquoted', () => {
    expect(renderCsv(['a', 'b', 'c'], [['x', '', 'z']])).toBe('a,b,c\nx,,z\n');
  });
});
