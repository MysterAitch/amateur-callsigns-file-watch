import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { JSDOM } from 'jsdom';
import {
  decideVersionCheckPath,
  extractVersionParam,
  verifyAmateurCsv,
  downloadFile,
  findCsvLink,
} from './scrape.ts';
import type { ScrapeOptions } from '../../shared/utils.ts';

describe('extractVersionParam', { tags: ['unit'] }, () => {
  it('ExtractV_WhenTypicalOfcomUrl_ReturnsVValue', () => {
    const url = 'https://www.ofcom.org.uk/siteassets/resources/documents/manage-your-licence/amateur/amateur-callsign-list.csv?v=419818';
    expect(extractVersionParam(url)).toBe('419818');
  });

  it('ExtractV_WhenUrlHasMultipleQueryParams_ReturnsVValueOnly', () => {
    expect(extractVersionParam('https://example.com/x.csv?foo=bar&v=abc123&baz=quux')).toBe('abc123');
    expect(extractVersionParam('https://example.com/x.csv?v=abc123&other=stuff')).toBe('abc123');
  });

  it('ExtractV_WhenUrlHasNoVParam_ReturnsUndefined', () => {
    expect(extractVersionParam('https://example.com/x.csv')).toBeUndefined();
    expect(extractVersionParam('https://example.com/x.csv?other=thing')).toBeUndefined();
  });

  it('ExtractV_WhenUrlUndefined_ReturnsUndefined', () => {
    expect(extractVersionParam(undefined)).toBeUndefined();
  });
});

describe('decideVersionCheckPath', { tags: ['unit'] }, () => {
  const NOW = new Date('2026-07-05T12:00:00Z');

  describe('no prior state', () => {
    it('DecideVersion_WhenNoStateFields_ReturnsDownloadNew', () => {
      expect(decideVersionCheckPath('419818', undefined, NOW)).toBe('download-new');
      expect(decideVersionCheckPath('419818', {}, NOW)).toBe('download-new');
    });

    it('DecideVersion_WhenPartialState_ReturnsDownloadNew', () => {
      // All three lastKnown fields must be set for the fast-path to be trusted.
      const partial: ScrapeOptions = { lastKnownV: '419818' };
      expect(decideVersionCheckPath('419818', partial, NOW)).toBe('download-new');
    });
  });

  describe('v matches state', () => {
    const freshState: ScrapeOptions = {
      lastKnownV: '419818',
      lastKnownVContentHash: 'abc123',
      lastKnownVVerifiedAt: '2026-07-04T12:00:00Z', // 1 day ago
    };

    it('DecideVersion_WhenVMatchesAndRecentlyVerified_ReturnsSkipFastPath', () => {
      expect(decideVersionCheckPath('419818', freshState, NOW)).toBe('skip-fast-path');
    });

    it('DecideVersion_WhenVMatchesAndVerificationOlderThanInterval_ReturnsDownloadAndVerify', () => {
      const staleState: ScrapeOptions = {
        ...freshState,
        lastKnownVVerifiedAt: '2026-06-27T12:00:00Z', // 8 days ago, past default 7-day interval
      };
      expect(decideVersionCheckPath('419818', staleState, NOW)).toBe('download-and-verify');
    });

    it('DecideVersion_WhenVMatchesAndVerificationExactlyAtInterval_ReturnsDownloadAndVerify', () => {
      // Boundary: >= intervalDays should trigger verification.
      const boundaryState: ScrapeOptions = {
        ...freshState,
        lastKnownVVerifiedAt: '2026-06-28T12:00:00Z', // exactly 7 days
      };
      expect(decideVersionCheckPath('419818', boundaryState, NOW)).toBe('download-and-verify');
    });

    it('DecideVersion_WhenCustomIntervalSet_HonoursIt', () => {
      // 3-day interval should treat 4-day-old verification as stale.
      const state: ScrapeOptions = {
        ...freshState,
        lastKnownVVerifiedAt: '2026-07-01T12:00:00Z', // 4 days ago
        verificationIntervalDays: 3,
      };
      expect(decideVersionCheckPath('419818', state, NOW)).toBe('download-and-verify');
    });

    it('DecideVersion_WhenIntervalZero_AlwaysVerifies', () => {
      // A 0-day interval means "always verify" - useful for testing / paranoid mode.
      const state: ScrapeOptions = {
        ...freshState,
        lastKnownVVerifiedAt: NOW.toISOString(), // just verified
        verificationIntervalDays: 0,
      };
      expect(decideVersionCheckPath('419818', state, NOW)).toBe('download-and-verify');
    });
  });

  describe('v differs from state', () => {
    const state: ScrapeOptions = {
      lastKnownV: '419818',
      lastKnownVContentHash: 'abc123',
      lastKnownVVerifiedAt: '2026-07-04T12:00:00Z',
    };

    it('DecideVersion_WhenObservedVDiffersFromState_ReturnsDownloadNew', () => {
      expect(decideVersionCheckPath('419819', state, NOW)).toBe('download-new');
    });

    it('DecideVersion_WhenObservedVMissing_ReturnsDownloadNew', () => {
      // We can't fast-path if we don't know what v the current page is on.
      expect(decideVersionCheckPath(undefined, state, NOW)).toBe('download-new');
    });
  });
});

// --- Intake resource caps (issue #969) ---------------------------------

const scratchDirs: string[] = [];
function scratchFile(name: string, contents: Buffer | string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrape-cap-'));
  scratchDirs.push(dir);
  const p = path.join(dir, name);
  fs.writeFileSync(p, contents);
  return p;
}

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('findCsvLink selector scoping', { tags: ['unit'] }, () => {
  // Ofcom files BOTH the amateur callsign CSV and the Business Radio Light
  // CSV under the same /amateur/ path prefix, so these tests pin the trap:
  // the selector must never regress to a bare path-substring match (issue
  // #977; the CSV-selector pitfall).
  const AMATEUR_LINK =
    '<a href="/siteassets/resources/documents/manage-your-licence/amateur/amateur-callsign-list.csv?v=123">Amateur radio call signs</a>';
  const BUSINESS_RADIO_LINK =
    '<a href="/siteassets/resources/documents/manage-your-licence/amateur/live-br-light-licences.csv?v=456">Business Radio Light licences</a>';

  function documentWith(linksHtml: string): Document {
    return new JSDOM(`<!DOCTYPE html><html><body>${linksHtml}</body></html>`).window.document;
  }

  it('FindCsvLink_WhenBusinessRadioCsvSharesTheAmateurPathPrefix_SelectsTheAmateurCallsignListOnly', () => {
    const link = findCsvLink(documentWith(`${BUSINESS_RADIO_LINK}${AMATEUR_LINK}`));
    expect(link.href).toContain('amateur-callsign-list.csv');
    expect(link.href).not.toContain('br-light');
  });

  it('FindCsvLink_WhenOnlyTheBusinessRadioCsvIsPresent_ThrowsRatherThanGrabbingANeighbour', () => {
    expect(() => findCsvLink(documentWith(BUSINESS_RADIO_LINK)))
      .toThrow(/No amateur callsign CSV link found/);
  });

  it('FindCsvLink_WhenNoCsvLinksArePresent_ThrowsRatherThanGuessing', () => {
    expect(() => findCsvLink(documentWith('<a href="/somewhere/else.pdf">A PDF</a>')))
      .toThrow(/No amateur callsign CSV link found/);
  });

  it('FindCsvLink_WhenTwoAmateurCandidateLinksArePresent_ThrowsRatherThanGuessing', () => {
    const second =
      '<a href="/siteassets/resources/documents/manage-your-licence/amateur/amateur-callsign-list-old.csv">Amateur radio call signs (archive)</a>';
    expect(() => findCsvLink(documentWith(`${AMATEUR_LINK}${second}`)))
      .toThrow(/expected exactly one/);
  });

  it('FindCsvLink_WhenFilenameMatchesButLinkTextDoesNot_IsRejectedAsAPartialMatch', () => {
    // Positive identification requires BOTH signals; filename alone (e.g. a
    // renamed or repurposed page label) is a near-miss to diagnose, not a
    // match to accept.
    const partial =
      '<a href="/siteassets/resources/documents/manage-your-licence/amateur/amateur-callsign-list.csv">Some other dataset</a>';
    expect(() => findCsvLink(documentWith(partial)))
      .toThrow(/No amateur callsign CSV link found/);
  });
});

describe('verifyAmateurCsv size window', { tags: ['unit'] }, () => {
  const HEADER = 'callsign,status,other\n';

  it('VerifyAmateurCsv_WhenFileBelowMinimum_Throws', () => {
    const p = scratchFile('tiny.csv', HEADER); // a few bytes, well under the 100 KB floor
    expect(() => verifyAmateurCsv(p)).toThrow(/suspiciously small/);
  });

  it('VerifyAmateurCsv_WhenFileAboveMaximum_Throws', () => {
    // A valid header but a body far larger than the amateur CSV should ever be.
    const body = HEADER + 'G0ABC,Issued,x\n'.repeat(200);
    const p = scratchFile('huge.csv', body);
    expect(() => verifyAmateurCsv(p, { minBytes: 10, maxBytes: 50 })).toThrow(/suspiciously large/);
  });

  it('VerifyAmateurCsv_WhenHeaderAndSizeAreValid_DoesNotThrow', () => {
    const p = scratchFile('ok.csv', HEADER + 'G0ABC,Issued,x\n');
    expect(() => verifyAmateurCsv(p, { minBytes: 10, maxBytes: 100_000 })).not.toThrow();
  });

  it('VerifyAmateurCsv_WhenHeaderMissingExpectedColumns_Throws', () => {
    const p = scratchFile('wrong.csv', 'foo,bar,baz\n1,2,3\n');
    expect(() => verifyAmateurCsv(p, { minBytes: 1, maxBytes: 100_000 })).toThrow(/missing expected column/);
  });
});

describe('downloadFile streamed-byte cap', { tags: ['unit'] }, () => {
  function startServer(handler: http.RequestListener): Promise<{ url: string; close: () => Promise<void> }> {
    return new Promise((resolve) => {
      const server = http.createServer(handler);
      server.on('clientError', () => { /* client aborts on cap: expected, ignore */ });
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address !== null ? address.port : 0;
        resolve({
          url: `http://127.0.0.1:${port}/`,
          close: () => new Promise<void>((r) => server.close(() => r())),
        });
      });
    });
  }

  it('DownloadFile_WhenBodyExceedsCap_RejectsAndDoesNotKeepGrowing', async () => {
    // A chunked response (no Content-Length) far larger than the cap: the
    // streamed-byte counter must abort the download.
    const { url, close } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/csv' });
      const chunk = Buffer.alloc(16 * 1024, 0x41);
      let sent = 0;
      const pump = (): void => {
        if (sent >= 512 * 1024 || res.writableEnded) { res.end(); return; }
        res.write(chunk);
        sent += chunk.length;
        setImmediate(pump);
      };
      res.on('close', () => { sent = Infinity; });
      pump();
    });
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scrape-dl-')), 'body.bin');
    scratchDirs.push(path.dirname(out));
    try {
      await expect(downloadFile(url, out, 4 * 1024)).rejects.toThrow();
    } finally {
      await close();
    }
  });

  it('DownloadFile_WhenBodyWithinCap_ResolvesAndWritesFile', async () => {
    const payload = 'callsign,status\nG0ABC,Issued\n';
    const { url, close } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/csv' });
      res.end(payload);
    });
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scrape-dl-')), 'ok.csv');
    scratchDirs.push(path.dirname(out));
    try {
      await downloadFile(url, out, 1024 * 1024);
      expect(fs.readFileSync(out, 'utf8')).toBe(payload);
    } finally {
      await close();
    }
  });
});
