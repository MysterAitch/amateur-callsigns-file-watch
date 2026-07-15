import { describe, it, expect } from 'vitest';
import { ledgerWarmupTargets, type LedgerChunkManifest } from './ledger-warmup.ts';

// The warm-up (issue #537) primes the CDN edge for a cold ledger open's first
// reads before the post-deploy settle assertion, so the assertion measures a
// warm open rather than the one-off cold deploy (the #475 cold-open latency).
// ledgerWarmupTargets decides WHICH chunk byte-ranges to prime from the served
// manifest; these tests pin that decision without touching the network.
describe('ledgerWarmupTargets (issue #537 CDN warm-up)', () => {
  // A production-scale manifest: 90 MiB chunks over a multi-GB database, matching
  // the deploy's serverChunkSize (see .github/workflows/cicd.yaml).
  const serverChunkSize = 94_371_840;
  const largeManifest: LedgerChunkManifest = {
    databaseLengthBytes: serverChunkSize * 16 + 1_000, // 16 full chunks + a short final one
    serverChunkSize,
    suffixLength: 3,
  };
  const options = { maxChunks: 2, requestChunkSize: 4096 };

  it('WarmupTargets_ForLargeDatabase_PrimesLeadingChunksWithMatchingCacheBust', () => {
    const targets = ledgerWarmupTargets(largeManifest, 'https://host/data/claim-ledger.sqlite.png.', 'sha7', options);

    // Primes the first two chunks - the header, schema root and first btree pages
    // live at the start of chunk 000; chunk 001 covers a small overspill.
    expect(targets).toEqual([
      { url: 'https://host/data/claim-ledger.sqlite.png.000?cb=sha7', rangeHeader: 'bytes=0-4095' },
      { url: 'https://host/data/claim-ledger.sqlite.png.001?cb=sha7', rangeHeader: 'bytes=0-4095' },
    ]);
  });

  it('WarmupTargets_UrlAndCacheBust_MatchTheBrowsersChunkRequest', () => {
    // The priming URL must equal the browser's exactly (path + ?cb=<version>) or
    // it warms a different CDN cache object. The version is URL-encoded, mirroring
    // validateLedgerLength in site/ledger-query.js.
    const [first] = ledgerWarmupTargets(largeManifest, 'https://host/data/claim-ledger.sqlite.png.', 'a b/c', options);
    expect(first.url).toBe('https://host/data/claim-ledger.sqlite.png.000?cb=a%20b%2Fc');
  });

  it('WarmupTargets_WhenFewerChunksThanMax_PrimesOnlyTheChunksThatExist', () => {
    // A small (e.g. dev/test) database with a single chunk primes just that one.
    const oneChunk: LedgerChunkManifest = { databaseLengthBytes: 10_000, serverChunkSize: 40_000, suffixLength: 3 };
    const targets = ledgerWarmupTargets(oneChunk, 'https://host/db.', 'v1', options);
    expect(targets).toEqual([
      { url: 'https://host/db.000?cb=v1', rangeHeader: 'bytes=0-4095' },
    ]);
  });

  it('WarmupTargets_WhenChunkShorterThanRequestSize_ClampsRangeToTheChunkLength', () => {
    // A tiny chunk shorter than requestChunkSize must not be over-read: the range
    // clamps to the chunk's own final byte.
    const tiny: LedgerChunkManifest = { databaseLengthBytes: 500, serverChunkSize: 500, suffixLength: 3 };
    const targets = ledgerWarmupTargets(tiny, 'https://host/db.', 'v1', options);
    expect(targets).toEqual([
      { url: 'https://host/db.000?cb=v1', rangeHeader: 'bytes=0-499' },
    ]);
  });

  it('WarmupTargets_WhenManifestNonPositiveOrMalformed_YieldsNoTargets', () => {
    expect(ledgerWarmupTargets({ databaseLengthBytes: 0, serverChunkSize: 40, suffixLength: 3 }, 'p.', 'v', options)).toEqual([]);
    expect(ledgerWarmupTargets({ databaseLengthBytes: 100, serverChunkSize: 0, suffixLength: 3 }, 'p.', 'v', options)).toEqual([]);
    expect(ledgerWarmupTargets(largeManifest, 'p.', 'v', { maxChunks: 0, requestChunkSize: 4096 })).toEqual([]);
    expect(ledgerWarmupTargets({ databaseLengthBytes: Number.NaN, serverChunkSize: 40, suffixLength: 3 }, 'p.', 'v', options)).toEqual([]);
  });
});
