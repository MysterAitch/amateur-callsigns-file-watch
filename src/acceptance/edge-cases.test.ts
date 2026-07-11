import { describe, it, expect } from 'vitest';
import { loadReferenceData, parseCallsign } from '../sources/ofcom-amateur/components.ts';
import { parseUkDateTimeDetailed } from '../shared/normalise.ts';
import { convertRawCsv, type ConvertContext } from '../sources/ofcom-amateur/normalise.ts';

// Independent acceptance criteria for named data-quality curiosities a rebuild
// MUST continue to surface rather than hide or repair (v2 reference, section E
// / A9). Each fixture is a real value class the register is known to contain.

const REF = loadReferenceData();

// A minimal well-formed publication in the human-friendly 2025 header variant,
// used to exercise the date-plausibility bounds through the real converter.
const FRIENDLY_HEADER = 'Call sign,Product,Status,Type,CreatedDate,LastModifiedDate';
function friendlyCsv(dataRows: string[]): string {
  return [FRIENDLY_HEADER, ...dataRows].join('\n') + '\n';
}

describe('over-length special-event callsigns (acceptance criterion E7)', () => {
  it('Parse_WhenCallsignExceedsUsualLength_CarriedVerbatimNeverRejected', () => {
    // EDUCATIONAL (11) and ENVIRONMENTS (12) are real Special Event Station
    // callsigns; they are never rejected on length - the value passes through
    // and is carried byte-for-byte.
    expect(parseCallsign('EDUCATIONAL', '', REF).callsign).toBe('EDUCATIONAL');
    expect(parseCallsign('ENVIRONMENTS', '', REF).callsign).toBe('ENVIRONMENTS');
  });
});

describe('class-product mismatch novelty (acceptance criterion E6)', () => {
  it('Parse_WhenPrefixImpliesFullButProductIsFoundation_FlaggedMismatch', () => {
    // M5SHA is the officially-acknowledged format-does-not-fit-class novelty:
    // the M5 series implies Full, so a Foundation product disagrees and is
    // surfaced, not reconciled.
    const r = parseCallsign('M5SHA', 'Amateur Foundation Radio Licence', REF);
    expect(r.impliedClass).toBe('Full');
    expect(r.flags).toContain('class-product-mismatch');
  });
});

describe('date plausibility bounds (acceptance criteria A9 / E13 / E15)', () => {
  it('DateParse_WhenRegistersOpeningDate_ParsesAsDayFirst', () => {
    // 3 May 1903 is the register's famous opening date - a genuine record that
    // parses under strict UK day-first ordering.
    expect(parseUkDateTimeDetailed('03/05/1903').iso).toBe('1903-05-03');
  });

  it('Convert_WhenDateAtOrAfterPlausibilityFloor_Accepted', () => {
    const ctx: ConvertContext = { referenceDateIso: '2026-06-23' };
    const result = convertRawCsv(friendlyCsv([
      'M7TEE,Amateur Foundation Radio Licence,Allocated,Call Sign - Amateur,03/05/1903,',
    ]), ctx);
    expect(result.recordCount).toBe(1);
  });

  it('Convert_WhenDatePredatesPlausibilityFloor_FailsLoud', () => {
    // A pre-1900 date indicates corruption, not history; the converter refuses
    // it rather than storing a wrong value.
    const ctx: ConvertContext = { referenceDateIso: '2026-06-23' };
    expect(() => convertRawCsv(friendlyCsv([
      'M7TEE,Amateur Foundation Radio Licence,Allocated,Call Sign - Amateur,31/12/1899,',
    ]), ctx)).toThrow(/1900|plausib/i);
  });

  it('Convert_WhenIssuanceDatePostdatesSnapshot_FailsLoud', () => {
    // A creation/last-modified date beyond the snapshot vintage is corruption
    // and hard-fails; only reservation-expiry columns may legitimately be in
    // the future.
    const ctx: ConvertContext = { referenceDateIso: '2020-01-01' };
    expect(() => convertRawCsv(friendlyCsv([
      'M7TEE,Amateur Foundation Radio Licence,Allocated,Call Sign - Amateur,,01/06/2021',
    ]), ctx)).toThrow(/future/i);
  });

  it('DateParse_WhenReservationExpiryInFuture_ParsesAsLegitimateEndDate', () => {
    // A 2099 reservation expiry is a legitimate validity-END value at the
    // parser surface; whether it is permitted is a per-column policy, but the
    // parser itself never rejects it as implausible.
    expect(parseUkDateTimeDetailed('31/12/2099').iso).toBe('2099-12-31');
  });
});
