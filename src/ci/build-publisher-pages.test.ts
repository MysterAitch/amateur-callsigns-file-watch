import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildPublisherPages,
  collectHoldings,
  holdingsForPublisher,
  publisherPage,
  publishersIndexPage,
  publisherHref,
  type Holding,
} from './build-publisher-pages.ts';
import { authorPublisherId, readPublisherRegister, type PublisherEntry, type PublisherRegister } from '../shared/publishers.ts';

// Issue #618, increment 2: the per-publisher pages and the publishers index,
// plus the sourceKey -> author derivation they build on. The pure-rendering
// tests run against fixtures so the wording and structure are pinned
// independently of the real archive; the data-validity block builds the real
// register + archive metas and asserts the holdings-rich Ofcom page, the
// witness-only Internet Archive page, and the author derivation across the
// corpus. Test names follow Subject_Scenario_Outcome.

// ---- Fixtures --------------------------------------------------------------

const OFCOM: PublisherEntry = {
  id: 'ofcom',
  name: 'Ofcom',
  roles: ['originator'],
  url: 'https://www.ofcom.org.uk',
  channels: ['live', 'ofcom-disclosure-log'],
  licenceBasis: 'ofcom-terms',
  licenceStatement: 'Ofcom originates the register and serves it itself.',
  licenceUrl: 'https://www.ofcom.org.uk/terms',
  licenceCitations: [{ url: 'https://www.ofcom.org.uk/terms', note: 'Ofcom terms of use — free accurate reproduction with acknowledgement.' }],
  authorityCeiling: 'Official',
};

const UKGWA: PublisherEntry = {
  id: 'ukgwa',
  name: 'UK Government Web Archive',
  roles: ['official-archive'],
  operator: 'The National Archives',
  url: 'https://www.nationalarchives.gov.uk/webarchive/',
  channels: ['ukgwa'],
  licenceBasis: 'ogl-v3',
  licenceStatement: 'Crown copyright, re-usable under the Open Government Licence.',
  licenceUrl: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
  licenceCitations: [{ url: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/', note: 'The Open Government Licence v3.0 text.' }],
  authorityCeiling: 'Official',
};

const GITHUB: PublisherEntry = {
  id: 'github',
  name: 'GitHub',
  roles: ['incidental-host'],
  operator: 'GitHub, Inc.',
  url: 'https://github.com',
  channels: [],
  licenceBasis: 'unverified',
  licenceStatement: 'The re-use terms of a hosted copy depend on that repository’s own licence.',
  licenceCitations: [],
  authorityCeiling: 'Community',
};

const HOLDINGS: Holding[] = [
  { key: '2026-06-23', lane: 'open-data', title: 'Publication of 23 June 2026', authorId: 'ofcom', sourceKey: 'ofcom-amateur-callsigns', witnessPublisherIds: [], witnessAgreementByPublisher: {}, unresolvedChannels: [] },
  { key: 'ofcom-2016--all', lane: 'foi', title: 'All callsigns 2016', authorId: 'ofcom', sourceKey: 'ofcom-foi', witnessPublisherIds: ['ukgwa'], witnessAgreementByPublisher: { ukgwa: 'corroborating' }, unresolvedChannels: [], datasetClasses: ['register-snapshot'], vintage: '2016-09' },
  { key: 'wdtk-174341--available', lane: 'foi', title: 'Available callsigns list', authorId: 'ofcom', sourceKey: 'wdtk-foi', witnessPublisherIds: ['whatdotheyknow'], witnessAgreementByPublisher: { whatdotheyknow: 'citation-grade' }, unresolvedChannels: [], datasetClasses: ['available-pool'] },
];

// ---- Author derivation -----------------------------------------------------

describe('authorPublisherId — deriving a dataset author from its source key', { tags: ['unit'] }, () => {
  it('AuthorPublisherId_OfcomOpenDataSourceKey_ResolvesToOfcom', () => {
    expect(authorPublisherId('ofcom-amateur-callsigns')).toBe('ofcom');
  });

  it('AuthorPublisherId_OfcomFoiSourceKey_ResolvesToOfcom', () => {
    expect(authorPublisherId('ofcom-foi')).toBe('ofcom');
  });

  it('AuthorPublisherId_WdtkFoiSourceKey_ResolvesToOfcomNotTheServingChannel', () => {
    // The author is a claim about origin: Ofcom answered the FOI request, so it
    // is the author even though WhatDoTheyKnow is the serving channel.
    expect(authorPublisherId('wdtk-foi')).toBe('ofcom');
    expect(authorPublisherId('wdtk-356636--all')).toBe('ofcom');
  });

  it('AuthorPublisherId_UnmappedSourceKey_ResolvesToUndefinedSoTheCallerFlags', () => {
    // Flag-never-guess: an unmapped source is surfaced, not given a flattering
    // author.
    expect(authorPublisherId('some-future-source')).toBeUndefined();
  });
});

// ---- Holdings partition ----------------------------------------------------

describe('holdingsForPublisher — partitioning holdings by relationship', { tags: ['unit'] }, () => {
  it('HoldingsForPublisher_AuthoredAndHostedEntries_ArePartitionedByRelationship', () => {
    const h = holdingsForPublisher('ofcom', HOLDINGS);
    // Ofcom authors every entry, and hosts none in this fixture (no entry's
    // witnesses resolve to ofcom).
    expect(h.authored.map(x => x.key)).toEqual(['2026-06-23', 'ofcom-2016--all', 'wdtk-174341--available']);
    expect(h.hosted).toEqual([]);
  });

  it('HoldingsForPublisher_APublisherThatOnlyHosts_HasNoAuthoredHoldings', () => {
    const h = holdingsForPublisher('ukgwa', HOLDINGS);
    expect(h.authored).toEqual([]);
    expect(h.hosted.map(x => x.key)).toEqual(['ofcom-2016--all']);
  });
});

// ---- Composite holdings layout (#637) + derived blurbs (#636) --------------

// A fixture spanning the branches the composite must handle: a full complete
// open-data snapshot (largest), a declared-partial snapshot carrying several
// data-quality observations, a multi-class multi-table FOI entry recovered from
// a web archive (earliest, first spreadsheet), and an undated not-held FOI
// response. The vintage span leaves a run of empty years between 2016 and 2025,
// so the continuous map axis must show gaps.
const COMPOSITE: Holding[] = [
  {
    key: '2026-06-23', lane: 'open-data', title: 'Publication of 23 June 2026', authorId: 'ofcom',
    sourceKey: 'ofcom-amateur-callsigns', witnessPublisherIds: [], witnessAgreementByPublisher: {}, unresolvedChannels: [],
    datasetClasses: ['register-snapshot'], vintage: '2026-06-23', recordCount: 158318, tableCount: 1,
    coverage: { complete: true }, hasCoverageField: true, qualityCount: 0, coverageAffecting: false,
    provenance: 'live', recoveredChannels: [], hasXlsx: false,
  },
  {
    key: '2025-06-04', lane: 'open-data', title: 'Publication of 4 June 2025', authorId: 'ofcom',
    sourceKey: 'ofcom-amateur-callsigns', witnessPublisherIds: [], witnessAgreementByPublisher: {}, unresolvedChannels: [],
    datasetClasses: ['register-snapshot'], vintage: '2025-06-04', recordCount: 112650, tableCount: 1,
    coverage: { complete: false, scopeNotes: 'allocated licences only' }, hasCoverageField: true,
    qualityCount: 3, coverageAffecting: true, provenance: 'live', recoveredChannels: [], hasXlsx: false,
  },
  {
    key: 'ofcom-2016-09--all', lane: 'foi', title: 'Callsign database 2016', authorId: 'ofcom',
    sourceKey: 'ofcom-foi', witnessPublisherIds: ['ukgwa'], witnessAgreementByPublisher: { ukgwa: 'corroborating' }, unresolvedChannels: [],
    datasetClasses: ['register-snapshot', 'forbidden-list'], vintage: '2016-09-20', recordCount: 141295,
    tableCount: 2, hasCoverageField: false, qualityCount: 0, coverageAffecting: false,
    recoveredChannels: ['UKGWA'], hasXlsx: true, outcome: 'successful',
  },
  {
    key: 'ofcom-612185--not-held', lane: 'foi', title: 'Unallocated call signs (not held)', authorId: 'ofcom',
    sourceKey: 'ofcom-foi', witnessPublisherIds: [], witnessAgreementByPublisher: {}, unresolvedChannels: [],
    datasetClasses: ['reference-context'], vintage: undefined, recordCount: undefined, tableCount: 0,
    hasCoverageField: false, qualityCount: 0, coverageAffecting: false, recoveredChannels: [],
    hasXlsx: false, outcome: 'not held',
  },
];
const compositeHtml = publisherPage(OFCOM, { authored: COMPOSITE, hosted: [] });

describe('publisherPage composite — derived per-dataset blurbs (#636)', { tags: ['unit'] }, () => {
  it('Blurb_RegisterSnapshot_ReadsKindScaleAndVintageInPlainEnglish', () => {
    // Month precision (#551): the blurb sits in the same overview row as the
    // vintage cell, which already shows month with the exact day on its title.
    expect(compositeHtml).toContain('A register snapshot of ~158,000 callsigns as published June 2026.');
  });

  it('Blurb_MultiClassEntry_NamesEveryKindOnceAndCaveatsTheLargestTable', () => {
    // Counted once, both classes named, and the scale is the largest single
    // table (never the cross-sheet sum).
    expect(compositeHtml).toContain('A register snapshot and list of forbidden suffixes of ~141,000 callsigns (its largest of 2 tables) as at September 2016.');
  });

  it('Blurb_DeclaredPartialSnapshot_AppendsTheDeclaredScope', () => {
    expect(compositeHtml).toContain('A register snapshot of ~113,000 callsigns as published June 2025, allocated licences only.');
  });

  it('Blurb_AndVintageCell_AgreeOnMonthPrecisionWithinTheSameRow', () => {
    // #551: one overview row must not mix precisions - the compact vintage
    // cell and the prose blurb beside it both show month, and the exact day
    // is never lost (it rides on the cell's title, not repeated in prose).
    expect(compositeHtml).toContain('<span class="hold-col hold-vintage" title="23 June 2026">June 2026</span>');
    expect(compositeHtml).toContain('A register snapshot of ~158,000 callsigns as published June 2026.');
  });

  it('Blurb_NotHeldResponse_SaysWhatIsKnownRatherThanPadding', () => {
    expect(compositeHtml).toContain('recording that Ofcom does not hold this data.');
  });

  it('Blurb_NotHeldResponse_NamesAndLinksTheFoiResponseItRestsOn', () => {
    // The bare "not held" sentence otherwise carries no identifier — the fix for
    // issue #770 wires it to the same entry (key + link) the row's own title
    // already carries one line above, rather than leaving an unnamed citation.
    expect(compositeHtml).toContain('<a href="../../datasets/foi/ofcom-612185--not-held/index.html">Freedom-of-Information response</a>');
    expect(compositeHtml).toContain('(<code>ofcom-612185--not-held</code>)');
  });
});

describe('publisherPage composite — the scan strip signals (#637)', { tags: ['unit'] }, () => {
  it('Scale_MultiTableEntry_ReportsTheLargestSingleTableNeverTheCrossSheetSum', () => {
    // Honesty rule: the largest single table (141,295), never 141,295 + 1,465.
    expect(compositeHtml).toContain('<b>141,295</b>');
    expect(compositeHtml).not.toContain('142,760');
    expect(compositeHtml).toContain('largest of 2 tables');
  });

  it('Scale_EntryWithNoTabularData_SaysSoRatherThanShowingZero', () => {
    expect(compositeHtml).toContain('no tabular data');
  });

  it('Coverage_OpenDataComplete_ShowsGlyphAndWordsNotColourAlone', () => {
    expect(compositeHtml).toContain('declared complete');
    // The glyph is paired with words, never carrying the meaning by colour alone.
    expect(compositeHtml).toMatch(/aria-hidden="true">✓<\/span> declared complete/);
  });

  it('Coverage_OpenDataPartial_ShowsPartialWithTheScopeInTheTitle', () => {
    expect(compositeHtml).toContain('declared partial');
    expect(compositeHtml).toContain('title="allocated licences only"');
  });

  it('Coverage_FoiEntry_ReadsNotDeclaredBecauseTheLaneHasNoSuchField', () => {
    // FOI carries no intendedCoverage field, so it can honestly say no more.
    expect(compositeHtml).toContain('not declared');
  });

  it('QualityFlags_SeveralObservations_FoldIntoOneCountPillLinkingToFidelity', () => {
    // Multiple observations show a count, not a stack; coverage-affecting is
    // surfaced distinctly; the pill links to the fidelity page.
    expect(compositeHtml).toContain('3 data-quality flags · coverage-affecting');
    expect(compositeHtml).toMatch(/hold-flag--issue" href="[^"]*fidelity\.html"/);
  });

  it('Notability_ComputedMarkers_FlagEarliestLargestRecoveredFirstSpreadsheetAndNotHeld', () => {
    expect(compositeHtml).toContain('★ earliest holding');
    expect(compositeHtml).toContain('▲ largest single table');
    expect(compositeHtml).toContain('recovered · UKGWA');
    expect(compositeHtml).toContain('first spreadsheet');
    expect(compositeHtml).toContain('not held');
  });

  it('MetadataPills_KindTags_AreCalmLinksDistinctFromTheOrangeFlagPills', () => {
    // Two distinct pill classes: calm kind tags (own line) vs. orange flags.
    expect(compositeHtml).toMatch(/hold-tag" href="[^"]*datasets\/classes\/forbidden-list\.html">forbidden list/);
    expect(compositeHtml).toContain('class="hold-flag hold-flag--note"');
  });

  it('DatasetKey_InTheRowBody_IsDemotedNotProminentInTheStrip', () => {
    // The internal key is demoted to a small muted code element in the body,
    // not a scan-strip signal.
    expect(compositeHtml).toContain('<code class="hold-key">2026-06-23</code>');
  });
});

describe('publisherPage composite — overview map on a continuous vintage axis (#637)', { tags: ['unit'] }, () => {
  it('Map_ContinuousAxis_RendersEmptyYearsAsVisibleGaps', () => {
    // 2016 then 2025/2026 leaves 2017–2024 empty; each is a visible gap row.
    expect(compositeHtml).toContain('hold-map-yr--empty');
    expect(compositeHtml).toMatch(/hold-map-yr hold-map-yr--empty"><span class="hold-map-yrlab">2020<\/span>/);
  });

  it('Map_EachCell_CarriesAKindLetterAndAnAccessibleNameSoColourIsNeverTheSoleCue', () => {
    // The letter carries the kind; the accessible name spells out title, kind
    // and vintage.
    expect(compositeHtml).toMatch(/hold-cell" data-kind="register-snapshot" href="#a-hold-2026-06-23" aria-label="Publication of 23 June 2026 — Register snapshot — 23 June 2026"/);
    expect(compositeHtml).toContain('data-kind="forbidden-list"');
  });

  it('Map_Cell_LinksToItsRowAnchorForTargetHighlighting', () => {
    // The cell anchors the row; the stylesheet highlights the :target row.
    expect(compositeHtml).toContain('href="#a-hold-ofcom-612185--not-held"');
    expect(compositeHtml).toContain('id="a-hold-ofcom-612185--not-held"');
    expect(compositeHtml).toContain('.hold-row:target');
  });

  it('Map_Legend_ListsOnlyTheKindsPresent', () => {
    expect(compositeHtml).toContain('hold-legend');
    expect(compositeHtml).toContain('hold-cell--legend');
  });
});

describe('publisherPage composite — the vintage timeline structure (#637)', { tags: ['unit'] }, () => {
  it('Timeline_YearGroups_AreOrderedNewestFirst', () => {
    const y2026 = compositeHtml.indexOf('>2026</span>');
    const y2016 = compositeHtml.indexOf('>2016</span>');
    expect(y2026).toBeGreaterThan(-1);
    expect(y2016).toBeGreaterThan(y2026);
  });

  it('Timeline_MultiClassEntry_IsCountedOnceInItsYear', () => {
    // The 2016 entry carries two classes but counts once towards its year.
    expect(compositeHtml).toMatch(/<span class="hold-yearnum">2016<\/span> <span class="hold-yearcount">1 dataset<\/span>/);
  });

  it('Timeline_UndatedEntries_CloseTheListUnderTheirOwnHeading', () => {
    expect(compositeHtml).toContain('hold-yeargroup--undated');
    expect(compositeHtml).toMatch(/<span class="hold-yearnum">Undated<\/span>/);
  });
});

describe('publisherPage composite — non-happy paths (#637)', { tags: ['unit'] }, () => {
  it('Composite_SingleHolding_RendersAMapAndTimelineWithOneCellAndRow', () => {
    const html = publisherPage(OFCOM, { authored: [COMPOSITE[0]], hosted: [] });
    expect(html).toContain('hold-map');
    expect(html).toContain('hold-timeline');
    expect(html).toMatch(/<span class="hold-yearnum">2026<\/span> <span class="hold-yearcount">1 dataset<\/span>/);
    expect(html).toContain('id="a-hold-2026-06-23"');
  });

  it('Composite_UndatedOnlyHoldings_StillRenderAnUndatedGroupAndNoDatedYears', () => {
    const html = publisherPage(OFCOM, { authored: [COMPOSITE[3]], hosted: [] });
    expect(html).toContain('hold-yeargroup--undated');
    expect(html).toContain('undated');
  });

  it('Composite_AuthoredAndHosted_NamespaceRowIdsSoADualRoleEntryNeverCollides', () => {
    // The same entry authored and hosted gets distinct anchors per relationship.
    const html = publisherPage(OFCOM, { authored: [COMPOSITE[0]], hosted: [COMPOSITE[0]] });
    expect(html).toContain('id="a-hold-2026-06-23"');
    expect(html).toContain('id="h-hold-2026-06-23"');
  });
});

// ---- Per-publisher page ----------------------------------------------------

describe('publisherPage — a publisher with holdings', { tags: ['unit'] }, () => {
  const html = publisherPage(OFCOM, {
    authored: HOLDINGS,
    hosted: [{ key: 'ofcom-hosted', lane: 'foi', title: 'A copy Ofcom hosts', authorId: 'ofcom', sourceKey: 'ofcom-foi', witnessPublisherIds: ['ofcom'], witnessAgreementByPublisher: { ofcom: 'corroborating' }, unresolvedChannels: [] }],
  });

  it('PublisherPage_PublisherWithAuthoredAndHostedHoldings_ListsBothWithCountsAndDeepLinks', () => {
    expect(html).toContain('<b>3</b> datasets originate');
    expect(html).toContain('<b>1</b> copy was obtained');
    // Deep links both ways: an authored open-data entry and a hosted FOI entry.
    expect(html).toContain('href="../../datasets/open-data/2026-06-23/index.html"');
    expect(html).toContain('href="../../datasets/foi/ofcom-hosted/index.html"');
  });

  it('PublisherPage_Holdings_KeepAuthorAndHostAsSeparateAxes', () => {
    // Authorship is framed as origin (holds wherever a copy is held); hosting as
    // a direct copy from a venue — the two axes never conflated.
    expect(html).toContain('a fact about origin, not about which venue served the bytes');
    expect(html).toContain('obtained <b>directly</b>');
    // Only direct relationships exist in the data; the wording reserves room for
    // transitive corroboration later.
    expect(html).toMatch(/Transitive corroboration.*will be labelled distinctly/);
  });

  it('PublisherPage_HostedCorroboratingCopy_CarriesTheCorroborationPillInTheComposite', () => {
    // A hosted copy whose witness hash matches a held copy is flagged
    // corroborating on its composite row (#618 increment 3) — provable
    // availability, shown as a calm positive pill, not a claim.
    expect(html).toContain('corroborating · bytes held');
  });
});

describe('publisherPage — hosted copies carry their agreement class', { tags: ['unit'] }, () => {
  it('PublisherPage_HostedCitationGradeCopy_RendersNoAgreementMarkerSoNoDoubtIsManufactured', () => {
    const html = publisherPage(UKGWA, {
      authored: [],
      hosted: [{ key: 'ofcom-2016--all', lane: 'foi', title: 'All callsigns 2016', authorId: 'ofcom', sourceKey: 'ofcom-foi', witnessPublisherIds: ['ukgwa'], witnessAgreementByPublisher: { ukgwa: 'citation-grade' }, unresolvedChannels: [] }],
    });
    expect(html).toContain('#h-hold-ofcom-2016--all');
    expect(html).not.toContain('corroborating · bytes held');
  });
});

describe('publisherPage — a publisher with no holdings', { tags: ['unit'] }, () => {
  it('PublisherPage_PublisherWithNoHoldings_StatesNoneHonestlyRatherThanEmpty', () => {
    const html = publisherPage(GITHUB, { authored: [], hosted: [] });
    expect(html).toContain('No dataset in the mirror is authored by or witnessed through GitHub yet');
    // Seeded so its citations resolve, with a home in the graph for later.
    expect(html).toContain('seeded in the register');
  });
});

describe('publisherPage — the licence basis wording', { tags: ['unit'] }, () => {
  it('PublisherPage_UnverifiedLicenceBasis_IsRenderedAsNotEstablishedNotGuessed', () => {
    const html = publisherPage(GITHUB, { authored: [], hosted: [] });
    expect(html).toContain('<b>not established</b>');
    expect(html).toContain('<code>unverified</code>');
    expect(html).toContain('fail-honest state, not a claim');
    // No terms document is invented for an unverified basis.
    expect(html).toContain('No settled terms document to cite');
  });

  it('PublisherPage_VerifiedLicenceBasis_StatesItIsADefaultNotABlanketClaim', () => {
    const html = publisherPage(OFCOM, { authored: [], hosted: [] });
    // Must not overstate: the basis is the publisher's default/typical one, and
    // a specific publication may override it.
    expect(html).toContain('default/typical');
    expect(html).toMatch(/a specific publication.*may carry a different basis/);
    expect(html).toContain('Ofcom’s terms of use');
    // The register's own statement is the source, rendered verbatim.
    expect(html).toContain('Ofcom originates the register and serves it itself.');
  });

  it('PublisherPage_AssertedLicenceBasis_LinksItsCitationsUnderHowToVerifyThis', () => {
    const html = publisherPage(OFCOM, { authored: [], hosted: [] });
    expect(html).toContain('How to verify this');
    expect(html).toContain('read and confirmed to say what its note claims');
    // The citation URL is rendered as a link with its "what it establishes" note.
    expect(html).toContain('href="https://www.ofcom.org.uk/terms"');
    expect(html).toContain('free accurate reproduction with acknowledgement');
  });

  it('PublisherPage_UnverifiedBasis_SaysNoCitationRatherThanOverstating', () => {
    const html = publisherPage(GITHUB, { authored: [], hosted: [] });
    expect(html).not.toContain('How to verify this');
    expect(html).toContain('No verifiable licence source is cited');
  });
});

describe('publisherPage — trust treatment', { tags: ['unit'] }, () => {
  it('PublisherPage_AuthorityCeiling_IsExplainedViaTheSourceAuthorityAxisGlossaryLink', () => {
    const html = publisherPage(UKGWA, { authored: [], hosted: [] });
    expect(html).toContain('<b>Official</b> rung');
    expect(html).toContain('glossary.html#axis-authority');
  });

  it('PublisherPage_AuthorityCeiling_IsFramedAsACrossCheckNotASecondDial', () => {
    const html = publisherPage(UKGWA, { authored: [], hosted: [] });
    expect(html).toContain('not a second trust dial');
    expect(html).toContain('never inflates one');
  });
});

// ---- Publishers index ------------------------------------------------------

describe('publishersIndexPage — the register listing', { tags: ['unit'] }, () => {
  const register: PublisherRegister = { schemaVersion: 1, publishers: [OFCOM, UKGWA, GITHUB] };
  const html = publishersIndexPage(register, HOLDINGS);

  it('PublishersIndex_EveryRegisterEntry_IsListedWithRoleSummaryAndHoldingCounts', () => {
    expect(html).toContain('href="ofcom/index.html"');
    expect(html).toContain('href="ukgwa/index.html"');
    expect(html).toContain('href="github/index.html"');
    // The operator is surfaced as a sub-label.
    expect(html).toContain('The National Archives');
  });

  it('PublishersIndex_HoldingCounts_ReflectAuthoredAndHostedPartition', () => {
    // Ofcom: authors all 3, hosts 0. UKGWA: authors 0, hosts 1.
    expect(html).toMatch(/<a href="ofcom\/index.html">Ofcom<\/a>[\s\S]*?<td class="n">3<\/td><td class="n"><span class="zero">0<\/span><\/td>/);
    expect(html).toMatch(/UK Government Web Archive[\s\S]*?<td class="n"><span class="zero">0<\/span><\/td><td class="n">1<\/td>/);
  });

  it('PublishersIndex_ZeroHoldingCount_DeEmphasisesViaTheSharedZeroClass', () => {
    // GitHub authors nothing and hosts nothing in this fixture (issue #731):
    // both its count cells mute, while a non-zero neighbour (e.g. Ofcom's 3)
    // stays plain.
    expect(html).toMatch(/GitHub<\/a>[\s\S]*?<td class="n"><span class="zero">0<\/span><\/td><td class="n"><span class="zero">0<\/span><\/td>/);
    expect(html).not.toMatch(/<span class="zero">3<\/span>/);
  });
});

// ---- publisherHref ---------------------------------------------------------

describe('publisherHref — depth-correct links to a publisher page', { tags: ['unit'] }, () => {
  it('PublisherHref_FromAnEntryPageAtDepthThree_AscendsToThePublisherSection', () => {
    // A dataset entry page (datasets/{lane}/{key}/) sits three levels below root.
    expect(publisherHref('ofcom', 3)).toBe('../../../publishers/ofcom/index.html');
  });

  it('PublisherHref_FromThePublishersIndexAtDepthOne_LinksASibling', () => {
    expect(publisherHref('ukgwa', 1)).toBe('../publishers/ukgwa/index.html');
  });
});

// ---- Real archive ----------------------------------------------------------

describe('the committed publisher pages built from the real archive', { tags: ['data-validity'] }, () => {
  let outputDir: string;
  let urls: string[];
  let holdings: Holding[];
  const read = (...rel: string[]): string => fs.readFileSync(path.join(outputDir, ...rel), 'utf8');

  beforeAll(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publisher-pages-'));
    urls = buildPublisherPages(outputDir, 'https://example.test/site');
    holdings = collectHoldings(readPublisherRegister());
  });

  afterAll(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  it('PublisherSection_RealArchive_EmitsAnIndexAndOnePagePerRegisterEntry', () => {
    const register = readPublisherRegister();
    // Index + one page per register entry.
    expect(urls.length).toBe(register.publishers.length + 1);
    expect(fs.existsSync(path.join(outputDir, 'publishers', 'index.html'))).toBe(true);
    for (const p of register.publishers) {
      expect(fs.existsSync(path.join(outputDir, 'publishers', p.id, 'index.html')), p.id).toBe(true);
    }
  });

  it('OfcomPage_RealArchive_IsHoldingsRichAuthoringEveryDataset', () => {
    // Ofcom authors every dataset the mirror holds — the count on the page must
    // match the derived holdings, not a hardcoded magic number.
    const authoredCount = holdings.filter(h => h.authorId === 'ofcom').length;
    expect(authoredCount).toBe(holdings.length);
    const html = read('publishers', 'ofcom', 'index.html');
    expect(html).toContain(`<b>${authoredCount}</b> datasets originate`);
    // A known open-data entry and a known FOI entry are listed and deep-linked.
    expect(html).toContain('href="../../datasets/open-data/2026-06-23/index.html"');
    expect(html).toContain('href="../../datasets/foi/wdtk-174341--available-callsigns-list/index.html"');
  });

  it('InternetArchivePage_RealArchive_IsWitnessOnlyWithAProvisionalReferenceCeiling', () => {
    const html = read('publishers', 'internet-archive', 'index.html');
    // Authored nothing (it is not an originator); hosts exactly the one wayback
    // capture — the open-data publication of 11 November 2025.
    expect(html).toContain('no dataset the mirror holds is authored by Internet Archive');
    expect(html).toContain('href="../../datasets/open-data/2025-11-11/index.html"');
    // The ceiling is the archive's own (Reference), recorded as provisional
    // pending the queued rung-assignment decision.
    expect(html).toContain('<b>Reference</b> rung');
    expect(html).toContain('provisional');
  });

  it('CollectHoldings_RealArchive_ResolvesOfcomAsAuthorOfEveryEntry', () => {
    // Every held dataset originates from Ofcom in the current corpus; an
    // unmapped author would be a flag, not a silent default.
    expect(holdings.every(h => h.authorId === 'ofcom')).toBe(true);
    // The wdtk-keyed FOI entries are hosted through WhatDoTheyKnow, not authored
    // by it.
    const wdtk = holdings.filter(h => h.witnessPublisherIds.includes('whatdotheyknow'));
    expect(wdtk.length).toBeGreaterThan(0);
    expect(wdtk.every(h => h.authorId === 'ofcom')).toBe(true);
  });
});
