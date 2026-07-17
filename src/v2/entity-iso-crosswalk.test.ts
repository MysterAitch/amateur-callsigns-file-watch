import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { flagEmoji } from '../../site/country-flag.js';

// The entity -> ISO alpha-2 crosswalk (reference-data/itu-entity-iso.csv) is the
// separately-sourced bridge that lets an ITU allocation render a flag while the
// verbatim ITU entity string stays canonical. This validates the REAL reference
// data: every allocation holder the ITU table names must have exactly one
// crosswalk row, every code must render (or be a deliberate flagless
// organisation), and the tricky dependency rows must map to their OWN territory.
// Test names follow Subject_Scenario_Outcome.

const REFERENCE_DATA_DIR = path.join(__dirname, '..', '..', 'reference-data');

function readCsv(name: string): Record<string, string>[] {
  return parse(fs.readFileSync(path.join(REFERENCE_DATA_DIR, name), 'utf8'), {
    columns: true,
    skip_empty_lines: true,
  }) as Record<string, string>[];
}

const ITU_ROWS = readCsv('itu-call-sign-series.csv');
const CROSSWALK_ROWS = readCsv('itu-entity-iso.csv');
const ITU_ENTITIES = [...new Set(ITU_ROWS.map(r => r.allocated_to))];
const CROSSWALK = new Map(CROSSWALK_ROWS.map(r => [r.allocated_to, r.iso_3166_alpha2]));

// Organisations that hold call-sign series but have no national flag; they are
// deliberately mapped to a blank code and surfaced by name.
const FLAGLESS_ORGANISATIONS = [
  'International Civil Aviation Organization',
  'United Nations',
  'World Meteorological Organization',
];

describe('ITU entity -> ISO crosswalk covers the real allocation table', { tags: ['data-validity'] }, () => {
  it('Crosswalk_WhenComparedToTheItuTable_HasExactlyOneRowPerAllocationHolder', () => {
    // Every holder the ITU table names is mapped - a foreign call must never
    // resolve to an entity the flag layer cannot word.
    const unmapped = ITU_ENTITIES.filter(e => !CROSSWALK.has(e));
    expect(unmapped).toEqual([]);

    // And the crosswalk carries no orphan rows for entities the table dropped.
    const orphan = CROSSWALK_ROWS.map(r => r.allocated_to).filter(e => !ITU_ENTITIES.includes(e));
    expect(orphan).toEqual([]);

    // No duplicate keys - the Map size equals the row count.
    expect(CROSSWALK.size).toBe(CROSSWALK_ROWS.length);
  });

  it('Crosswalk_ForEveryStateOrTerritory_YieldsAValidTwoLetterCodeThatRendersAFlag', () => {
    for (const [entity, code] of CROSSWALK) {
      if (FLAGLESS_ORGANISATIONS.includes(entity)) {
        expect(code, `${entity} should be a flagless organisation`).toBe('');
        expect(flagEmoji(code)).toBe('');
        continue;
      }
      // A real territory: exactly two upper-case letters that compose a flag.
      expect(code, `${entity} needs a valid alpha-2 code`).toMatch(/^[A-Z]{2}$/);
      const flag = flagEmoji(code);
      expect([...flag]).toHaveLength(2);
      expect(flag.codePointAt(0)).toBeGreaterThanOrEqual(0x1f1e6);
    }
  });

  it('Crosswalk_ForConcatenatedDependencyRows_MapsToTheDependencyNotTheParent', () => {
    // The rows that pin a dependency onto its parent must resolve to the
    // dependency's OWN flag, never the parent's - Hong Kong not China, Aruba not
    // the Netherlands, the Cook Islands not New Zealand.
    const expectations: Record<string, string> = {
      'China (People\'s Republic of) - Hong Kong': 'HK',
      'China (People\'s Republic of) - Macao': 'MO',
      'Netherlands (Kingdom of the) - Aruba': 'AW',
      'Netherlands (Kingdom of the) - Bonaire, Sint Eustatius and Saba': 'BQ',
      'Netherlands (Kingdom of the) - Curaçao': 'CW',
      'Netherlands (Kingdom of the) - Sint Maarten (Dutch part)': 'SX',
      'New Zealand - Cook Islands': 'CK',
      'New Zealand - Niue': 'NU',
    };
    for (const [entity, code] of Object.entries(expectations)) {
      expect(CROSSWALK.get(entity), entity).toBe(code);
    }
    // The parents themselves keep their own codes, distinct from the dependencies.
    expect(CROSSWALK.get('China (People\'s Republic of)')).toBe('CN');
    expect(CROSSWALK.get('Netherlands (Kingdom of the)')).toBe('NL');
    expect(CROSSWALK.get('New Zealand')).toBe('NZ');
  });

  it('Crosswalk_ForEntitiesWhoseItuNameDivergesFromIso_UsesTheCorrectCode', () => {
    // ITU long-form names that do not match ISO short names by string equality -
    // the reconciliations most likely to be got wrong.
    const spot: Record<string, string> = {
      'United Kingdom of Great Britain and Northern Ireland': 'GB',
      'Republic of Türkiye': 'TR',
      'Kyrgyz Republic': 'KG',
      'Democratic People\'s Republic of Korea': 'KP',
      'Korea (Republic of)': 'KR',
      'Côte d\'Ivoire (Republic of)': 'CI',
      'Eswatini (Kingdom of)': 'SZ',
      'Viet Nam (Socialist Republic of)': 'VN',
      'Russian Federation': 'RU',
      'State of Palestine (In accordance with Resolution 99 Rev. Dubai, 2018)': 'PS',
      'Vatican City State': 'VA',
    };
    for (const [entity, code] of Object.entries(spot)) {
      expect(CROSSWALK.get(entity), entity).toBe(code);
    }
  });
});
