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
    glossary: 'Glossary',
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
    trust: 'Every value is a projection of an archived publication — copied straight from one dated file, never merged or reinterpreted; every claim traces to the source byte that asserts it. Nothing is independently verified — and disagreeing sources are both kept, unresolved.',
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
        say: 'Every archived publication is preserved byte-for-byte in the open repository, with provenance carried to the byte. See how to download the files and the databases built from them.',
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
      // The instrument legend, worked micro-example, kind-tint names and marker
      // tooltip templates (issue #921, A2). Kept string-identical to the browser
      // copy (site/v1/copy.js carries the rationale); the mirror drift-guard test
      // holds the two registries' strings in lockstep.
      legendLabel: 'how to read it',
      legendEvent: 'an event — when something happened, as the record states it',
      legendSighting: 'a sighting — a publication that recorded this callsign, at its vintage',
      legendState: 'current state — the latest status the mirror holds',
      legendDisputed: 'disputed — held publications assert competing dates for a kind; every one is shown',
      microExample: 'Worked example: a diamond above the axis at 2018 says the record states that happened in 2018; a pip below at 2021 is a publication that recorded this callsign in 2021 — an event can predate the first sighting.',
      kindLegend: {
        'licence-issued': 'licence issued',
        'licence-original-start': 'licence original start',
        'licence-version-original-start': 'licence-version start',
        'licence-cancelled': 'licence cancelled',
        'reserved-until': 'reserved until',
      },
      tooltipEvent: '{label} · {day}',
      tooltipSighting: 'Sighting: recorded by {title} · {vintage}',
      tooltipSightingNoTitle: 'Sighting · {vintage}',
      tooltipState: '{label} · as of {day}',
      tooltipStateAssertedBy: '{label} · as of {day}, asserted by {source}',
      // The dial's series-introduction context marker (see site/v1/copy.js).
      seriesIntro: '{series} series opened {month}',
      // The agreeing-origin semantic row and the current-state terminus suffix
      // (see site/v1/copy.js for the rationale). Kept string-identical to the
      // browser copy so the drift-guard parity test holds.
      originSemantic: {
        title: 'Licence origin',
        equiv: '= issuance',
        coincide: 'The record’s licence-issued, original-start and version-start dates coincide on this day. Each is listed below with the publication that asserts it; the record reads them as one origin and adjudicates nothing.',
        // An attested interpretation of the original-start field, carried from
        // held research (issue #921): sourced to Ofcom's own field dictionary and
        // hedged, since it is confirmed for the field's DEFINITION but not for
        // every individual record. Cited, never asserted as universal fact.
        interpretationLabel: 'how the original-start date is read',
        interpretation: 'The register’s own field guidance — Ofcom’s Licence-View field dictionary, disclosed under FOI (2014/15) — defines Original Start Date as a licence-view field: the licence chain’s first-ever start, surviving revisions, rather than this callsign’s own issuance. In at least some records it pre-dates the callsign’s series, so it dates the holder’s inherited licence chain, not this callsign; whether that reading holds for every record is not confirmed.',
      },
      currentStateLabel: 'current state',
      readingLead: 'Reading',
      calibrationLead: 'Calibration',
      calibrationNote: 'The sightings beneath are how the event story is evidenced. A callsign can exist before any held publication records it, so the earliest event may predate the first sighting.',
      noEvidence: 'No dated event-time evidence is held for this callsign in the publications mirrored here. This is non-observation: it is not evidence the callsign was available, nor that it never existed.',
      bookkeepingOnly: 'The only dated evidence held for this callsign is record-bookkeeping — the register’s own created and last-modified stamps. These attest system presence by a date, not a licensing event.',
      disagreementLabel: 'The held vintages disagree about this record’s dates',
      disagreementGloss: 'Different vintages assert different dates for the same past event. Every camp is listed with its asserting datasets; the record adjudicates none of them — a later assertion is not automatically the truer one.',
      // Plain-language resolution + disputed link + high-density nudge (issue #921;
      // see site/v1/copy.js). Kept string-identical to the browser copy.
      disagreementResolution: 'the held publications disagree; both values are shown and neither is adjudicated',
      disputeLink: 'disputed — why?',
      disputeNudge: 'This record carries {count} conflicting dated claims — the instrument shows every one.',
      disputeNudgeCta: 'examine the disagreements',
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

  // The coined-vocabulary glossary (issue #921, B1) — see the browser twin
  // site/v1/copy.js for the rationale. Kept string-identical here; the mirror
  // drift-guard test holds the two registries' strings in lockstep, and the
  // claims-bar test walks these definitions for banned verdict wording.
  glossary: {
    eventTime: { term: 'Event time', def: 'When the record states a thing happened. Event time is the dial’s primary upper scale — the readings that answer “what happened, and when”.' },
    assertionTime: { term: 'Assertion time', def: 'When a publication said so. Assertion time is the dial’s lower calibration scale — the sightings that show how each reading was evidenced.' },
    sighting: { term: 'sighting', def: 'One archived publication that recorded this callsign, shown at that publication’s vintage. Each pip on the lower scale is a sighting.' },
    vintage: { term: 'vintage', def: 'The date a publication itself carries — when it was published, not when the events it lists happened.' },
    publication: { term: 'publication', def: 'One archived file the mirror holds byte-for-byte: a register snapshot, an availability list, a statistics table, and so on.' },
    bookkeeping: { term: 'record-bookkeeping', def: 'The register’s own created and last-modified stamps. They attest that a record was present in the system by a date, not that a licensing event happened.' },
    disputed: { term: 'disputed', def: 'The held publications assert competing dates for the same kind of event. Every competing claim is shown; the record adjudicates none of them.' },
    series: { term: 'series', def: 'The block a callsign belongs to, opened on a date (for example the M7 series). A series-level fact that frames the record, never a claim about this callsign’s own licensing.' },
    carriedOrigin: { term: 'carried origin', def: 'A licence-chain start date that pre-dates the callsign’s own series — a sign the licence history was carried over from an earlier callsign. The record raises a scope note rather than treating the two dates as a conflict.' },
    derived: { term: 'derived', def: 'This value is computed by the mirror from the held publications, not read verbatim from any single one of them.' },
    inferred: { term: 'inferred', def: 'A reading the mirror interprets from the held values, hedged where it is not certain — not a fact asserted by any publication.' },
    context: { term: 'context', def: 'A framing fact drawn from reference data, not a claim about this record — shown to place the reading in its wider setting.' },
  },

  // The v1 glossary page (issue #930): the full-page home for the coined
  // vocabulary above. Its entries render from the SAME V1_COPY.glossary registry
  // the popovers open — one source of truth, never a second copy — and every
  // inline popover links out to the matching anchor here. Record-scoped wording,
  // walked by the claims-bar test like every other string. Kept string-identical
  // to the browser twin (site/v1/copy.js); the mirror drift-guard holds the two.
  glossaryPage: {
    eyebrow: 'plain-language reference',
    title: 'Glossary',
    lede: 'Plain-language definitions of the coined terms this record uses — the vocabulary of the two-clock instrument, what the record holds, and how each value was produced. Each entry is one clear line, deep-linkable by its #anchor, and is the very definition the inline popovers open.',
    readingLabel: 'reading the record',
    holdingsLabel: 'what the record holds',
    provenanceLabel: 'how a value is produced',
    popMore: 'Full definition',
    foot: 'These are the terms coined for this record’s own surfaces. The wider domain vocabulary — the register’s status values, prefix and suffix structure, dataset classes and flags — moves here as each of those surfaces is migrated, rather than being described ahead of a page that uses it.',
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
