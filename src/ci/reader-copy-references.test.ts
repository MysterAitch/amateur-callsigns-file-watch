import { describe, it, expect } from 'vitest';
import { CAVEAT_GLOSSES, RULE_GLOSSES } from './state-at-t.ts';
import { CAVEAT_LABELS, KIND_LABELS } from './build-callsign-event-shards.ts';
import { V1_COPY, V1_COPY_STRINGS, CAVEAT_GLOSSARY_TERMS } from './render/v1-copy.ts';
import {
  V1_COPY as JS_V1_COPY,
  V1_COPY_STRINGS as JS_COPY_STRINGS,
  CAVEAT_GLOSSARY_TERMS as JS_CAVEAT_GLOSSARY_TERMS,
} from '../../site/v1/copy.js';
import { assertNonEmpty } from '../testing/non-vacuity.ts';
import { internalReferenceOffenders, internalReferencesIn } from '../testing/reader-copy-references.ts';

// The reader-facing reference guard (issue #965).
//
// Every string here RENDERS: the copy registries are the launch surface's
// wording, and the gloss/label vocabularies below ship inside the event-shard
// and history manifests and are shown verbatim beside a dated figure. A tracker
// number or a repository path in one of them stands in for an explainer that was
// never written, and asks a visitor to leave the site to understand what they
// were shown.
//
// Code comments, module headers and decision records are DELIBERATELY not walked
// — a tracker reference there is traceability a reader never sees, and is worth
// keeping. Test names follow Subject_Scenario_Outcome.

// Each walked vocabulary as (label, string) pairs, so an offender names where it
// lives rather than only what it says.
function labelled(name: string, values: Iterable<[unknown, string]>): [string, string][] {
  return [...values].map(([key, value]) => [`${name}[${String(key)}]`, value]);
}

const GLOSS_VOCABULARIES: [string, string][] = [
  ...labelled('CAVEAT_GLOSSES', CAVEAT_GLOSSES.entries()),
  ...labelled('RULE_GLOSSES', RULE_GLOSSES.entries()),
  ...labelled('CAVEAT_LABELS', CAVEAT_LABELS.entries()),
  ...labelled('KIND_LABELS', KIND_LABELS.entries()),
];

describe('reader-facing copy carries no internal reference', { tags: ['unit'] }, () => {
  it('EngineGlossVocabularies_AsShippedInTheManifests_CiteNoTrackerNumberOrRepositoryFile', () => {
    assertNonEmpty(GLOSS_VOCABULARIES, 'gloss vocabularies shipped to readers');
    expect(internalReferenceOffenders(GLOSS_VOCABULARIES)).toEqual([]);
  });

  it('V1CopyRegistry_EveryReaderFacingString_CitesNoTrackerNumberOrRepositoryFile', () => {
    const strings = assertNonEmpty(V1_COPY_STRINGS, 'v1 copy strings (TS twin)')
      .map((s, i) => [`V1_COPY_STRINGS[${i}]`, s] as [string, string]);
    expect(internalReferenceOffenders(strings)).toEqual([]);
  });

  it('BrowserCopyRegistry_EveryReaderFacingString_CitesNoTrackerNumberOrRepositoryFile', () => {
    // The browser twin is walked in its own right: the two are held identical by
    // a parity gate, but a guard that trusts the gate would go quiet the moment
    // the gate did.
    const strings = assertNonEmpty(JS_COPY_STRINGS, 'v1 copy strings (JS twin)')
      .map((s, i) => [`JS_COPY_STRINGS[${i}]`, s] as [string, string]);
    expect(internalReferenceOffenders(strings)).toEqual([]);
  });

  it('ReferenceDetector_GivenTheReferenceFormsThisSurfaceHasShipped_FlagsEveryOne', () => {
    // The guard proved able to fail, against the exact shapes that were found on
    // the surface: a prefixed issue number, a bare parenthesised one, a
    // repository markdown path, and a bare source-file name.
    for (const shipped of [
      'issue #800 — a version-scoped start date is the earliest start surviving',
      'the disagreement is resolved nowhere (issue #467)',
      'earliest SURVIVING start only (#800), pre-1977 unreliability (#565)',
      'inside a detected mass-update episode window (see reports/event-time-coherency.md)',
      'the full working lives in state-at-t.md',
      'the rules are authored in src/ci/state-at-t.ts',
    ]) {
      expect(internalReferencesIn(shipped), `not flagged: ${shipped}`).not.toEqual([]);
    }
  });

  it('ReferenceDetector_GivenOrdinaryReaderCopy_FlagsNothing', () => {
    // The unhappy direction for a guard: over-reach. These are the shapes in the
    // shipped copy that look superficially like a reference — a deep-link cue, a
    // callsign, a slashed operating form, a disclosure year span, a page name.
    for (const ordinary of [
      'Each entry is one clear line, deep-linkable by its #anchor.',
      'Look up any UK amateur callsign’s recorded history. For example M7TEE.',
      'An optional addition after a forward slash, such as /P for portable.',
      'Ofcom’s Licence-View field dictionary, disclosed under FOI, 2014/15.',
      'Zoom out to the whole record: the on-this-day calendar and the timeline.',
      'MW/ before a non-UK callsign keeps the reciprocal forms distinct.',
    ]) {
      expect(internalReferencesIn(ordinary), `over-flagged: ${ordinary}`).toEqual([]);
    }
  });
});

describe('caveats route to a published explainer', { tags: ['unit'] }, () => {
  // The caveats whose gloss used to carry a tracker reference as its only
  // pointer. Removing a reference without putting an explanation in its place
  // would leave a reader with strictly less than before, so each of these must
  // resolve to a published glossary term. Pinned by id: a caveat dropping off
  // this list is a deliberate decision, not a silent regression.
  const CAVEATS_THAT_LOST_A_REFERENCE = ['earliest-surviving', 'pre-1977', 'mass-episode-window', 'vintages-disagree'] as const;

  it('EveryCaveatWhoseTrackerReferenceWasRemoved_StillOffers_ARouteToItsExplanation', () => {
    for (const caveat of assertNonEmpty(CAVEATS_THAT_LOST_A_REFERENCE, 'caveats that lost a reference')) {
      expect(CAVEAT_GLOSSES.has(caveat), `"${caveat}" is no longer a caveat the engine emits`).toBe(true);
      const term = CAVEAT_GLOSSARY_TERMS[caveat];
      expect(term, `caveat "${caveat}" has no glossary term to route a reader to`).toBeDefined();
      expect(V1_COPY.glossary[term].def.length).toBeGreaterThan(20);
    }
  });

  it('CaveatGlossaryTermMap_EveryEntry_NamesARealCaveatAndARealPublishedTerm', () => {
    // The map couples two independently-authored vocabularies — the engine's
    // caveat ids and the glossary registry — so a rename on either side has to
    // fail here rather than render a bullet whose definition silently vanished.
    const caveatIds: ReadonlySet<string> = new Set(CAVEAT_GLOSSES.keys());
    const entries = assertNonEmpty(Object.entries(CAVEAT_GLOSSARY_TERMS), 'caveat → glossary term map');
    for (const [caveat, term] of entries) {
      expect(caveatIds.has(caveat), `"${caveat}" is not a caveat the engine emits`).toBe(true);
      expect(Object.hasOwn(V1_COPY.glossary, term), `"${term}" is not a term in the glossary registry`).toBe(true);
    }
  });

  it('CaveatGlossaryTermMap_JsAndTsTwins_AreIdentical', () => {
    expect(JS_CAVEAT_GLOSSARY_TERMS).toEqual(CAVEAT_GLOSSARY_TERMS);
    // And the glossary entries the map points at are the same on both sides, so
    // the browser and the build cannot offer different definitions.
    for (const term of Object.values(CAVEAT_GLOSSARY_TERMS)) {
      expect(JS_V1_COPY.glossary[term]).toEqual(V1_COPY.glossary[term]);
    }
  });
});
