// @ts-check
// v1 COPY REGISTRY (issue #921) — the single home for every wording-sensitive
// string on the v1 shell: the dated-fact chip template, journey labels, the
// dial's track labels and glosses, the carried-origin explainer, the home lede
// and card blurbs. The owner's wording rules are binding and machine-checked:
// the claims-bar test (site/v1/copy.test.ts) asserts the two bitemporal glosses
// appear here verbatim, that no banned verdict phrasing ever appears in any
// string, that carried-origin wording stays record-scoped, and that the chip
// template says "Record as of" and never "current".
//
// The TypeScript twin (src/ci/render/v1-copy.ts) MUST carry the identical
// string values; a mirror test guards the two against drift.

// The two bitemporal glosses, verbatim. These are the calibration the whole
// record rests on: an event-time reading is what the record states happened; an
// assertion-time reading is when a publication said so. Rendered wherever the
// dial's two tracks are labelled.
export const EVENT_TIME_GLOSS = 'Event time — when things happened, as the record states it.';
export const ASSERTION_TIME_GLOSS = 'Assertion time — when each publication said so.';

export const V1_COPY = {
  brand: {
    id: 'callsign-record',
    tagline: 'uk amateur register mirror',
  },

  // The dated-fact chip: a build-stamped fact ("as of <newest held date>,
  // <n> publications held"), NEVER a self-assessed "current" freshness claim.
  chip: {
    // Placeholders filled at build time; {date} is the newest held publication
    // date, {count} the number of publications held.
    template: 'Record as of {date} · {count} publications held',
    title: 'Build-derived fact: the newest publication held is dated {date}, and {count} publications are held in total. This page was generated from that set.',
  },

  // The five journeys. Non-launch journeys route into the preserved previous
  // version under /v0/, labelled honestly as the earlier, fuller-featured site.
  journeys: {
    home: 'Home',
    lookup: 'Look up',
    history: 'Explore the history',
    browse: 'Browse & query',
    how: 'How the record works',
    // The honest label appended to a journey that points into the previous
    // version — never dressed up as a new surface.
    v0Mark: 'previous version',
  },

  footer: {
    provenance: 'provenance carried to the byte in the raw-keyed claim ledger · values as published, not independently verified',
    notAffiliated: 'not affiliated with or endorsed by Ofcom',
    v0Link: 'the previous, fuller-featured version',
  },

  home: {
    lede: 'Look up any UK amateur callsign’s recorded history.',
    lookupLabel: 'Look up a callsign',
    placeholder: 'e.g. M7TEE',
    lookupHint: 'Resolved in-browser from a single small fetch — latest register state, parsed anatomy, and every sighting across the archive.',
    trust: 'Every value is a projection of an archived publication; every claim traces to the source byte that asserts it. Nothing is independently verified — and disagreeing sources are both kept, unresolved.',
    waysInLabel: 'ways in',
    atAGlanceLabel: 'the record at a glance',
    fromTheRecordLabel: 'from the record',
    fromTheRecordFoot: 'Selection rotates at build time — a different notable detail leads on each rebuild.',
    scopeDisclaimerLabel: 'scope & disclaimer',
    scopeDisclaimer: 'Proof-of-concept mirror; not affiliated with or endorsed by Ofcom, and not authoritative — Ofcom’s own register is. The value here is continuity: a decade of snapshots Ofcom does not itself publish as a series. Presence in an availability list means offered, not licensed. Absence is read scope-aware: missing from a partial publication is not evidence. The record flags what looks inconsistent and adjudicates nothing.',
    // The four ways-in cards, event-first order (Look up · Explore the history,
    // then Browse & query · How the record works).
    cards: {
      lookup: {
        name: 'Look up a callsign',
        say: 'One callsign, resolved from a single small fetch: latest register state, parsed anatomy, and every sighting across the archive.',
      },
      history: {
        name: 'Explore the history',
        say: 'Trace a licence chain across the decades, or read the record’s own timeline: series introductions, forbidden suffixes, on-this-day.',
      },
      browse: {
        name: 'Browse & query the data',
        say: 'Query the whole corpus in-browser over HTTP range requests. A link can carry a query, so a URL can point straight at a result.',
      },
      how: {
        name: 'How the record works',
        say: 'Method, provenance and limits: what is folded in, how a claim resolves to its byte, and what the record deliberately does not assert.',
      },
    },
  },

  callsign: {
    eyebrow: 'uk amateur register · entry',
    fastAnswerLabel: 'fast answer',
    // Section heading for the signature dial ("The evidence").
    evidenceLabel: 'the evidence',
    evidenceLead: 'One shared year axis. The event readings are the primary scale, above; the publication sightings are the calibration beneath — how the reading was taken. Highlight one clock to read it alone.',
    eventTimelineLabel: 'what happened',
    eventTimelineLead: EVENT_TIME_GLOSS + ' Each event names the source that asserts it.',
    anatomyLabel: 'anatomy',
    recordFidelityLabel: 'record fidelity',
    extrasLabel: 'related views & provenance',
    // The dial's two track labels and their controls.
    dial: {
      eventLabel: 'Event time',
      assertLabel: 'Assertion time',
      eventGloss: EVENT_TIME_GLOSS,
      assertGloss: ASSERTION_TIME_GLOSS,
      showBoth: 'Show both',
      eventOnly: 'Event only',
      assertOnly: 'Assertion only',
      readingLead: 'Reading',
      calibrationLead: 'Calibration',
      calibrationNote: 'The sightings beneath are how the event story is evidenced. A callsign can exist before any held publication records it, so the earliest event may predate the first sighting.',
      // Shown when no event-time claim is held for this callsign — a
      // non-observation state, never "was available" or "did not exist".
      noEvidence: 'No dated event-time evidence is held for this callsign in the publications mirrored here. This is non-observation: it is not evidence the callsign was available, nor that it never existed.',
    },
    // The carried-origin explainer. Record-scoped throughout: it describes what
    // the HELD RECORD shows, never an unqualified claim about the world. When a
    // chain origin post-dates the series, the wording is "consistent with a
    // fresh issuance"; when it pre-dates, "the held record names no earlier
    // callsign" that carried it.
    carriedOrigin: {
      label: 'how licence-chain origins are read',
      ordinary: 'This licence chain begins with this callsign, and its origin post-dates the series introduction — consistent with a fresh issuance. The held record names no earlier callsign, so nothing here reads as carried history.',
      carried: 'Some records carry a licence-chain origin that pre-dates the callsign’s own series — a sign the licence history was carried over from an earlier callsign. Where that happens the held record names no earlier callsign that carried it, and the record raises a prominent scope note rather than treating the two dates as a conflict.',
    },
    fidelity: {
      selfConsistent: 'Where a record’s dates and derived series rules agree, nothing is flagged. Values are kept exactly as published.',
      flaggedNotAdjudicated: 'Values are flagged where they look inconsistent with the derived rules; the record adjudicates none of them and picks no winner.',
    },
    footer: 'A projection of the archived publications. Absence here is never evidence about the register. Values as published, not independently verified.',
  },
};

// Every string value in the registry, flattened — the surface the claims-bar
// test walks. Kept as a helper so both the JS and TS twins check the identical
// set without re-listing it.
/** @param {unknown} value @returns {string[]} */
export function collectCopyStrings(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectCopyStrings);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(collectCopyStrings);
  return [];
}

export const V1_COPY_STRINGS = [EVENT_TIME_GLOSS, ASSERTION_TIME_GLOSS, ...collectCopyStrings(V1_COPY)];
