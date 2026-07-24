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

  it('CarriedOriginCopy_WhenRendered_UsesOnlyRecordScopedWording', () => {
    const ordinary = V1_COPY.callsign.carriedOrigin.ordinary.toLowerCase();
    const carried = V1_COPY.callsign.carriedOrigin.carried.toLowerCase();
    const coincident = V1_COPY.callsign.carriedOrigin.coincident.toLowerCase();
    const neutral = V1_COPY.callsign.carriedOrigin.neutral.toLowerCase();
    // The 'fresh' reading is attested AS an inference (issue #965), never a bald
    // fact, and drops the "post-dates" boundary language the equal-month case broke.
    expect(ordinary).toContain('inferred');
    expect(ordinary).not.toContain('post-dates');
    expect(ordinary).toContain('the held record names no earlier callsign');
    expect(carried).toContain('the held record names no earlier callsign');
    // The equal-month case makes no confident fresh/carried claim, and names the
    // comparison as an inference rather than an observation.
    expect(coincident).toContain('same month');
    expect(coincident).toContain('inference');
    // The neutral path asserts neither fresh nor carried when the series
    // introduction is unrecorded — it makes no claim either way.
    expect(neutral).toContain('makes no claim either way');
  });

  it('DatedFactChip_Template_SaysRecordAsOfAndNeverCurrent', () => {
    expect(V1_COPY.chip.template).toContain('Record as of');
    expect(V1_COPY.chip.template.toLowerCase()).not.toContain('current');
  });

  it('FromTheRecordFoot_Copy_DescribesPublicationScopedRotationNeverPerRebuild', () => {
    // Issue #965 follow-up: the rotation seed is the newest held publication
    // date, which moves only when a new publication lands — an ordinary
    // rebuild (same newest date) shows the same lead, so the footer must not
    // claim rotation "on each rebuild".
    const foot = V1_COPY.home.fromTheRecordFoot;
    expect(foot).toContain('newest publication changes');
    expect(foot).toContain('not on every rebuild');
    expect(foot.toLowerCase()).not.toContain('leads on each rebuild');
  });

  it('CoinedVocabulary_ProjectionAndFold_AreGlossedOrPlainAtFirstUse', () => {
    // D1: a non-specialist meets "projection" with an inline first-use gloss, and
    // the outward-facing ways-in card drops the internal "folded" metaphor for a
    // plain word.
    expect(V1_COPY.home.trust).toContain('copied straight from one dated file');
    expect(V1_COPY.home.cards.rawData.say).not.toContain('folded');
    expect(V1_COPY.home.cards.rawData.say).toContain('built from them');
  });

  it('GlossaryRegistry_RslAndSuffix_AcknowledgeTheirVariants', () => {
    // Issue #959: the RSL entry admits the club and temporary-event variants, and
    // the suffix entry admits its length variation — the record's structure
    // reference is no longer silent on them.
    expect(V1_COPY.glossary.rsl.def).toContain('club-only set');
    expect(V1_COPY.glossary.rsl.def).toContain('temporary RSL');
    expect(V1_COPY.glossary.suffix.def).toContain('three letters');
    expect(V1_COPY.glossary.suffix.def).toContain('only two');
  });

  it('GlossaryRegistry_Suffix_NamesTheSingleLetterSpecialContestRoute', () => {
    // The single-letter suffix form belongs to a special contest callsign, an
    // Ofcom grant administered by the RSGB — not an unexplained exception to
    // "normally three letters".
    expect(V1_COPY.glossary.suffix.def).toContain('special contest callsign');
    expect(V1_COPY.glossary.suffix.def).toContain('granted by Ofcom');
    expect(V1_COPY.glossary.suffix.def).toContain('administered by the RSGB');
  });

  it('GlossaryRegistry_VisitorPrefix_IsDefinedAsAReciprocalForm', () => {
    // Issue #959: the visitor/reciprocal prefix construction earns its own term.
    expect(V1_COPY.glossary.visitorPrefix.term).toBe('visitor prefix');
    expect(V1_COPY.glossary.visitorPrefix.def).toContain('before a slash');
    expect(V1_COPY.glossary.visitorPrefix.def).toContain('reciprocal');
  });

  it('HistoryExplainers_CarriedLicenceHistoryBackground_CitesItsSourceOnBothPages', () => {
    // Content parity with v0 (src/ci/build-on-this-day.ts, build-timeline.ts):
    // the carried-licence-history background must cite the Ofcom field
    // dictionary and FOI disclosure, never assert the reading unsourced.
    for (const page of [V1_COPY.history.onThisDay, V1_COPY.history.timeline]) {
      expect(page.explainerCarriedHistory).toContain('Licence-View field dictionary');
      expect(page.explainerCarriedHistory).toContain('FOI');
      expect(page.explainerCarriedHistory).toContain('October 2018');
      expect(page.explainerCarriedHistory).toContain('October 2025');
    }
  });

  it('HistoryExplainers_FurtherWorkingBullet_CarriesSubstanceWithNoOffSurfaceLink', () => {
    // The v0 explainer linked out to the committed reports; those reports are
    // not a v1 surface, so the substance is carried inline (issue #921
    // self-containment) rather than dropped.
    for (const page of [V1_COPY.history.onThisDay, V1_COPY.history.timeline]) {
      expect(page.explainerFurtherWorking).toContain('committed reports');
      expect(page.explainerFurtherWorking.toLowerCase()).not.toContain('http');
      expect(page.explainerFurtherWorking).not.toContain('v0');
    }
  });

  it('TimelineReadoutReservations_Wording_StatesTheBitemporalTestParenthetically', () => {
    expect(V1_COPY.history.timeline.readoutReservations).toContain('(stated end on or after then, stating vintage proven by then)');
  });

  it('GlossaryRegistry_EveryCoinedTerm_HasATermAndADefinition', () => {
    // B1: the popover registry pairs each coined term with a plain definition;
    // the temporal glosses, the assertion-time "sighting", and the provenance
    // chips are all present so every wired popover resolves.
    for (const key of ['eventTime', 'assertionTime', 'sighting', 'vintage', 'publication', 'bookkeeping', 'disputed', 'series', 'carriedOrigin', 'derived', 'inferred', 'context', 'prefix', 'rsl', 'suffix', 'operatingSuffix'] as const) {
      expect(V1_COPY.glossary[key].term.length).toBeGreaterThan(0);
      expect(V1_COPY.glossary[key].def.length).toBeGreaterThan(20);
    }
  });
});
