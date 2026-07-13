// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateLedgerLength } from './ledger-query.js';

// The chunked claim-ledger open (issue #475) trusts a manifest length instead of
// HEADing the whole object (a HEAD of the large file on GitHub Pages is a ~30s
// compressed-variant CDN miss). This self-check confirms the declared length
// lands inside a real final chunk - a Range read of the last byte must return
// 206 - so a stale manifest or a truncated split fails LOUD rather than silently
// yielding a too-short (malformed) database.
describe('validateLedgerLength (issue #475 self-check)', () => {
  // databaseLengthBytes 100, serverChunkSize 40 → final byte is index 99, which
  // sits in chunk floor(99/40)=2 at offset 99%40=19.
  const manifest = { databaseLengthBytes: 100, serverChunkSize: 40, suffixLength: 3 };

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  it('Selfcheck_WhenFinalBytePresent_PassesAndRangeReadsTheLastChunk', async () => {
    const calls: { url: string; opts: { headers: { Range: string } } }[] = [];
    globalThis.fetch = vi.fn((url: string, opts: { headers: { Range: string } }) => {
      calls.push({ url, opts });
      return Promise.resolve({ status: 206 } as Response);
    }) as typeof fetch;

    const ok = await validateLedgerLength(manifest, 'https://host/db.', 'sha7');

    expect(ok).toBe(true);
    // Reads the last chunk (index 2, zero-padded to the suffix width), busted by
    // the deploy version, with a one-byte range at the final offset.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://host/db.002?cb=sha7');
    expect(calls[0].opts.headers.Range).toBe('bytes=19-19');
  });

  it('Selfcheck_WhenFinalByteMissing_FailsLoud', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ status: 416 } as Response)) as typeof fetch;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ok = await validateLedgerLength(manifest, 'https://host/db.', 'sha7');

    expect(ok).toBe(false);
    expect(err).toHaveBeenCalled();
  });

  it('Selfcheck_WhenRequestThrows_FailsLoudNotSilent', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('network'))) as typeof fetch;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ok = await validateLedgerLength(manifest, 'https://host/db.', 'sha7');

    expect(ok).toBe(false);
    expect(err).toHaveBeenCalled();
  });
});
