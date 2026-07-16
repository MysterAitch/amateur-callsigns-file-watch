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

  it('PublisherPage_HostedCorroboratingCopy_SaysTheMirrorHoldsTheExactBytes', () => {
    // A hosted copy whose witness hash matches a held copy is marked
    // corroborating (#618 increment 3) — provable availability, not a claim.
    expect(html).toContain('corroborating: the mirror holds these exact bytes (sha256 verified)');
  });
});

describe('publisherPage — hosted copies carry their agreement class', { tags: ['unit'] }, () => {
  it('PublisherPage_HostedCitationGradeCopy_RendersNoAgreementMarkerSoNoDoubtIsManufactured', () => {
    const html = publisherPage(UKGWA, {
      authored: [],
      hosted: [{ key: 'ofcom-2016--all', lane: 'foi', title: 'All callsigns 2016', authorId: 'ofcom', sourceKey: 'ofcom-foi', witnessPublisherIds: ['ukgwa'], witnessAgreementByPublisher: { ukgwa: 'citation-grade' }, unresolvedChannels: [] }],
    });
    expect(html).toContain('href="../../datasets/foi/ofcom-2016--all/index.html"');
    expect(html).not.toContain('corroborating: the mirror holds these exact bytes');
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
    expect(html).toMatch(/<a href="ofcom\/index.html">Ofcom<\/a>[\s\S]*?<td class="n">3<\/td><td class="n">0<\/td>/);
    expect(html).toMatch(/UK Government Web Archive[\s\S]*?<td class="n">0<\/td><td class="n">1<\/td>/);
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
