import { describe, it, expect } from 'vitest';
import {
  convertRawCsv,
  physicalLines,
  CANONICAL_COLUMNS,
  NORMALISED_SCHEMA_VERSION,
  type ConvertContext,
} from '../sources/ofcom-amateur/normalise.ts';
import { COMPONENT_COLUMNS, COMPONENTS_SCHEMA_VERSION } from '../sources/ofcom-amateur/components.ts';
import { FOI_FILE_ROLES, FOI_DATASET_CLASSES } from '../shared/foi-archive.ts';
import { FOI_ROW_SCHEMA_FAMILIES, FOI_EXTENSION_COLUMNS, FOI_NORMALISED_SCHEMA_VERSION } from '../shared/foi-normalise.ts';

// Independent acceptance criteria for the schema contracts, line-accounting
// identity and fail-loud guards a rebuild MUST satisfy (v2 reference, section
// C / F). These lock the stable published contracts and the exact arithmetic
// that guarantees nothing is dropped silently.

const CTX: ConvertContext = { referenceDateIso: '2026-06-23' };
const FRIENDLY_HEADER = 'Call sign,Product,Status,Type,CreatedDate,LastModifiedDate';

describe('stable schema contracts (acceptance criteria F5 / F6 / C7)', { tags: ['data-validity'] }, () => {
  it('CanonicalColumns_StableContract', () => {
    expect([...CANONICAL_COLUMNS]).toEqual([
      'callsign', 'product', 'status', 'type', 'created_date',
      'last_modified_date', 'licence_version_last_modified_date',
      'licence_version_original_start_date',
    ]);
    expect(NORMALISED_SCHEMA_VERSION).toBe(1);
  });

  it('ComponentColumns_StableContract', () => {
    expect([...COMPONENT_COLUMNS]).toEqual([
      'callsign', 'cleaned', 'parse_status', 'prefix_series', 'rsl', 'suffix',
      'placeholder_form', 'home_callsign', 'implied_class', 'flags',
    ]);
    expect(COMPONENTS_SCHEMA_VERSION).toBe(5);
  });

  it('FoiNormalisedSchema_StableVersion', () => {
    expect(FOI_NORMALISED_SCHEMA_VERSION).toBe(1);
  });
});

describe('line-accounting identity (acceptance criteria F7 / F8)', { tags: ['data-validity'] }, () => {
  // A publication with a data row, a blank physical line, a syntactically
  // valid all-empty row, and a further data row - exercising every line class.
  const raw = [
    FRIENDLY_HEADER,
    'M7TEE,Amateur Foundation Radio Licence,Allocated,Call Sign - Amateur,,',
    '',
    ',,,,,',
    'G0TQK,Amateur Full Radio Licence,Allocated,Call Sign - Amateur,,',
  ].join('\n') + '\n';
  const result = convertRawCsv(raw, CTX);

  it('LineAccounting_WhenConverted_EveryPhysicalLineIsHeaderRecordOrIgnored', () => {
    // raw_lines - 1 header == records + ignored, exactly, no inference.
    const lineCount = physicalLines(raw).length;
    expect(lineCount - 1).toBe(result.recordCount + result.ignoredLines.length);
  });

  it('LineAccounting_WhenBlankPhysicalLinePresent_EnumeratedAsIgnoredBlank', () => {
    // A blank physical line is not a table row; it is enumerated (never
    // dropped silently) with reason 'blank'.
    expect(result.ignoredLines.some(l => l.reason === 'blank')).toBe(true);
  });

  it('RecordCount_WhenAllEmptyRowPresent_EqualsEmptyPlusNonEmptyRecords', () => {
    // A syntactically valid all-empty row (,,) IS a table row and stays in
    // the normalised output; the emptiness accounting always balances.
    expect(result.stats.recordCount).toBe(result.stats.emptyRecords + result.stats.nonEmptyRecords);
    expect(result.stats.emptyRecords).toBe(1);
    expect(result.stats.statsSchemaVersion).toBe(6);
  });
});

describe('fail-loud refusal guards (acceptance criterion F14)', { tags: ['data-validity'] }, () => {
  it('Convert_WhenNoDataRows_RefusesToNormalise', () => {
    expect(() => convertRawCsv(FRIENDLY_HEADER + '\n', CTX)).toThrow(/empty|zero/i);
  });

  it('Convert_WhenHeaderVariantUnknown_FailsLoud', () => {
    // An unrecognised header shape is a genuinely new variant deserving a
    // reviewed converter change, never a guess.
    expect(() => convertRawCsv('Foo,Bar\n1,2\n', CTX)).toThrow(/unknown/i);
  });
});

describe('FOI controlled vocabularies (acceptance criteria C1 / C2 / C3 / C4)', { tags: ['data-validity'] }, () => {
  it('FoiFileRoles_ClosedVocabulary', () => {
    expect([...FOI_FILE_ROLES].sort()).toEqual([
      'acknowledgement-letter', 'data', 'data-container', 'divergent-copy',
      'extract', 'normalised', 'response-letter', 'transcript',
    ]);
  });

  it('FoiDatasetClasses_ClosedGlossary', () => {
    expect(Object.keys(FOI_DATASET_CLASSES).sort()).toEqual([
      'attribute-addendum', 'available-pool', 'forbidden-list',
      'issuance-events', 'reference-context', 'register-snapshot',
      'statistics-aggregate',
    ]);
  });

  it('FoiRowSchemaFamilies_CoreColumnsAreStable', () => {
    const byName = Object.fromEntries(FOI_ROW_SCHEMA_FAMILIES.map(f => [f.name, f.coreColumns]));
    expect(Object.keys(byName).sort()).toEqual([
      'callsign-attributes', 'callsign-observation', 'counts-aggregate',
      'database-fields', 'issuance-events', 'suffix-list',
    ]);
    expect(byName['callsign-observation']).toEqual(['callsign', 'status', 'licence_class']);
    expect(byName['issuance-events']).toEqual(['callsign', 'event', 'event_date']);
    expect(byName['suffix-list']).toEqual(['suffix']);
    expect(byName['database-fields']).toEqual(['view', 'field_name']);
  });

  it('FoiExtensionColumns_VocabularyIsClosed', () => {
    // Converters cannot invent near-duplicate column names; the registered
    // vocabulary is reviewed and closed.
    expect(Object.keys(FOI_EXTENSION_COLUMNS).sort()).toEqual([
      'amateur_radio_licences_issued', 'business_radio_licences_issued',
      'call_sign_type', 'con_id', 'created_date', 'last_modified_date',
      'licence_cancel_date', 'licence_class', 'licence_issued_date',
      'licence_number', 'original_start_date', 'reason', 'reserved_to_date',
      'status', 'suffix',
    ]);
  });
});
