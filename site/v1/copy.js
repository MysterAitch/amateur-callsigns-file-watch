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

  // The journeys the v1 surface offers. Only migrated pages appear here: an
  // unmigrated journey is simply absent rather than pointing anywhere off the
  // v1 surface — the honest state for something not here yet.
  journeys: {
    home: 'Home',
    lookup: 'Look up',
    raw: 'Get the raw data',
  },

  footer: {
    provenance: 'provenance carried to the byte in the raw-keyed claim ledger · values as published, not independently verified',
    notAffiliated: 'not affiliated with or endorsed by Ofcom',
  },

  // The honest 404 for an address the v1 surface does not serve. Record-scoped:
  // it states that the record is being migrated and this part has not moved
  // yet, and offers only the pages that DO exist. No verdict wording.
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
    // The compact archive-span dial inside "the record at a glance": a
    // miniature of the site's dial language showing the archive's temporal
    // coverage — the sparse dated licence history the record reaches back to,
    // a scale break, then the dense run of held publications with a needle at
    // the newest reading. Every figure is read from the centralised, report-
    // cited home-model figures that also feed the readout row (centralised
    // constants, NOT build-derived); these strings carry only the wording, with
    // those numbers interpolated at mount ({count}, {heldStart}, {latest},
    // {historyStart}, {asOf}). Record-scoped throughout, no verdict words. The
    // readout row above carries the identical facts as text, so the dial is
    // given role="img" and summarised by one of the aria templates.
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
      // The bi-temporal enhancement (issue #921): per-publication marks drop
      // DOWN from the axis at each publication's vintage (assertion time), and
      // register-history milestones point UP (event time) — the site-wide
      // convention, in miniature. Both layers are progressive enhancement, drawn
      // from the build-derived holdings manifest; the no-JS baseline keeps the
      // axis, count and needle and honestly says the marks appear with the
      // script. All wording here is record-scoped, no verdict words.
      //
      // The clause appended to the aria-label when marks are drawn: the down-
      // markers summarised as a count over the span, and the up-markers named.
      ariaPublicationsClause: ' {count} held publications are marked along the run, {heldStart} to {latest}.',
      ariaMilestonesClause: ' Register milestones marked: {list}.',
      // The honest no-JS / no-manifest note, shown in the text foot when the
      // individual marks are not drawn. States plainly that they appear with the
      // page's script, so the static baseline never implies marks that are absent.
      enhanceNote: 'Individual publication marks and register milestones appear when the page’s script runs.',
      // The down-marker band: a legend mapping each kind PRESENT to its letter and
      // plain-English name (colour is never the sole cue), and the ringed newest
      // register snapshot. `kindLabels` names each dataset kind; unlisted kinds
      // fall back to their letter.
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
      // The text-parity fold: the full held list, so the marks' information is
      // never colour- or position-only. {count} is the number held.
      allPublicationsSummary: 'list all {count} held publications',
      // A single held publication's line in that fold and its marker title.
      publicationLine: '{title} — {vintage} · {rows} rows',
      publicationLineNoRows: '{title} — {vintage}',
      // The up-marker band: the milestone caption + its paginated controls. Only
      // a small selection is captioned at once (overwhelm control); prev/next
      // cycle the full cited set, state-only, with no viewport movement.
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
    // The ways-in cards — only the journeys the v1 surface actually serves.
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
      // A record-scoped context marker on the dial: when the reference data
      // records when this callsign's SERIES was opened, name it beside the
      // event scale — a series-level fact, never a per-record licensing claim.
      // {series} is the prefix ('M7'); {month} is the introduction month
      // rendered as "October 2018".
      seriesIntro: '{series} series opened {month}',
      // The same-day event cluster caption: co-dated events collapse to one
      // dial marker labelled by their count, with the individual event lines
      // listed on the event rail below. {count} is the number of events on the
      // shared day.
      eventCluster: '{count} events',
      // The current-state terminus suffix. Appended to the record's own latest
      // status value ('Allocated — current state') as the green node closing the
      // event story on both the dial scale and the event rail. Record-scoped: it
      // names the latest status the mirror holds, not a claim about the register.
      currentStateLabel: 'current state',
      readingLead: 'Reading',
      calibrationLead: 'Calibration',
      calibrationNote: 'The sightings beneath are how the event story is evidenced. A callsign can exist before any held publication records it, so the earliest event may predate the first sighting.',
      // Shown when no event-time claim is held for this callsign — a
      // non-observation state, never "was available" or "did not exist".
      noEvidence: 'No dated event-time evidence is held for this callsign in the publications mirrored here. This is non-observation: it is not evidence the callsign was available, nor that it never existed.',
      // Shown when the ONLY dated evidence is record-bookkeeping (created /
      // last-modified stamps): system presence, never a licensing event.
      bookkeepingOnly: 'The only dated evidence held for this callsign is record-bookkeeping — the register’s own created and last-modified stamps. These attest system presence by a date, not a licensing event.',
      // The cross-vintage disagreement block (#467): every camp kept, adjudicated nowhere.
      disagreementLabel: 'The held vintages disagree about this record’s dates',
      disagreementGloss: 'Different vintages assert different dates for the same past event. Every camp is listed with its asserting datasets; the record adjudicates none of them — a later assertion is not automatically the truer one.',
    },
    // The carried-origin explainer. Record-scoped throughout: it describes what
    // the HELD RECORD shows, never an unqualified claim about the world. The
    // rendered path is DATA-DRIVEN — the chain origin month is compared to the
    // series introduction month: "fresh" when the origin post-dates the series,
    // "carried" when it pre-dates it, and "neutral" when the series
    // introduction is not recorded, so neither path is asserted.
    carriedOrigin: {
      label: 'how licence-chain origins are read',
      ordinary: 'This licence chain begins with this callsign, and its origin post-dates the series introduction — consistent with a fresh issuance. The held record names no earlier callsign, so nothing here reads as carried history.',
      carried: 'Some records carry a licence-chain origin that pre-dates the callsign’s own series — a sign the licence history was carried over from an earlier callsign. Where that happens the held record names no earlier callsign that carried it, and the record raises a prominent scope note rather than treating the two dates as a conflict.',
      neutral: 'How a licence chain’s origin reads depends on when the callsign’s series opened. Where the series introduction month is not recorded here, the record makes no claim either way about carried history.',
    },
    // The twin-row conflict annotation (#633): a NAME for the shape of the
    // disagreement between differently-spelled rows of the same callsign, never
    // a verdict on which row is right.
    twin: {
      inversion: 'A non-standard spelling holds the active licence',
      formatSplit: 'The written forms differ in format and status',
      statusDisagree: 'Two written forms disagree on status',
      gloss: 'The latest register snapshot lists this callsign more than once, with the rows differing on status. The record classifies the disagreement and adjudicates none of it.',
    },
    // The regional-rendering note: a looked-up form resolved to the register's
    // core record. {cleaned} is the typed form; {key} the stored core.
    viaRenderingNote: '“{cleaned}” is a regional rendering; the register stores the core record {key} — the Regional Secondary Locator travels separately.',
    // Blank-but-present value wording (never a bare em dash).
    noStatusRecorded: '(no status recorded)',
    noProductRecorded: '(no product recorded — many legitimate allocations carry a blank product)',
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
