import { describe, it, expect } from 'vitest';
import {
  V1_COPY,
  V1_COPY_STRINGS,
  EVENT_TIME_GLOSS,
  ASSERTION_TIME_GLOSS,
} from './copy.js';

// The JS half of the binding claims-bar wording gate (issue #921). The owner's
// wording rules are machine-checked on both the browser and the build side; the
// TS half lives in src/ci/render/v1-sections.test.ts and a mirror test there
// holds the two registries' strings identical. Test names follow
// Subject_Scenario_Outcome.

const BANNED_PHRASES = [
  'this is an ordinary issuance',
  'no earlier callsign carried it',
  'definitely',
  'proves',
  'confirmed-as-fact',
];

describe('v1 copy — claims bar (JS)', { tags: ['unit'] }, () => {
  it('BitemporalGlosses_WhereverTheyRender_AppearVerbatim', () => {
    expect(V1_COPY_STRINGS).toContain(EVENT_TIME_GLOSS);
    expect(V1_COPY_STRINGS).toContain(ASSERTION_TIME_GLOSS);
    expect(EVENT_TIME_GLOSS).toBe('Event time — when things happened, as the record states it.');
    expect(ASSERTION_TIME_GLOSS).toBe('Assertion time — when each publication said so.');
    expect(V1_COPY.callsign.dial.eventGloss).toBe(EVENT_TIME_GLOSS);
    expect(V1_COPY.callsign.dial.assertGloss).toBe(ASSERTION_TIME_GLOSS);
  });

  it('CopyStrings_BannedPhrasings_NeverAppear', () => {
    for (const s of V1_COPY_STRINGS) {
      const lower = s.toLowerCase();
      for (const banned of BANNED_PHRASES) {
        expect(lower.includes(banned), `banned phrasing "${banned}" found in: ${s}`).toBe(false);
      }
    }
  });

  it('CarriedOriginWording_IsRecordScoped', () => {
    const ordinary = V1_COPY.callsign.carriedOrigin.ordinary.toLowerCase();
    const carried = V1_COPY.callsign.carriedOrigin.carried.toLowerCase();
    expect(ordinary).toContain('consistent with a fresh issuance');
    expect(ordinary).toContain('the held record names no earlier callsign');
    expect(carried).toContain('the held record names no earlier callsign');
  });

  it('DatedFactChip_Template_SaysRecordAsOfAndNeverCurrent', () => {
    expect(V1_COPY.chip.template).toContain('Record as of');
    expect(V1_COPY.chip.template.toLowerCase()).not.toContain('current');
  });
});
