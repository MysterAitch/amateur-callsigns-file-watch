import { describe, it, expect } from 'vitest';
import {
  validatePublisherRegister,
  validateWitnessChannelsResolve,
  collectWitnessChannels,
  validatePublishersAt,
} from './validate-publishers.ts';
import { readPublisherRegister } from '../shared/publishers.ts';
import type { PublisherRegister, PublisherEntry } from '../shared/publishers.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The publisher-register merge gate (#618 increment 1): a well-formed register
// passes; a duplicate id, an unknown role, a bad authority-ceiling rung, a
// malformed URL, a channel token claimed twice, an uncited licence basis and an
// unresolved witness channel each fail with a problem naming the offence. Every
// fixture is a deliberate one-field deviation from a valid entry.

function validEntry(overrides: Partial<PublisherEntry> = {}): PublisherEntry {
  return {
    id: 'ofcom',
    name: 'Ofcom',
    roles: ['originator'],
    url: 'https://www.ofcom.org.uk',
    channels: ['live'],
    licenceBasis: 'ofcom-terms',
    licenceStatement: 'Ofcom originates and serves the material.',
    licenceUrl: 'https://www.ofcom.org.uk/about-ofcom/website/terms-of-use',
    authorityCeiling: 'Official',
    ...overrides,
  };
}

function register(...publishers: PublisherEntry[]): PublisherRegister {
  return { schemaVersion: 1, publishers };
}

describe('validatePublisherRegister - a well-formed register', { tags: ['unit'] }, () => {
  it('Register_WhenEveryEntryWellFormed_PassesWithNoProblems', () => {
    const problems = validatePublisherRegister(register(
      validEntry(),
      validEntry({ id: 'wdtk', name: 'WhatDoTheyKnow', roles: ['foi-aggregator'], channels: ['wdtk'], licenceBasis: 'ogl-v3', licenceUrl: 'https://www.whatdotheyknow.com/help/officers', authorityCeiling: 'FOI' }),
    ));
    expect(problems).toEqual([]);
  });

  it('Register_WhenBasisUnverifiedAndNoLicenceUrl_PassesWithoutRequiringACitation', () => {
    const problems = validatePublisherRegister(register(
      validEntry({ id: 'github', name: 'GitHub', roles: ['incidental-host'], channels: [], licenceBasis: 'unverified', licenceUrl: undefined, authorityCeiling: 'Community' }),
    ));
    expect(problems).toEqual([]);
  });
});

describe('validatePublisherRegister - shape and vocabularies', { tags: ['unit'] }, () => {
  it('Register_WhenSchemaVersionUnsupported_Fails', () => {
    const reg = register(validEntry());
    reg.schemaVersion = 2;
    const problems = validatePublisherRegister(reg);
    expect(problems.some(p => /schemaVersion/.test(p.problem))).toBe(true);
  });

  it('Register_WhenPublishersEmpty_Fails', () => {
    const problems = validatePublisherRegister(register());
    expect(problems.some(p => /publishers is missing or empty/.test(p.problem))).toBe(true);
  });

  it('Publisher_WhenIdDuplicated_Fails', () => {
    const problems = validatePublisherRegister(register(
      validEntry({ channels: ['live'] }),
      validEntry({ channels: ['ukgwa'] }),
    ));
    expect(problems.some(p => /\.id is a duplicate/.test(p.problem))).toBe(true);
  });

  it('Publisher_WhenRoleUnknown_Fails', () => {
    const problems = validatePublisherRegister(register(validEntry({ roles: ['data-baron'] })));
    expect(problems.some(p => /unknown role "data-baron"/.test(p.problem))).toBe(true);
  });

  it('Publisher_WhenAuthorityCeilingNotAnAdr0014Rung_Fails', () => {
    const problems = validatePublisherRegister(register(validEntry({ authorityCeiling: 'Gold' as PublisherEntry['authorityCeiling'] })));
    expect(problems.some(p => /authorityCeiling "Gold" is not a valid ADR 0014 rung/.test(p.problem))).toBe(true);
  });

  it('Publisher_WhenLicenceBasisOutsideVocabulary_Fails', () => {
    const problems = validatePublisherRegister(register(validEntry({ licenceBasis: 'public-domain' })));
    expect(problems.some(p => /licenceBasis "public-domain" is not in the vocabulary/.test(p.problem))).toBe(true);
  });

  it('Publisher_WhenLicenceBasisAssertedButNoLicenceUrl_Fails', () => {
    const problems = validatePublisherRegister(register(validEntry({ licenceBasis: 'ofcom-terms', licenceUrl: undefined })));
    expect(problems.some(p => /licenceUrl is required unless licenceBasis is "unverified"/.test(p.problem))).toBe(true);
  });

  it('Publisher_WhenUrlMalformed_Fails', () => {
    const problems = validatePublisherRegister(register(validEntry({ url: 'ofcom.org.uk' })));
    expect(problems.some(p => /\.url is not a well-formed http\(s\) URL/.test(p.problem))).toBe(true);
  });

  it('Publisher_WhenLicenceUrlMalformed_Fails', () => {
    const problems = validatePublisherRegister(register(validEntry({ licenceUrl: 'javascript:alert(1)' })));
    expect(problems.some(p => /licenceUrl is not a well-formed http\(s\) URL/.test(p.problem))).toBe(true);
  });

  it('Publisher_WhenNameEmpty_Fails', () => {
    const problems = validatePublisherRegister(register(validEntry({ name: '' })));
    expect(problems.some(p => /\.name is missing or empty/.test(p.problem))).toBe(true);
  });
});

describe('validatePublisherRegister - channel-token uniqueness', { tags: ['unit'] }, () => {
  it('Channels_WhenOneTokenClaimedByTwoPublishers_Fails', () => {
    const problems = validatePublisherRegister(register(
      validEntry({ id: 'ofcom', channels: ['live'] }),
      validEntry({ id: 'impostor', name: 'Impostor', channels: ['live'], licenceBasis: 'unverified', licenceUrl: undefined, authorityCeiling: 'Community' }),
    ));
    expect(problems.some(p => /channel token "live" is claimed by more than one publisher/.test(p.problem))).toBe(true);
  });

  it('Channels_WhenTokensDisjoint_Passes', () => {
    const problems = validatePublisherRegister(register(
      validEntry({ id: 'ofcom', channels: ['live', 'ofcom-disclosure-log'] }),
      validEntry({ id: 'ukgwa', name: 'UK Government Web Archive', roles: ['official-archive'], channels: ['ukgwa'], licenceBasis: 'ogl-v3', licenceUrl: 'https://www.nationalarchives.gov.uk/webarchive/find-a-website/re-using-content/', authorityCeiling: 'Official' }),
    ));
    expect(problems).toEqual([]);
  });
});

describe('validateWitnessChannelsResolve - referential closure', { tags: ['unit'] }, () => {
  it('WitnessChannel_WhenTokenKnownToRegister_Resolves', () => {
    const problems = validateWitnessChannelsResolve(register(validEntry({ channels: ['live'] })), [
      { channel: 'live', at: 'archive/x/meta.json witnesses[0]' },
    ]);
    expect(problems).toEqual([]);
  });

  it('WitnessChannel_WhenTokenUnknownToRegister_FailsLoud', () => {
    const problems = validateWitnessChannelsResolve(register(validEntry({ channels: ['live'] })), [
      { channel: 'carrier-pigeon', at: 'archive/x/meta.json witnesses[0]' },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0].problem).toMatch(/witness channel "carrier-pigeon" resolves to no publisher/);
    expect(problems[0].path).toBe('archive/x/meta.json witnesses[0]');
  });
});

// Against the committed register and archive (not a scratch fixture): the
// shipped register is itself well-formed, and every witness channel recorded
// across both live lanes resolves through it - so a channel drifting away from
// the vocabulary is caught by CI, not on a rendered page.
describe('the committed publisher register and archive', { tags: ['data-validity'] }, () => {
  it('PublisherRegister_AsCommitted_IsWellFormed', () => {
    expect(validatePublisherRegister(readPublisherRegister())).toEqual([]);
  });

  it('WitnessChannels_AcrossBothLiveArchiveLanes_AllResolveToAPublisher', () => {
    const refs = collectWitnessChannels();
    // Guard the guard: the archive really does carry witnesses, so a green
    // result means resolution held, not that there was nothing to resolve.
    expect(refs.length).toBeGreaterThan(0);
    expect(validateWitnessChannelsResolve(readPublisherRegister(), refs)).toEqual([]);
  });

  it('ValidatePublishersAt_OverTheRealRepo_ReportsNoProblems', () => {
    expect(validatePublishersAt()).toEqual([]);
  });
});
