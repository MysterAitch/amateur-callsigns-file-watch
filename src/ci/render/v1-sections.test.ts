import { describe, it, expect } from 'vitest';
import {
  HOME_SECTION_ORDER,
  CALLSIGN_SECTION_ORDER,
  HOME_SECTIONS,
  CALLSIGN_SECTIONS,
  renderSections,
  type SectionRegistry,
} from './v1-sections.ts';
import {
  V1_COPY,
  V1_COPY_STRINGS,
  EVENT_TIME_GLOSS,
  ASSERTION_TIME_GLOSS,
} from './v1-copy.ts';
// The browser twin of the copy registry — the mirror test holds the two in
// lockstep so the wording can never drift between the TS and JS surfaces.
import { V1_COPY_STRINGS as JS_COPY_STRINGS } from '../../../site/v1/copy.js';

// Test names follow Subject_Scenario_Outcome (project convention). This file is
// the TS half of the v1 section-registry drift guard, the renderSections
// harness contract, and the binding claims-bar wording gate.

// The banned phrasings the owner's wording rules forbid anywhere in the copy:
// two specific mis-framings, and declarative verdict words the mirror never
// uses because it flags and never adjudicates.
const BANNED_PHRASES = [
  'this is an ordinary issuance',
  'no earlier callsign carried it',
  'definitely',
  'proves',
  'confirmed-as-fact',
];

describe('v1 section registries', { tags: ['unit'] }, () => {
  it('HomeSectionOrder_EveryId_HasARegistryEntryAndViceVersa', () => {
    expect(Object.keys(HOME_SECTIONS).sort()).toEqual([...HOME_SECTION_ORDER].sort());
  });

  it('CallsignSectionOrder_EveryId_HasARegistryEntryAndViceVersa', () => {
    expect(Object.keys(CALLSIGN_SECTIONS).sort()).toEqual([...CALLSIGN_SECTION_ORDER].sort());
  });

  it('RenderSections_UnregisteredId_Throws', () => {
    expect(() => renderSections(['not-a-real-section'], HOME_SECTIONS, {})).toThrow(/no registered section/);
  });

  it('RenderSections_RegisteredOrder_WrapsEachInADataSectionElement', () => {
    const html = renderSections(HOME_SECTION_ORDER, HOME_SECTIONS, {});
    for (const id of HOME_SECTION_ORDER) {
      expect(html).toContain(`<section data-section="${id}">`);
    }
    // One <section> per order entry, in order.
    const ids = [...html.matchAll(/data-section="([^"]+)"/g)].map(m => m[1]);
    expect(ids).toEqual([...HOME_SECTION_ORDER]);
  });

  it('RenderSections_EmptyRegistry_ThrowsRatherThanEmitAGap', () => {
    const empty: SectionRegistry<unknown> = {};
    expect(() => renderSections(CALLSIGN_SECTION_ORDER, empty, {})).toThrow(/no registered section/);
  });
});

describe('v1 copy — claims bar (TS)', { tags: ['unit'] }, () => {
  it('BitemporalGlosses_WhereverTheyRender_AppearVerbatim', () => {
    expect(V1_COPY_STRINGS).toContain(EVENT_TIME_GLOSS);
    expect(V1_COPY_STRINGS).toContain(ASSERTION_TIME_GLOSS);
    expect(EVENT_TIME_GLOSS).toBe('Event time — when things happened, as the record states it.');
    expect(ASSERTION_TIME_GLOSS).toBe('Assertion time — when each publication said so.');
    // The dial's own labels carry the glosses verbatim.
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

  it('CarriedOriginCopy_WhenRendered_UsesOnlyRecordScopedWording', () => {
    const ordinary = V1_COPY.callsign.carriedOrigin.ordinary.toLowerCase();
    const carried = V1_COPY.callsign.carriedOrigin.carried.toLowerCase();
    const neutral = V1_COPY.callsign.carriedOrigin.neutral.toLowerCase();
    expect(ordinary).toContain('consistent with a fresh issuance');
    expect(ordinary).toContain('the held record names no earlier callsign');
    expect(carried).toContain('the held record names no earlier callsign');
    expect(neutral).toContain('makes no claim either way');
  });

  it('DatedFactChip_Template_SaysRecordAsOfAndNeverCurrent', () => {
    expect(V1_COPY.chip.template).toContain('Record as of');
    expect(V1_COPY.chip.template.toLowerCase()).not.toContain('current');
  });
});

describe('v1 copy — JS/TS mirror', { tags: ['unit'] }, () => {
  it('CopyRegistries_JsAndTsTwins_CarryTheIdenticalStrings', () => {
    expect([...JS_COPY_STRINGS].sort()).toEqual([...V1_COPY_STRINGS].sort());
  });
});
