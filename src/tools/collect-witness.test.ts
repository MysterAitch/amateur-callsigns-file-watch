import { describe, it, expect } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  defaultUserAgent,
  isBlockingStatus,
  originalFilenameFromUrl,
  originalFilenameFromContentDisposition,
  resolveOriginalFilename,
  sha256OfBytes,
  resolveWitnessChannel,
  fetchResource,
  collectionOutcome,
  divergentCopyName,
  buildHoldingsIndexEntry,
  upsertHoldingsIndexEntry,
  emptyHoldingsIndex,
  readHoldingsIndex,
  writeHoldingsIndex,
  type FetchLike,
  type FetchLikeResponse,
} from './collect-witness.ts';
import type { PublisherRegister } from '../shared/publishers.ts';

// Collection tooling tests (issue #618 increment 5, with #619). Test names
// follow Subject_Scenario_Outcome. The network fetch is mocked throughout; the
// hashing, comparison and emission it composes are exercised for real, against a
// hash computed independently by Node's own crypto.

const KNOWN = Buffer.from('a copy of a published callsign list');
const KNOWN_SHA = crypto.createHash('sha256').update(KNOWN).digest('hex');
const OTHER = Buffer.from('a copy that differs by even one byte.');
const OTHER_SHA = crypto.createHash('sha256').update(OTHER).digest('hex');

// A minimal register: Ofcom owns two channels (ambiguous), WhatDoTheyKnow owns
// one. Only the fields the tool reads are populated.
function fixtureRegister(): PublisherRegister {
  return {
    schemaVersion: 1,
    publishers: [
      {
        id: 'ofcom', name: 'Ofcom', roles: ['originator'], url: 'https://www.ofcom.org.uk',
        channels: ['ofcom-open-data-page', 'ofcom-disclosure-log'],
        licenceBasis: 'ofcom-terms', licenceStatement: '', licenceCitations: [], authorityCeiling: 'Official',
      },
      {
        id: 'whatdotheyknow', name: 'WhatDoTheyKnow', roles: ['foi-aggregator'], url: 'https://www.whatdotheyknow.com',
        channels: ['wdtk'],
        licenceBasis: 'site-terms', licenceStatement: '', licenceCitations: [], authorityCeiling: 'FOI',
      },
    ],
  };
}

// A fetch double serving fixed bytes, headers and status - the real fetch is
// never touched by the suite.
function mockFetch(bytes: Buffer, opts: { status?: number; url?: string; headers?: Record<string, string> } = {}): FetchLike {
  const headers = opts.headers ?? {};
  // A fresh, non-shared ArrayBuffer copy of the bytes, so the double matches the
  // real Response.arrayBuffer() contract exactly.
  const body: ArrayBuffer = Uint8Array.from(bytes).buffer;
  const response: FetchLikeResponse = {
    status: opts.status ?? 200,
    url: opts.url ?? 'https://example.test/file.csv',
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    arrayBuffer: () => Promise.resolve(body),
  };
  return () => Promise.resolve(response);
}

describe('collect-witness — courtesy posture', { tags: ['unit'] }, () => {
  it('DefaultUserAgent_WhenNoContact_IdentifiesTheProjectWithoutMasquerading', () => {
    const ua = defaultUserAgent(undefined);
    expect(ua).toContain('amateur-callsigns-file-watch');
    expect(ua.toLowerCase()).not.toContain('mozilla');
  });

  it('DefaultUserAgent_WhenContactGiven_AppendsIt', () => {
    expect(defaultUserAgent('ops@example.test')).toContain('ops@example.test');
  });

  it('IsBlockingStatus_WhenBackoffSignal_IsTrue', () => {
    expect(isBlockingStatus(403)).toBe(true);
    expect(isBlockingStatus(429)).toBe(true);
    expect(isBlockingStatus(503)).toBe(true);
  });

  it('IsBlockingStatus_WhenNotHeldOrOk_IsFalse', () => {
    // A 404/410 is a "not held" ANSWER, not a block - it must not abort a run.
    expect(isBlockingStatus(404)).toBe(false);
    expect(isBlockingStatus(410)).toBe(false);
    expect(isBlockingStatus(200)).toBe(false);
  });
});

describe('collect-witness — original filename', { tags: ['unit'] }, () => {
  it('OriginalFilenameFromUrl_WhenPathHasSegment_ReturnsDecodedLastSegment', () => {
    expect(originalFilenameFromUrl('https://host.test/a/b/Call-Signs%20List.csv?v=1')).toBe('Call-Signs List.csv');
  });

  it('OriginalFilenameFromUrl_WhenBareHost_ReturnsUndefined', () => {
    expect(originalFilenameFromUrl('https://host.test/')).toBeUndefined();
  });

  it('OriginalFilenameFromContentDisposition_WhenExtendedForm_PrefersIt', () => {
    const name = originalFilenameFromContentDisposition("attachment; filename=\"fallback.csv\"; filename*=UTF-8''real%20name.csv");
    expect(name).toBe('real name.csv');
  });

  it('OriginalFilenameFromContentDisposition_WhenAbsent_ReturnsUndefined', () => {
    expect(originalFilenameFromContentDisposition(undefined)).toBeUndefined();
    expect(originalFilenameFromContentDisposition('inline')).toBeUndefined();
  });

  it('ResolveOriginalFilename_WhenHeaderPresent_WinsOverUrl', () => {
    expect(resolveOriginalFilename('https://host.test/from-url.csv', 'attachment; filename="from-header.csv"')).toBe('from-header.csv');
  });
});

describe('collect-witness — hashing', { tags: ['unit'] }, () => {
  it('Sha256OfBytes_MatchesAnIndependentHash', () => {
    expect(sha256OfBytes(KNOWN)).toBe(KNOWN_SHA);
  });
});

describe('collect-witness — channel resolution', { tags: ['unit'] }, () => {
  const register = fixtureRegister();

  it('ResolveWitnessChannel_WhenSingleChannelPublisher_ResolvesAutomatically', () => {
    expect(resolveWitnessChannel(register, 'whatdotheyknow')).toBe('wdtk');
  });

  it('ResolveWitnessChannel_WhenSeveralChannelsAndExplicitOwned_ReturnsIt', () => {
    expect(resolveWitnessChannel(register, 'ofcom', 'ofcom-disclosure-log')).toBe('ofcom-disclosure-log');
  });

  it('ResolveWitnessChannel_WhenSeveralChannelsAndNoneGiven_Throws', () => {
    expect(() => resolveWitnessChannel(register, 'ofcom')).toThrow(/several channels/i);
  });

  it('ResolveWitnessChannel_WhenChannelNotOwned_Throws', () => {
    expect(() => resolveWitnessChannel(register, 'whatdotheyknow', 'ukgwa')).toThrow(/not owned/i);
  });

  it('ResolveWitnessChannel_WhenPublisherUnknown_Throws', () => {
    expect(() => resolveWitnessChannel(register, 'nope')).toThrow(/not in the register/i);
  });
});

describe('collect-witness — fetch (mocked network)', { tags: ['unit'] }, () => {
  it('FetchResource_WhenOk_ReturnsBytesHashAndResolvedFilename', async () => {
    const resource = await fetchResource('https://host.test/dir/list.csv', {
      fetchImpl: mockFetch(KNOWN, { url: 'https://host.test/dir/list.csv' }),
    });
    expect(resource.sha256).toBe(KNOWN_SHA);
    expect(resource.bytes.equals(KNOWN)).toBe(true);
    expect(resource.originalFilename).toBe('list.csv');
    expect(resource.status).toBe(200);
  });

  it('FetchResource_WhenContentDispositionPresent_UsesItForFilename', async () => {
    const resource = await fetchResource('https://host.test/download?id=9', {
      fetchImpl: mockFetch(KNOWN, { headers: { 'content-disposition': 'attachment; filename="served-name.xlsx"' } }),
    });
    expect(resource.originalFilename).toBe('served-name.xlsx');
  });

  it('FetchResource_WhenBlockingStatus_ThrowsAndDoesNotRetry', async () => {
    let calls = 0;
    const counting: FetchLike = (url, init) => { calls++; return mockFetch(Buffer.alloc(0), { status: 429 })(url, init); };
    await expect(fetchResource('https://host.test/x', { fetchImpl: counting })).rejects.toThrow(/blocking status 429/i);
    expect(calls).toBe(1);
  });

  it('FetchResource_WhenNotHeld_ReturnsThe404AnswerWithoutThrowing', async () => {
    const resource = await fetchResource('https://host.test/gone', { fetchImpl: mockFetch(Buffer.alloc(0), { status: 404 }) });
    expect(resource.status).toBe(404);
    expect(resource.bytes.length).toBe(0);
  });
});

describe('collect-witness — agreement and emission', { tags: ['unit'] }, () => {
  const base = {
    heldFile: 'call-signs.csv',
    channel: 'wdtk',
    publisherId: 'whatdotheyknow',
    url: 'https://www.whatdotheyknow.com/request/x/response/y/attach/2/list.csv',
    fetchedAt: '2026-07-16',
    originalFilename: 'list.csv',
  };

  it('CollectionOutcome_WhenByteIdentical_EmitsCorroboratingWitnessOnly', () => {
    const outcome = collectionOutcome({ ...base, heldHashes: [KNOWN_SHA], sha256: KNOWN_SHA }, KNOWN.length);
    expect(outcome.agreement).toBe('corroborating');
    expect(outcome.divergence).toBeUndefined();
    expect(outcome.witness).toMatchObject({ channel: 'wdtk', sha256: KNOWN_SHA, originalFilename: 'list.csv', fetchedAt: '2026-07-16' });
  });

  it('CollectionOutcome_WhenDiffers_RetainsDivergentCopyAndStubsRecord', () => {
    const outcome = collectionOutcome({ ...base, heldHashes: [KNOWN_SHA], sha256: OTHER_SHA }, OTHER.length);
    expect(outcome.agreement).toBe('divergent');
    expect(outcome.divergence).toBeDefined();
    const div = outcome.divergence!;
    expect(div.fileName).toBe('divergent-copy--list.csv');
    expect(div.fileDeclaration).toMatchObject({ role: 'divergent-copy', divergesFrom: 'call-signs.csv', sha256: OTHER_SHA, bytes: OTHER.length });
    // The divergent witness rides on the retained copy, so once held it
    // corroborates that copy rather than dangling unpaired.
    expect(div.fileDeclaration.witnesses?.[0]?.sha256).toBe(OTHER_SHA);
    expect(div.record).toMatchObject({ file: 'call-signs.csv', level: 'bytes' });
    expect(div.record.counterpart).toMatchObject({ publisher: 'whatdotheyknow', sha256: OTHER_SHA, heldAs: 'divergent-copy--list.csv' });
    // The human-completion fields are honestly marked, never fabricated.
    expect(div.record.summary).toMatch(/TODO/);
  });

  it('DivergentCopyName_WhenNoOriginalFilename_FallsBackToHash', () => {
    expect(divergentCopyName(undefined, OTHER_SHA)).toBe(`divergent-copy--${OTHER_SHA.slice(0, 12)}.bin`);
  });
});

describe('collect-witness — local holdings index', { tags: ['unit'] }, () => {
  it('BuildHoldingsIndexEntry_RecordsHashProvenanceAndObtainFrom', () => {
    const entry = buildHoldingsIndexEntry({
      sha256: OTHER_SHA, bytes: OTHER.length, originalFilename: 'thing.pdf',
      publisher: 'oarc-wiki', obtainFrom: 'https://wiki.test/thing.pdf', fetchedAt: '2026-07-16',
      withheldReason: 'licence basis not yet cleared',
    });
    expect(entry).toMatchObject({ sha256: OTHER_SHA, publisher: 'oarc-wiki', obtainFrom: 'https://wiki.test/thing.pdf', withheldReason: 'licence basis not yet cleared' });
  });

  it('UpsertHoldingsIndexEntry_WhenSameHash_ReplacesRatherThanDuplicates', () => {
    const first = buildHoldingsIndexEntry({ sha256: OTHER_SHA, bytes: 1, publisher: 'p', obtainFrom: 'u', fetchedAt: '2026-07-16', withheldReason: 'r1' });
    const second = buildHoldingsIndexEntry({ sha256: OTHER_SHA, bytes: 1, publisher: 'p', obtainFrom: 'u', fetchedAt: '2026-07-17', withheldReason: 'r2' });
    let index = upsertHoldingsIndexEntry(emptyHoldingsIndex(), first);
    index = upsertHoldingsIndexEntry(index, second);
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].withheldReason).toBe('r2');
  });

  it('WriteHoldingsIndex_ThenRead_RoundTrips', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holdings-'));
    try {
      const indexPath = path.join(dir, 'index.json');
      const entry = buildHoldingsIndexEntry({ sha256: KNOWN_SHA, bytes: KNOWN.length, publisher: 'p', obtainFrom: 'u', fetchedAt: '2026-07-16', withheldReason: 'r' });
      writeHoldingsIndex(upsertHoldingsIndexEntry(emptyHoldingsIndex(), entry), indexPath);
      const read = readHoldingsIndex(indexPath);
      expect(read.entries).toHaveLength(1);
      expect(read.entries[0].sha256).toBe(KNOWN_SHA);
      expect(read.schemaVersion).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ReadHoldingsIndex_WhenAbsent_ReturnsEmpty', () => {
    expect(readHoldingsIndex(path.join(os.tmpdir(), 'does-not-exist-holdings.json')).entries).toEqual([]);
  });
});
