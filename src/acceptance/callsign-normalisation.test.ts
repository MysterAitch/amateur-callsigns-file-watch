import { describe, it, expect } from 'vitest';
import {
  cleanedCallsign,
  parseCallsign,
  componentsFlagsForRows,
  loadReferenceData,
} from '../sources/ofcom-amateur/components.ts';

// Independent acceptance criteria for the callsign-normalisation behaviour a
// from-scratch rebuild MUST continue to satisfy (v2 reference, section A / E /
// F9). These are phrased against the STABLE pure surface (cleanedCallsign,
// parseCallsign) and worked examples drawn from real Ofcom publications, so
// they form an external bar independent of any particular implementation.
//
// Test names follow the project's Subject_Scenario_Outcome convention.

const REF = loadReferenceData();

function parse(callsign: string, product = '') {
  return parseCallsign(callsign, product, REF);
}

describe('cleaned join key (acceptance criterion A3)', () => {
  it('CleanedKey_WhenPublisherArtefactsPresent_FoldsCaseWhitespaceAndPunctuation', () => {
    // The cleaned key upper-cases and strips everything outside A-Z 0-9 /.
    // Every example below is a value class observed in the real register.
    expect(cleanedCallsign('g0jrk')).toBe('G0JRK');
    expect(cleanedCallsign('2e1GTD')).toBe('2E1GTD');
    expect(cleanedCallsign('G0TQK ')).toBe('G0TQK');
    expect(cleanedCallsign('2E1HON ')).toBe('2E1HON');
    expect(cleanedCallsign('G0TQK�')).toBe('G0TQK');
    expect(cleanedCallsign('M/EI-8-DJ')).toBe('M/EI8DJ');
    expect(cleanedCallsign('M/#PT2FM')).toBe('M/PT2FM');
    expect(cleanedCallsign('')).toBe('');
  });

  it('CleanedKey_WhenValueIsExcelMangledDate_StripsToDigitsOnly', () => {
    // A spreadsheet renders a month-suffix callsign as a date; the cleaned
    // key removes the hyphens, leaving digits (the raw value stays verbatim
    // elsewhere and the parser flags it separately).
    expect(cleanedCallsign('2020-08-20')).toBe('20200820');
  });

  it('CleanedKey_WhenInteriorSpaceCollidesWithBareForm_DeliberatelyProducesSameKey', () => {
    // A join key, NOT an identity claim: G6 FMU and G6FMU both exist as
    // register rows and collapse to one cleaned key on purpose - that visible
    // collision IS the stripped-collision finding, never proof of one station.
    expect(cleanedCallsign('G6 FMU')).toBe('G6FMU');
    expect(cleanedCallsign('G6FMU')).toBe('G6FMU');
  });
});

describe('verbatim raw value (acceptance criteria A1 / A2 / E3)', () => {
  it('RawValue_WhenLowerOrMixedCase_IsCarriedByteForByte', () => {
    // Case is never changed on the stored value - a case change would invent
    // an assertion the source did not make.
    expect(parse('g0jrk', 'Amateur Full Radio Licence').callsign).toBe('g0jrk');
    expect(parse('2e1GTD', 'Amateur Intermediate Radio Licence').callsign).toBe('2e1GTD');
  });

  it('RawValue_WhenInteriorWhitespacePresent_IsKeptNotTrimmed', () => {
    // Interior whitespace is part of the assertion; only the derived join key
    // removes it. G6 FMU stays G6 FMU on the stored value.
    expect(parse('G6 FMU', 'Amateur Full Radio Licence').callsign).toBe('G6 FMU');
  });
});

describe('placeholder-form unification (acceptance criterion F9)', () => {
  it('Placeholder_WhenRegionalRenderingsOfOneCore_CollapseToSingleKey', () => {
    // M7TEE and every regional rendering share one RSL-less placeholder form;
    // the '#' is the documented RSL slot, not junk.
    const renderings = ['M7TEE', 'ME7TEE', 'MU7TEE', 'MD7TEE', 'MJ7TEE', 'MI7TEE', 'MM7TEE', 'MW7TEE'];
    const forms = new Set(renderings.map(c => parse(c, 'Amateur Foundation Radio Licence').placeholderForm));
    expect(forms).toEqual(new Set(['M#7TEE']));
  });

  it('Placeholder_WhenIntermediateSeries_RendersSlotWithHash', () => {
    expect(parse('2E0ABC', 'Amateur Intermediate Radio Licence').placeholderForm).toBe('2#0ABC');
    expect(parse('20DLQ', 'Amateur Intermediate Radio Licence').placeholderForm).toBe('2#0DLQ');
  });

  it('Placeholder_WhenVisitorRegionalRenderings_CollapseToSingleKey', () => {
    const forms = new Set(['M/EI8DJ', 'MM/EI8DJ', 'MW/EI8DJ', 'MI/EI8DJ'].map(c => parse(c).placeholderForm));
    expect(forms).toEqual(new Set(['M#/EI8DJ']));
  });
});

describe('tolerant-then-honest parsing (acceptance criteria A4 / A6 / E5 / E12)', () => {
  it('Parse_WhenLowercaseValue_ParsedCaseInsensitivelyAndFlagged', () => {
    const r = parse('g0jrk', 'Amateur Full Radio Licence');
    expect(r.parseStatus).toBe('parsed');
    expect(r.prefixSeries).toBe('G0');
    expect(r.flags).toContain('lowercase');
  });

  it('Parse_WhenTrailingNonBreakingSpace_ParsedOnCleanedValueAndFlagged', () => {
    const r = parse('2E1HON ', 'Amateur Intermediate Radio Licence');
    expect(r.parseStatus).toBe('parsed');
    expect(r.suffix).toBe('HON');
    expect(r.flags).toContain('whitespace');
  });

  it('Parse_WhenReplacementCharacterPresent_ParsedOnCleanedValueAndFlagged', () => {
    const r = parse('G0TQK�', 'Amateur Full Radio Licence');
    expect(r.parseStatus).toBe('parsed');
    expect(r.suffix).toBe('TQK');
    expect(r.flags).toContain('encoding-failure');
  });

  it('Parse_WhenExcelDateShape_LeftUnparseableWithDiagnosticFlag', () => {
    // A month-suffix callsign mangled to a date rendering is flagged and left
    // unparseable, never repaired into a guessed callsign.
    const r = parse('20-Apr', 'Amateur Intermediate Radio Licence');
    expect(r.parseStatus).toBe('unparseable');
    expect(r.flags).toContain('excel-date-shape');
  });

  it('Parse_WhenHashAfterSlash_HomeParsesAndHashRecordedNotMistakenForMalformed', () => {
    // The RSL slot sits before the slash, so a literal '#' after it is a
    // reserved-template placeholder: stripped from the home portion, recorded,
    // never treated as a malformed home callsign.
    const r = parse('M/#PT2FM', 'Amateur Temporary Reciprocal Radio Licence');
    expect(r.parseStatus).toBe('visitor');
    expect(r.homeCallsign).toBe('PT2FM');
    expect(r.flags).toContain('hash-in-register');
    expect(r.flags).not.toContain('malformed-home-callsign');
  });
});

describe('stripped-collision cross-row finding (acceptance criteria E1 / E3)', () => {
  it('CrossRowFlags_WhenStrippedFormCoexists_FlaggedStrippedCollision', () => {
    // The junk-bearing value and its stripped form both appear as register
    // rows; the register effectively lists one callsign twice, and that stays
    // visible as a flag rather than being silently merged.
    const rows = componentsFlagsForRows([
      parseCallsign('G0TQK ', 'Amateur Full Radio Licence', REF),
      parseCallsign('G0TQK', 'Amateur Full Radio Licence', REF),
      parseCallsign('M7TEE', 'Amateur Foundation Radio Licence', REF),
    ]);
    expect(rows[0].flags).toContain('stripped-collision');
    expect(rows[2].flags).not.toContain('stripped-collision');
  });
});
