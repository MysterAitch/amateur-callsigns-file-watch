import { describe, it, expect } from 'vitest';
import { detectHeaderVariant, callsignColumnFor, convertRawCsv, NORMALISED_SCHEMA_VERSION, CANONICAL_COLUMNS } from './normalise';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The ofcom-amateur converter maps each known raw header variant onto the
// canonical v1 schema. Fixtures below reproduce the real header shapes (and
// quirks: BOM, unpadded hours, missing Type column) observed across the
// archive's publications from 2023 to 2026. Unknown headers must fail loudly:
// a new Ofcom variant is a reviewed code change, never a guess.

// Variant fixtures - headers are verbatim from real publications.
const SALESFORCE_RAW =
  'Value__c,Product__c,Status__c,Type__c,CreatedDate,LastModifiedDate\n' +
  'M0IVB,Amateur Full Radio Licence,Allocated,Call Sign - Amateur,20/01/2019,21/04/2024\n' +
  'M5TX,,Available,Call Sign - Amateur,21/01/2019,21/01/2019\n';

const FRIENDLY_LABELS =
  'Call sign,Product,Status,Type,CreatedDate,LastModifiedDate\n' +
  'M0IVB,Amateur Full Radio Licence,Allocated,Call Sign - Amateur,20/01/2019 17:07,21/04/2024 19:08\n' +
  'M7ACX,Amateur Foundation Radio Licence,Allocated,Call Sign - Amateur,21/01/2019 16:50,03/08/2024 8:22\n';

const LICENCE_VERSION_BOM =
  '﻿Callsign,Product__c,Status,Type__c,Licence_Version.LastModifiedDate,Licence_Version.Original_start_date__c\n' +
  'M0IVB,Amateur Full Radio Licence,Allocated,Call Sign - Amateur,11/10/2025,20/01/2019\n' +
  '20DLQ,Amateur Intermediate Radio Licence,Allocated,Call Sign - Amateur,11/10/2025,29/05/2015\n';

const MMSI_LABELLED =
  'Value,Status,Product,Call Sign MMSI: Last Modified Date\n' +
  'M3YVL,Allocated,Amateur Foundation Radio Licence,23/07/2016\n' +
  '2E0ABC,Allocated,Amateur Intermediate Radio Licence,05/03/2020\n';

// Reference date for plausibility checks - dates in raw must not exceed it.
const FETCH_CONTEXT = { referenceDateIso: '2026-07-06' };

function lines(csv: string): string[] {
  return csv.trimEnd().split('\n');
}

describe('detectHeaderVariant', () => {
  it('HeaderVariant_WhenSalesforceRawHeaders_Detected', () => {
    expect(detectHeaderVariant(['Value__c', 'Product__c', 'Status__c', 'Type__c', 'CreatedDate', 'LastModifiedDate'])).toBe('v2025-salesforce');
  });

  it('HeaderVariant_WhenFriendlyLabels_Detected', () => {
    expect(detectHeaderVariant(['Call sign', 'Product', 'Status', 'Type', 'CreatedDate', 'LastModifiedDate'])).toBe('v2025-friendly');
  });

  it('HeaderVariant_WhenLicenceVersionColumns_Detected', () => {
    expect(detectHeaderVariant(['Callsign', 'Product__c', 'Status', 'Type__c', 'Licence_Version.LastModifiedDate', 'Licence_Version.Original_start_date__c'])).toBe('v2026-licence-version');
  });

  it('HeaderVariant_WhenMmsiLabelledColumns_Detected', () => {
    expect(detectHeaderVariant(['Value', 'Status', 'Product', 'Call Sign MMSI: Last Modified Date'])).toBe('v2023-mmsi');
  });

  it('HeaderVariant_WhenUnknownHeaders_ReturnsUndefined', () => {
    expect(detectHeaderVariant(['Callsign', 'SomethingNew', 'Status'])).toBeUndefined();
  });
});

describe('callsignColumnFor', () => {
  // Issue #4: sorting must find the callsign column by NAME (drawn from the
  // variant registry, so new variants keep it in sync automatically), never
  // by position - an upstream column reorder must not silently change what
  // latest-raw-sorted.csv is sorted by.

  it('CallsignColumn_WhenKnownVariantHeaders_ReturnsTheCallsignColumn', () => {
    expect(callsignColumnFor(['Value__c', 'Product__c', 'Status__c'])).toBe('Value__c');
    expect(callsignColumnFor(['Call sign', 'Product', 'Status'])).toBe('Call sign');
    expect(callsignColumnFor(['Value', 'Status', 'Product'])).toBe('Value');
    expect(callsignColumnFor(['Callsign', 'Product__c', 'Status'])).toBe('Callsign');
  });

  it('CallsignColumn_WhenColumnsReordered_StillFoundByName', () => {
    expect(callsignColumnFor(['Product__c', 'Status__c', 'Value__c'])).toBe('Value__c');
  });

  it('CallsignColumn_WhenHeaderCarriesBom_MatchesThroughBomAndReturnsOriginalKey', () => {
    // process.ts parses without bom stripping, so the first header can arrive
    // BOM-prefixed; the ORIGINAL key must come back or record access breaks.
    expect(callsignColumnFor(['\uFEFFCallsign', 'Product__c', 'Status'])).toBe('\uFEFFCallsign');
  });

  it('CallsignColumn_WhenNoKnownCallsignName_ReturnsUndefined', () => {
    expect(callsignColumnFor(['SomethingNew', 'Status', 'Product'])).toBeUndefined();
  });
});

describe('convertRawCsv', () => {
  it('Convert_WhenSalesforceVariant_MapsToCanonicalSchemaWithIsoDates', () => {
    const result = convertRawCsv(SALESFORCE_RAW, FETCH_CONTEXT);
    expect(result.headerVariant).toBe('v2025-salesforce');
    expect(result.schemaVersion).toBe(NORMALISED_SCHEMA_VERSION);
    const [header, first] = lines(result.csv);
    expect(header).toBe(CANONICAL_COLUMNS.join(','));
    expect(first).toBe('M0IVB,Amateur Full Radio Licence,Allocated,Call Sign - Amateur,2019-01-20,2024-04-21,,');
  });

  it('Convert_WhenTimePresent_KeepsTimeZeroPadded', () => {
    const result = convertRawCsv(FRIENDLY_LABELS, FETCH_CONTEXT);
    const rows = lines(result.csv);
    expect(rows).toContain('M7ACX,Amateur Foundation Radio Licence,Allocated,Call Sign - Amateur,2019-01-21 16:50,2024-08-03 08:22,,');
  });

  it('Convert_WhenBomPresent_StripsBomAndDetectsVariant', () => {
    const result = convertRawCsv(LICENCE_VERSION_BOM, FETCH_CONTEXT);
    expect(result.headerVariant).toBe('v2026-licence-version');
    // Licence-version dates land in their own canonical columns; the
    // created/last-modified pair stays empty for this variant.
    expect(lines(result.csv)).toContain('20DLQ,Amateur Intermediate Radio Licence,Allocated,Call Sign - Amateur,,,2025-10-11,2015-05-29');
  });

  it('Convert_WhenVariantLacksTypeColumn_LeavesTypeEmpty', () => {
    const result = convertRawCsv(MMSI_LABELLED, FETCH_CONTEXT);
    expect(lines(result.csv)).toContain('M3YVL,Amateur Foundation Radio Licence,Allocated,,,2016-07-23,,');
  });

  it('Convert_WhenAnyVariant_SortsByCallsignCodepointOrder', () => {
    const result = convertRawCsv(MMSI_LABELLED, FETCH_CONTEXT);
    const rows = lines(result.csv).slice(1);
    // '2E0ABC' < 'M3YVL' in codepoint order (digits before letters).
    expect(rows[0].startsWith('2E0ABC,')).toBe(true);
    expect(rows[1].startsWith('M3YVL,')).toBe(true);
  });

  it('Convert_WhenRunTwice_ByteIdentical', () => {
    expect(convertRawCsv(SALESFORCE_RAW, FETCH_CONTEXT).csv).toBe(convertRawCsv(SALESFORCE_RAW, FETCH_CONTEXT).csv);
  });

  it('Convert_WhenUnknownHeader_ThrowsNamingTheHeader', () => {
    const unknown = 'Callsign,Mystery,Status\nM7TEE,x,Allocated\n';
    expect(() => convertRawCsv(unknown, FETCH_CONTEXT)).toThrow(/Mystery|unknown/i);
  });

  it('Convert_WhenDateInFuture_ThrowsPlausibilityFailure', () => {
    const future = SALESFORCE_RAW.replace('21/04/2024', '21/04/2099');
    expect(() => convertRawCsv(future, FETCH_CONTEXT)).toThrow(/future|plausib/i);
  });

  it('Convert_WhenLicenceStartDateInTwentiethCentury_Passes', () => {
    // Real data: Licence_Version.Original_start_date__c carries genuinely old
    // dates for long-held licences (1989 observed in the live publication).
    // The plausibility floor is 1900 - roughly the dawn of UK wireless
    // licensing - not the age of the exporting IT system.
    const oldLicence = LICENCE_VERSION_BOM.replace('29/05/2015', '10/08/1989');
    expect(() => convertRawCsv(oldLicence, FETCH_CONTEXT)).not.toThrow();
  });

  it('Convert_WhenDatePredatesWirelessLicensing_ThrowsPlausibilityFailure', () => {
    const impossible = LICENCE_VERSION_BOM.replace('29/05/2015', '10/08/1899');
    expect(() => convertRawCsv(impossible, FETCH_CONTEXT)).toThrow(/predates|plausib/i);
  });

  it('Convert_WhenWholesaleMonthFirstDates_Throws', () => {
    // A month-first export puts real days >12 in the month position.
    const flipped = SALESFORCE_RAW.replace('20/01/2019', '01/20/2019');
    expect(() => convertRawCsv(flipped, FETCH_CONTEXT)).toThrow(/month/i);
  });

  it('Convert_WhenEmptyDataRows_Throws', () => {
    const headerOnly = 'Value__c,Product__c,Status__c,Type__c,CreatedDate,LastModifiedDate\n';
    expect(() => convertRawCsv(headerOnly, FETCH_CONTEXT)).toThrow(/zero|empty/i);
  });

  it('Convert_WhenDatesMixAmbiguousAndDisambiguating_ReportsPerColumnCounts', () => {
    // Evidence for the reviewer, per column: date formats are assumed
    // consistent within a column, so ONE disambiguating value (any component
    // >12, e.g. 23/07/2016) verifies the whole column as day-first; values
    // like 05/03/2020 are individually ambiguous but covered by the column's
    // verification.
    const result = convertRawCsv(MMSI_LABELLED, FETCH_CONTEXT);
    expect(result.dateStats).toEqual({
      last_modified_date: { disambiguated: 1, ambiguous: 1 },
    });
    expect(result.unverifiedDateColumns).toEqual([]);
  });

  it('Convert_WhenColumnHasOnlyAmbiguousDates_ListedAsUnverified', () => {
    // Every value <= 12/12: nothing in the column can prove day-first order,
    // so the column is flagged for the reviewer.
    const allAmbiguous =
      'Value,Status,Product,Call Sign MMSI: Last Modified Date\n' +
      'M3YVL,Allocated,Amateur Foundation Radio Licence,05/03/2020\n' +
      '2E0ABC,Allocated,Amateur Intermediate Radio Licence,01/02/2019\n';
    const result = convertRawCsv(allAmbiguous, FETCH_CONTEXT);
    expect(result.unverifiedDateColumns).toEqual(['last_modified_date']);
  });
});
