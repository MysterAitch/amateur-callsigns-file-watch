// v1 COPY REGISTRY – TypeScript twin (issue #921).
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
    title: 'The record’s currency, stamped into this page at build time: the newest publication held is dated {date}, and {count} publications are held in total.',
  },

  journeys: {
    home: 'Home',
    lookup: 'Look up',
    onThisDay: 'On this day',
    timeline: 'Timeline',
    raw: 'Get the raw data',
    glossary: 'Glossary',
    anatomy: 'Anatomy',
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
    lookupHint: 'Resolved in-browser from a single small fetch – latest register state, parsed anatomy, and every sighting across the archive.',
    trust: 'Every value is a projection of an archived publication – copied straight from one dated file, never merged or reinterpreted; every claim traces to the source byte that asserts it. Nothing is independently verified – and disagreeing sources are both kept, unresolved.',
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
      // The bi-temporal enhancement (issue #921) – see site/v1/copy.js for the
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
      publicationLine: '{title} – {vintage} · {rows} rows',
      publicationLineNoRows: '{title} – {vintage}',
      milestonesLabel: 'register milestones',
      milestonePrev: 'Previous milestone',
      milestoneNext: 'Next milestone',
      milestonePosition: '{i} of {n}',
      milestoneSourceLabel: 'source',
    },
    fromTheRecordLabel: 'from the record',
    fromTheRecordFoot: 'Selection rotates as the record grows – a different notable detail leads when the newest publication changes, not on every rebuild.',
    scopeDisclaimerLabel: 'scope & disclaimer',
    scopeDisclaimer: 'Proof-of-concept mirror; not affiliated with or endorsed by Ofcom, and not authoritative – Ofcom’s own register is. The value here is continuity: a decade of snapshots Ofcom does not itself publish as a series. Presence in an availability list means offered, not licensed. Absence is read scope-aware: missing from a partial publication is not evidence. The record flags what looks inconsistent and adjudicates nothing.',
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
    evidenceLead: 'One shared year axis. The event readings are the primary scale, above; the publication sightings are the calibration beneath – how the reading was taken. Highlight one clock to read it alone.',
    eventTimelineLabel: 'what happened',
    eventTimelineLead: EVENT_TIME_GLOSS + ' Each event names the source that asserts it.',
    // The link-out to the deeper event-time surfaces (issue #932): the same
    // event-first hierarchy, zoomed out to the whole record.
    eventTimelineMoreLead: 'Zoom out to the whole record along event time: ',
    eventTimelineMoreOnThisDay: 'the on-this-day calendar',
    eventTimelineMoreTimeline: 'the timeline',
    anatomyLabel: 'anatomy',
    // The link-out from the terse per-callsign anatomy grid to the full
    // structure-reference page (issue #931): the grid answers "what are this
    // callsign's parts", the page answers "what the parts mean, sourced".
    anatomyLinkOut: 'The parts of a UK callsign, explained – the labelled diagram and the sourced facts',
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
      legendEvent: 'an event – when something happened, as the record states it',
      legendSighting: 'a sighting – a publication that recorded this callsign, at its vintage',
      legendState: 'current state – the latest status the mirror holds',
      legendDisputed: 'disputed – held publications assert competing dates for a kind; every one is shown',
      microExample: 'Worked example: a diamond above the axis at 2018 says the record states that happened in 2018; a pip below at 2021 is a publication that recorded this callsign in 2021 – an event can predate the first sighting.',
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
        interpretation: 'The register’s own field guidance – Ofcom’s Licence-View field dictionary, disclosed under FOI (2014/15) – defines Original Start Date as a licence-view field: the licence chain’s first-ever start, surviving revisions, rather than this callsign’s own issuance. In at least some records it pre-dates the callsign’s series, so it dates the holder’s inherited licence chain, not this callsign; whether that reading holds for every record is not confirmed.',
      },
      currentStateLabel: 'current state',
      readingLead: 'Reading',
      calibrationLead: 'Calibration',
      calibrationNote: 'The sightings beneath are how the event story is evidenced. A callsign can exist before any held publication records it, so the earliest event may predate the first sighting.',
      noEvidence: 'No dated event-time evidence is held for this callsign in the publications mirrored here. This is non-observation: it is not evidence the callsign was available, nor that it never existed.',
      bookkeepingOnly: 'The only dated evidence held for this callsign is record-bookkeeping – the register’s own created and last-modified stamps. These attest system presence by a date, not a licensing event.',
      disagreementLabel: 'The held vintages disagree about this record’s dates',
      disagreementGloss: 'Different vintages assert different dates for the same past event. Every camp is listed with its asserting datasets; the record adjudicates none of them – a later assertion is not automatically the truer one.',
      // Plain-language resolution + disputed link + high-density nudge (issue #921;
      // see site/v1/copy.js). Kept string-identical to the browser copy.
      disagreementResolution: 'the held publications disagree; both values are shown and neither is adjudicated',
      disputeLink: 'disputed – why?',
      disputeNudge: 'This record carries {count} conflicting dated claims – the instrument shows every one.',
      disputeNudgeCta: 'examine the disagreements',
    },
    carriedOrigin: {
      label: 'how licence-chain origins are read',
      ordinary: 'The held record’s licence-chain origin is dated after this callsign’s series introduction – read here as a fresh issuance, not carried history. That reading is inferred by comparing the chain origin to the series-introduction month, not a fact any single publication states; the held record names no earlier callsign, so nothing here reads as carried history.',
      carried: 'Some records carry a licence-chain origin that pre-dates the callsign’s own series – a sign the licence history was carried over from an earlier callsign. Where that happens the held record names no earlier callsign that carried it, and the record raises a prominent scope note rather than treating the two dates as a conflict.',
      coincident: 'The held record’s licence-chain origin falls in the same month as this callsign’s series introduction – too close to read confidently as a fresh issuance or as carried history. Comparing the chain origin to the series-introduction month is an inference, not a fact any single publication states, so the record makes no confident claim either way here.',
      neutral: 'How a licence chain’s origin reads depends on when the callsign’s series opened. Where the series introduction month is not recorded here, the record makes no claim either way about carried history.',
    },
    twin: {
      inversion: 'A non-standard spelling holds the active licence',
      formatSplit: 'The written forms differ in format and status',
      statusDisagree: 'Two written forms disagree on status',
      gloss: 'The latest register snapshot lists this callsign more than once, with the rows differing on status. The record classifies the disagreement and adjudicates none of it.',
    },
    viaRenderingNote: '“{cleaned}” is a regional rendering; the register stores the core record {key} – the Regional Secondary Locator travels separately.',
    noStatusRecorded: '(no status recorded)',
    noProductRecorded: '(no product recorded – many legitimate allocations carry a blank product)',
    fidelity: {
      selfConsistent: 'Where a record’s dates and derived series rules agree, nothing is flagged. Values are kept exactly as published.',
      flaggedNotAdjudicated: 'Values are flagged where they look inconsistent with the derived rules; the record adjudicates none of them and picks no winner.',
    },
    footer: 'A projection of the archived publications. Absence here is never evidence about the register. Values as published, not independently verified.',
  },

  // The coined-vocabulary glossary (issue #921, B1) – see the browser twin
  // site/v1/copy.js for the rationale. Kept string-identical here; the mirror
  // drift-guard test holds the two registries' strings in lockstep, and the
  // claims-bar test walks these definitions for banned verdict wording.
  glossary: {
    eventTime: { term: 'Event time', def: 'When the record states a thing happened. Event time is the dial’s primary upper scale – the readings that answer “what happened, and when”.' },
    assertionTime: { term: 'Assertion time', def: 'When a publication said so. Assertion time is the dial’s lower calibration scale – the sightings that show how each reading was evidenced.' },
    sighting: { term: 'sighting', def: 'One archived publication that recorded this callsign, shown at that publication’s vintage. Each pip on the lower scale is a sighting.' },
    vintage: { term: 'vintage', def: 'The date a publication itself carries – when it was published, not when the events it lists happened.' },
    publication: { term: 'publication', def: 'One archived file the mirror holds byte-for-byte: a register snapshot, an availability list, a statistics table, and so on.' },
    bookkeeping: { term: 'record-bookkeeping', def: 'The register’s own created and last-modified stamps. They attest that a record was present in the system by a date, not that a licensing event happened.' },
    disputed: { term: 'disputed', def: 'The held publications assert competing dates for the same kind of event. Every competing claim is shown; the record adjudicates none of them.' },
    // The record's central convention as a linkable term (see site/v1/copy.js for
    // the rationale). Kept string-identical to the browser twin.
    flag: { term: 'flag, never a verdict', def: 'A marker the record raises where a value looks inconsistent with what the other held publications, or the record’s own derived rules, would lead you to expect. A flag says where to look and offers the candidate explanations; it is never a ruling, and the record chooses none of them.' },
    series: { term: 'series', def: 'The block a callsign belongs to, opened on a date (for example the M7 series). A series-level fact that frames the record, never a claim about this callsign’s own licensing.' },
    carriedOrigin: { term: 'carried origin', def: 'A licence-chain start date that pre-dates the callsign’s own series – a sign the licence history was carried over from an earlier callsign. The record raises a scope note rather than treating the two dates as a conflict.' },
    // How the record reads a date it holds (issue #965): the three named readings
    // the dated-figure caveats lean on, each linked from the caveat that invokes
    // it. See site/v1/copy.js for the rationale; kept string-identical.
    earliestSurviving: { term: 'earliest surviving', def: 'A start date read as the earliest one still present in the publication that asserts it, rather than the original. Rolling retention and reissues drop or replace older rows, so an earlier start may have existed and left no surviving trace – the date bounds how far back the held record reaches, never “the first ever”.' },
    pre1977: { term: 'pre-1977 start date', def: 'A recorded original start date before 1977, read as attested-unreliable: the OARC community wiki reports that the register’s original-start field is not reliable before then, citing an administrative glitch by the then regulator. That is community-tier sourcing, not corroborated against Ofcom – the date is shown exactly as held, carrying this limit beside it.' },
    massUpdateEpisode: { term: 'mass-update episode', def: 'A window in which tens of thousands of records carry the same date stamp. Inside one, a stamp records a single system-wide episode – a migration or a bulk edit – rather than something that happened to each record, so the record reads it as bookkeeping and never as a licensing event.' },
    derived: { term: 'derived', def: 'This value is computed by the mirror from the held publications, not read verbatim from any single one of them.' },
    inferred: { term: 'inferred', def: 'A reading the mirror interprets from the held values, hedged where it is not certain – not a fact asserted by any publication.' },
    context: { term: 'context', def: 'A framing fact drawn from reference data, not a claim about this record – shown to place the reading in its wider setting.' },
    // Callsign-structure vocabulary (issue #931): the domain terms the anatomy
    // page uses, arriving with that surface. Each links out to its full
    // definition on the glossary page and opens inline where the anatomy prose
    // names it. Record-scoped and non-adjudicating like every other entry.
    prefix: { term: 'prefix', def: 'The opening character or characters of a callsign, showing the country that issued it. UK amateur callsigns begin G, M or 2, allocated by the ITU.' },
    rsl: { term: 'Regional Secondary Locator', def: 'A letter inserted after the first character of a callsign to show which UK nation or Crown Dependency the station is in – for example W for Wales. Often abbreviated RSL. Club stations may instead use a letter from a club-only set (the GX/MX forms), and Ofcom may notify a temporary RSL to mark a national occasion.' },
    suffix: { term: 'suffix', def: 'The ending letters of a callsign – for example the TEE in M7TEE. Normally three letters, though some heritage callsigns carry only two, and a single letter belongs to a special contest callsign granted by Ofcom and administered by the RSGB. This is the sense of “suffix” used across the record, distinct from the optional post-slash operating suffix.' },
    operatingSuffix: { term: 'operating suffix', def: 'An optional addition after a forward slash, such as /P for portable – what Ofcom’s licence conditions call a “suffix”. The record names it the operating suffix to keep it distinct from a callsign’s ending-letter suffix.' },
    visitorPrefix: { term: 'visitor prefix', def: 'The form a visiting operator uses in the UK: a UK prefix and Regional Secondary Locator before a slash, then their home callsign – for example MW/ before a non-UK callsign. The record keeps these reciprocal forms distinct from core callsigns.' },
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
    lede: 'Plain-language definitions of the terms this record uses – the vocabulary of the two-clock instrument, what the record holds, how the record reads a date, how each value is produced, and the parts of a callsign. Each entry is one clear line, deep-linkable by its #anchor, and is the very definition the inline popovers open.',
    readingLabel: 'reading the record',
    holdingsLabel: 'what the record holds',
    datesLabel: 'how the record reads a date',
    provenanceLabel: 'how a value is produced',
    structureLabel: 'the parts of a callsign',
    popMore: 'Full definition',
    foot: 'The vocabulary here grows with the record: each term joins the glossary as the surface that uses it is migrated, rather than being described ahead of a page that uses it. The remaining domain vocabulary – the register’s status values and dataset classes – follows the same way.',
  },

  // The v1 anatomy / structure-reference page (issue #931): the full-page home
  // for the callsign-structure explainer migrated from the previous surface. The
  // labelled diagram and the sourced facts tables are authored in the static
  // baseline (site/v1/anatomy.html); these strings are its framing copy, walked
  // by the claims-bar test and held against the page by a parity test.
  // Record-scoped, plain-English, no verdict words. Kept string-identical to the
  // browser twin (site/v1/copy.js); the mirror drift-guard holds the two.
  anatomyPage: {
    eyebrow: 'explainer · plain-english background',
    title: 'Anatomy',
    lede: 'The parts of a UK amateur callsign, which characters belong in one, and who decides what is allowed – background for the notes shown across the record. This is not official guidance; for that, see Ofcom. Each fact below carries its source and how confident the reading is.',
    howToReadSources: 'How to read the sources – authoritative means stated in an Ofcom-published document; best available means a reputable secondary source where the primary is silent; institutional knowledge means widely known but not sourced here.',
    diagramLabel: 'a callsign, taken apart',
    partsLabel: 'the parts of a callsign',
    rslLabel: 'regional secondary locators',
    classesLabel: 'licence classes and their prefixes',
    charactersLabel: 'which characters belong',
    slashesLabel: 'operating away or abroad',
    whoLabel: 'who decides what is allowed',
    sourcesLabel: 'sources',
    foot: 'An independent, unofficial mirror. Plain-English background, not official guidance – for licensing questions consult Ofcom directly.',
  },

  // The v1 history journey (issue #932): two event-first surfaces built on the
  // settled temporal hierarchy – event time leads (what the record states
  // happened), assertion time rides beneath as the evidence layer (which
  // publications state it). Kept string-identical to the browser twin
  // (site/v1/copy.js); the mirror drift-guard holds the two, and the claims-bar
  // test walks every string here.
  history: {
    onThisDay: {
      eyebrow: 'event-time calendar',
      title: 'On this day',
      lede: EVENT_TIME_GLOSS + ' Dated licensing events, arranged by calendar day: for each series, the earliest start evidence and the earliest cancellation evidence the held corpus carries. Every entry cites the publications that assert it – its assertion time – so the two clocks never merge. “Earliest held” describes this mirror’s holdings, never “the first ever”.',
      enhanceNote: 'Every dated entry below is in this page as served, with no script needed to read it. The page’s script adds one thing: a signpost for the reader’s own calendar day.',
      todayLead: 'Today is {day}',
      todayEntriesLink: '{count} on this day',
      todayIn: ' in the held record.',
      todayNone: 'Today is {day}. The held corpus places no first-of-series event on this day – non-observation, never “nothing ever happened on this day”.',
      leadStart: 'earliest held start evidence',
      leadCancellation: 'earliest held cancellation evidence',
      tie: '{count} callsigns tie on this day',
      assertedByFold: 'asserted by {count} {publication}',
      carriedHistory: 'This start predates the {series}-series’ own introduction ({month}): it is carried licence history – the original start of the holder’s licence chain, which this later-introduced callsign inherited, not the callsign’s own issuance (the callsign did not exist this early).',
      // Kept string-identical to the browser twin (site/v1/copy.js carries the
      // rationale for the three non-caveat background bullets below).
      explainerLabel: 'How to read these dates (earliest-surviving semantics, reissues, coverage)',
      explainerLead: 'Every entry is derived from what the archived publications assert. The caveats an entry can carry:',
      explainerCarriedHistory: 'Carried licence history – the start dates are the licence chain’s original start, never the callsign’s own issuance date (Ofcom’s Licence-View field dictionary, disclosed under FOI, 2014/15). A recently-introduced series inherits the holder’s existing licence history – M7 from October 2018, M8 and M9 from October 2025 – so its earliest held start can predate the series’ own introduction by decades. Where it does, the entry says so: the carried origin is the interesting fact, not a flaw in the date.',
      explainerUnparsedSeries: 'Series whose callsigns the parser reads no prefix series from – visitor M/… renderings, special-event GB… forms – have no slot here; their records remain on the per-callsign page.',
      explainerFurtherWorking: 'The full working behind these readings – the earliest-surviving inference rules, and how cross-vintage revisions are reconciled – is carried in the project’s committed reports rather than on this page.',
      countFoot: '{count} entries across {days} calendar days, covering the series the held corpus carries start or cancellation evidence for. Days not listed carry no held evidence – non-observation, never “nothing happened”.',
      empty: 'No entries. The held corpus carries no per-series licensing-event evidence to place on a calendar – a statement about these holdings, not about history.',
      loadError: 'Could not load the on-this-day calendar. The framing and reading notes above are the complete record; the timeline offers the same event time by year.',
    },
    timeline: {
      eyebrow: 'event-time over the years',
      title: 'Timeline',
      lede: EVENT_TIME_GLOSS + ' The held corpus’s licensing activity along event time: for each licensing kind, how many dated events the archived publications place in each year. Scrub the years to read what the mirror can say as at any instant – each figure naming the publications and vintages that assert it, the assertion time beneath. Counts describe this mirror’s holdings, never “the whole truth”.',
      enhanceNote: 'Every figure below is in this page as served, with no script needed to read it: the charts and their data tables, the cumulative figures for every year, and the full readout for the record’s own “as at” year. The page’s script adds a slider that moves that readout to any year.',
      histogramsLabel: 'activity by year, per licensing kind',
      histogramsNote: 'Each bar is a count of distinct dated events (one per callsign, kind and day; a date asserted by several vintages is one event). A year with no bar carries no held evidence for that kind – non-observation, never “nothing happened”.',
      histogramTotal: '{count} dated events across the held corpus',
      cumulativeLabel: 'as at the end of a year',
      scrubberLabel: 'Scrub the timeline – as at the end of a year',
      scrubberAnnouncement: 'As at end of {year}: {starts} starts to date, {reservations} active reservation windows.',
      readoutAsAt: 'As at end of {year}',
      readoutStarts: '{count} {subject} a surviving licence-start dated on or before end of {year}.',
      // The bi-temporal test's own parenthetical (see site/v1/copy.js), kept
      // string-identical to the browser twin.
      readoutReservations: '{count} reservation {subject} stated to still be open at end of {year} (stated end on or after then, stating vintage proven by then) – a reading of the stated bound, never a status.',
      readoutActivity: 'New dated events in {year}: ',
      readoutSeries: 'Leading prefix series by starts to date: ',
      readoutAssertedLead: 'This year’s events are asserted by ',
      readoutAssertedNone: 'No new dated event is asserted in {year} – the figures above carry forward from earlier years.',
      readoutCaveats: 'Caveats: ',
      // See site/v1/copy.js for the rationale for the three non-caveat
      // background bullets below, kept string-identical to the browser twin.
      explainerLabel: 'How to read this timeline (derived counts, earliest-surviving semantics, non-observation)',
      explainerLead: 'Every figure is derived from what the held vintages assert, and cites the datasets and their vintages that state it – the two time axes are never merged. The caveats the figures can carry:',
      explainerCarriedHistory: 'Carried licence history – a “starts to date” count includes callsigns whose earliest surviving start is the licence chain’s original start, never the callsign’s own issuance date (Ofcom’s Licence-View field dictionary, disclosed under FOI, 2014/15). A recently-introduced series inherits the holder’s existing licence history – M7 from October 2018, M8 and M9 from October 2025 – so some of its counted starts can predate the series’ own introduction by decades: the carried origin is the interesting fact, not a flaw in the count.',
      explainerUnparsedSeries: 'Series whose callsigns the parser reads no prefix series from – visitor M/… renderings, special-event GB… forms – have no slot in these per-series figures; their records remain on the per-callsign page.',
      explainerFurtherWorking: 'The full working behind these figures – the earliest-surviving inference rules, and how cross-vintage revisions are reconciled – is carried in the project’s committed reports rather than on this page.',
      empty: 'No entries. The held corpus carries no dated licensing-event evidence to place on a timeline – a statement about these holdings, not about history.',
      loadError: 'Could not load the timeline data. The framing and reading notes above are the complete record; the on-this-day calendar offers the same event time by calendar day.',
    },
  },
} as const;

// Where a caveat's fuller explanation lives (issue #965) – see site/v1/copy.js
// for the rationale. Kept identical to the browser twin, and drift-guarded in
// src/ci/render/v1-sections.test.ts against both the engine's caveat vocabulary
// and the glossary registry.
export const CAVEAT_GLOSSARY_TERMS: Readonly<Record<string, keyof typeof V1_COPY.glossary>> = {
  'earliest-surviving': 'earliestSurviving',
  'pre-1977': 'pre1977',
  'mass-episode-window': 'massUpdateEpisode',
  'vintages-disagree': 'flag',
};

// Every string value in the registry, flattened – the surface the claims-bar
// test walks.
export function collectCopyStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectCopyStrings);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(collectCopyStrings);
  return [];
}

export const V1_COPY_STRINGS: string[] = [EVENT_TIME_GLOSS, ASSERTION_TIME_GLOSS, ...collectCopyStrings(V1_COPY)];
