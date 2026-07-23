// v1 COPY REGISTRY — TypeScript twin (issue #921).
//
// The identical string values to site/v1/copy.js: this side is the source of
// truth for any build-time / server-rendered use of the v1 wording, and the
// two are guarded against drift by the claims-bar tests on both sides. The
// owner's wording rules are binding and machine-checked here as well as in the
// browser twin: the two bitemporal glosses appear verbatim, no banned verdict
// phrasing appears in any string, carried-origin wording stays record-scoped,
// and the dated-fact chip says "Record as of" and never "current".

// The two bitemporal glosses, verbatim (see site/v1/copy.js for the rationale).
export const EVENT_TIME_GLOSS = 'Event time — when things happened, as the record states it.';
export const ASSERTION_TIME_GLOSS = 'Assertion time — when each publication said so.';

export const V1_COPY = {
  brand: {
    id: 'callsign-record',
    tagline: 'uk amateur register mirror',
  },

  chip: {
    template: 'Record as of {date} · {count} publications held',
    title: 'Build-derived fact: the newest publication held is dated {date}, and {count} publications are held in total. This page was generated from that set.',
  },

  journeys: {
    home: 'Home',
    lookup: 'Look up',
    raw: 'Get the raw data',
  },

  footer: {
    provenance: 'provenance carried to the byte in the raw-keyed claim ledger · values as published, not independently verified',
    notAffiliated: 'not affiliated with or endorsed by Ofcom',
  },

  notFound: {
    title: 'This address isn’t part of the site',
    lede: 'The record is being migrated to a new home, and this part of it has not moved here yet. Start from one of the pages that has:',
  },

  home: {
    lede: 'Look up any UK amateur callsign’s recorded history.',
    lookupLabel: 'Look up a callsign',
    placeholder: 'e.g. M7TEE',
    lookupHint: 'Resolved in-browser from a single small fetch — latest register state, parsed anatomy, and every sighting across the archive.',
    trust: 'Every value is a projection of an archived publication; every claim traces to the source byte that asserts it. Nothing is independently verified — and disagreeing sources are both kept, unresolved.',
    waysInLabel: 'ways in',
    atAGlanceLabel: 'the record at a glance',
    // The compact archive-span dial inside "the record at a glance" (see the
    // browser twin site/v1/copy.js for the full note). Wording only; the
    // centralised, report-cited numbers are interpolated at mount. Record-
    // scoped, no verdict words; the readout row carries the identical facts as
    // text.
    span: {
      label: 'holdings across time',
      historyCap: 'earliest dated licence history',
      heldCap: '{count} publications, byte-for-byte',
      needleLabel: 'as of {asOf} · {count} held',
      footReading: 'read as of',
      footHeld: 'publications held',
      footRun: 'byte-for-byte',
      footHistory: 'dated history to',
      ariaWithHistory: 'Holdings across time: {count} publications held byte-for-byte across the dense run {heldStart} to {latest}, and dated licence history reaching back to {historyStart}. Most recent held as of {asOf}.',
      ariaHeldOnly: 'Holdings across time: {count} publications held byte-for-byte, {heldStart} to {latest}. Most recent held as of {asOf}.',
      // The bi-temporal enhancement (issue #921) — see site/v1/copy.js for the
      // full note. Down-markers (publications, assertion time) and up-markers
      // (register-history milestones, event time) are progressive enhancement
      // over the no-JS baseline; all wording record-scoped, no verdict words.
      ariaPublicationsClause: ' {count} held publications are marked along the run, {heldStart} to {latest}.',
      ariaMilestonesClause: ' Register milestones marked: {list}.',
      enhanceNote: 'Individual publication marks and register milestones appear when the page’s script runs.',
      legendLabel: 'held publications by kind',
      latestMarkLabel: 'newest register snapshot',
      kindLabels: {
        'register-snapshot': 'register snapshot',
        'available-pool': 'available-callsign list',
        'issuance-events': 'issuance events',
        'forbidden-list': 'forbidden-suffix list',
        'statistics-aggregate': 'statistics',
        'attribute-addendum': 'attribute addendum',
        'reference-context': 'reference context',
      },
      allPublicationsSummary: 'list all {count} held publications',
      publicationLine: '{title} — {vintage} · {rows} rows',
      publicationLineNoRows: '{title} — {vintage}',
      milestonesLabel: 'register milestones',
      milestonePrev: 'Previous milestone',
      milestoneNext: 'Next milestone',
      milestonePosition: '{i} of {n}',
      milestoneSourceLabel: 'source',
    },
    fromTheRecordLabel: 'from the record',
    fromTheRecordFoot: 'Selection rotates at build time — a different notable detail leads on each rebuild.',
    scopeDisclaimerLabel: 'scope & disclaimer',
    scopeDisclaimer: 'Proof-of-concept mirror; not affiliated with or endorsed by Ofcom, and not authoritative — Ofcom’s own register is. The value here is continuity: a decade of snapshots Ofcom does not itself publish as a series. Presence in an availability list means offered, not licensed. Absence is read scope-aware: missing from a partial publication is not evidence. The record flags what looks inconsistent and adjudicates nothing.',
    cards: {
      lookup: {
        name: 'Look up a callsign',
        say: 'One callsign, resolved from a single small fetch: latest register state, parsed anatomy, and every sighting across the archive.',
      },
      rawData: {
        name: 'Get the raw data',
        say: 'Every archived publication is preserved byte-for-byte in the open repository, with provenance carried to the byte. See how to download the files and the databases folded from them.',
      },
    },
  },

  callsign: {
    eyebrow: 'uk amateur register · entry',
    fastAnswerLabel: 'fast answer',
    evidenceLabel: 'the evidence',
    evidenceLead: 'One shared year axis. The event readings are the primary scale, above; the publication sightings are the calibration beneath — how the reading was taken. Highlight one clock to read it alone.',
    eventTimelineLabel: 'what happened',
    eventTimelineLead: EVENT_TIME_GLOSS + ' Each event names the source that asserts it.',
    anatomyLabel: 'anatomy',
    recordFidelityLabel: 'record fidelity',
    extrasLabel: 'related views & provenance',
    dial: {
      eventLabel: 'Event time',
      assertLabel: 'Assertion time',
      eventGloss: EVENT_TIME_GLOSS,
      assertGloss: ASSERTION_TIME_GLOSS,
      showBoth: 'Show both',
      eventOnly: 'Event only',
      assertOnly: 'Assertion only',
      // The dial's series-introduction context marker (see site/v1/copy.js).
      seriesIntro: '{series} series opened {month}',
      // The same-day event cluster caption and the current-state terminus suffix
      // (see site/v1/copy.js for the rationale).
      eventCluster: '{count} events',
      currentStateLabel: 'current state',
      readingLead: 'Reading',
      calibrationLead: 'Calibration',
      calibrationNote: 'The sightings beneath are how the event story is evidenced. A callsign can exist before any held publication records it, so the earliest event may predate the first sighting.',
      noEvidence: 'No dated event-time evidence is held for this callsign in the publications mirrored here. This is non-observation: it is not evidence the callsign was available, nor that it never existed.',
      bookkeepingOnly: 'The only dated evidence held for this callsign is record-bookkeeping — the register’s own created and last-modified stamps. These attest system presence by a date, not a licensing event.',
      disagreementLabel: 'The held vintages disagree about this record’s dates',
      disagreementGloss: 'Different vintages assert different dates for the same past event. Every camp is listed with its asserting datasets; the record adjudicates none of them — a later assertion is not automatically the truer one.',
    },
    carriedOrigin: {
      label: 'how licence-chain origins are read',
      ordinary: 'This licence chain begins with this callsign, and its origin post-dates the series introduction — consistent with a fresh issuance. The held record names no earlier callsign, so nothing here reads as carried history.',
      carried: 'Some records carry a licence-chain origin that pre-dates the callsign’s own series — a sign the licence history was carried over from an earlier callsign. Where that happens the held record names no earlier callsign that carried it, and the record raises a prominent scope note rather than treating the two dates as a conflict.',
      neutral: 'How a licence chain’s origin reads depends on when the callsign’s series opened. Where the series introduction month is not recorded here, the record makes no claim either way about carried history.',
    },
    twin: {
      inversion: 'A non-standard spelling holds the active licence',
      formatSplit: 'The written forms differ in format and status',
      statusDisagree: 'Two written forms disagree on status',
      gloss: 'The latest register snapshot lists this callsign more than once, with the rows differing on status. The record classifies the disagreement and adjudicates none of it.',
    },
    viaRenderingNote: '“{cleaned}” is a regional rendering; the register stores the core record {key} — the Regional Secondary Locator travels separately.',
    noStatusRecorded: '(no status recorded)',
    noProductRecorded: '(no product recorded — many legitimate allocations carry a blank product)',
    fidelity: {
      selfConsistent: 'Where a record’s dates and derived series rules agree, nothing is flagged. Values are kept exactly as published.',
      flaggedNotAdjudicated: 'Values are flagged where they look inconsistent with the derived rules; the record adjudicates none of them and picks no winner.',
    },
    footer: 'A projection of the archived publications. Absence here is never evidence about the register. Values as published, not independently verified.',
  },
} as const;

// Every string value in the registry, flattened — the surface the claims-bar
// test walks.
export function collectCopyStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectCopyStrings);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(collectCopyStrings);
  return [];
}

export const V1_COPY_STRINGS: string[] = [EVENT_TIME_GLOSS, ASSERTION_TIME_GLOSS, ...collectCopyStrings(V1_COPY)];
