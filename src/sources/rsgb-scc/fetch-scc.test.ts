import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  fetchSccPage,
  assertNotChallengePage,
  runSccIntake,
  diffSccTables,
  readCommittedRows,
  summariseIntake,
  defaultUserAgent,
  buildConditionalRequestHeaders,
  type FetchLike,
  type FetchLikeResponse,
} from './fetch-scc.ts';
import { toCsv, toMetaJson, toMeta, parseSccTable, type SccRow, type SccMeta } from './parse-scc.ts';

// A fetch double returning a canned response. Mirrors the subset of Response the
// module reads (status, content-type/etag/last-modified headers, text body).
function fetchReturning(body: string, init: { status?: number; contentType?: string; etag?: string; lastModified?: string } = {}): FetchLike {
  const headerValues: Record<string, string | undefined> = {
    'content-type': init.contentType ?? 'text/html; charset=UTF-8',
    'etag': init.etag,
    'last-modified': init.lastModified,
  };
  return () => Promise.resolve({
    status: init.status ?? 200,
    headers: { get: (name: string) => headerValues[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(body),
  });
}

// A fetch double that records the request init it was called with, so a test
// can assert which conditional headers (if any) were actually sent.
function fetchCapturingRequests(response: FetchLikeResponse): { fetchImpl: FetchLike; requests: Array<Record<string, string>> } {
  const requests: Array<Record<string, string>> = [];
  const fetchImpl: FetchLike = (_url, init) => {
    requests.push(init.headers);
    return Promise.resolve(response);
  };
  return { fetchImpl, requests };
}

// The structural fixture (no RSGB prose; a hand-built stand-in for the page).
function fixture(dataRowsHtml: string, banner = '<p>Updated 15 June 2026</p>'): string {
  return `<!DOCTYPE html><html><body>${banner}
    <table border="1"><tbody>
      <tr><td><b>SPECIAL CONTEST CALL</b></td><td><b>LICENSEE OR CLUB CALL</b></td><td><b>STATUS</b></td></tr>
      ${dataRowsHtml}
    </tbody></table></body></html>`;
}

const TWO_GOOD_ROWS = `
  <tr><td>G0A</td><td>GW4SKA</td><td>Issued</td></tr>
  <tr><td>G0B</td><td><br /></td><td>Available</td></tr>
`;

const CHALLENGE_PAGE = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>Checking your browser before accessing.</body></html>';

describe('fetch diagnostics for the run artefact', { tags: ['unit'] }, () => {
  function tempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'scc-diag-'));
  }

  it('Diagnostics_OnSuccessfulFetch_RetainThePageBytesAndResponseHeaders', async () => {
    const dir = tempDir();
    const page = fixture(TWO_GOOD_ROWS);
    const withHeaders: FetchLike = () => Promise.resolve({
      status: 200,
      headers: { get: (name: string) => ({ 'content-type': 'text/html', 'etag': '"abc123"', 'last-modified': 'Sun, 15 Jun 2026 09:00:00 GMT', 'server': 'Apache/2.4.41 (Ubuntu)' }[name.toLowerCase()] ?? null) },
      text: () => Promise.resolve(page),
    });
    await fetchSccPage('https://example.test/scc', { fetchImpl: withHeaders, diagnosticsDir: dir });
    expect(fs.readFileSync(path.join(dir, 'page.shtml'), 'utf8')).toBe(page);
    const headers = JSON.parse(fs.readFileSync(path.join(dir, 'headers.json'), 'utf8')) as { status: number; url: string; headers: Record<string, string | null> };
    expect(headers.status).toBe(200);
    expect(headers.url).toBe('https://example.test/scc');
    expect(headers.headers['etag']).toBe('"abc123"');
    expect(headers.headers['last-modified']).toBe('Sun, 15 Jun 2026 09:00:00 GMT');
    expect(headers.headers['server']).toBe('Apache/2.4.41 (Ubuntu)');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('Diagnostics_WhenTheResponseIsRejected_StillRetainWhatTheFetcherSaw', async () => {
    // The rejected response is exactly the one worth inspecting later — the
    // diagnostics must be written BEFORE the status validation throws.
    const dir = tempDir();
    await expect(fetchSccPage('https://example.test/scc', { fetchImpl: fetchReturning('gateway error page', { status: 503 }), diagnosticsDir: dir })).rejects.toThrow(/status 503/);
    expect(fs.readFileSync(path.join(dir, 'page.shtml'), 'utf8')).toBe('gateway error page');
    expect((JSON.parse(fs.readFileSync(path.join(dir, 'headers.json'), 'utf8')) as { status: number }).status).toBe(503);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('Diagnostics_WhenNoDirIsConfigured_WriteNothing', async () => {
    // The local/manual path stays side-effect-free: no env, no files.
    await fetchSccPage('https://example.test/scc', { fetchImpl: fetchReturning(fixture(TWO_GOOD_ROWS)) });
    expect(fs.existsSync('.scc-diagnostics')).toBe(false);
  });
});

describe('fetchSccPage', { tags: ['unit'] }, () => {
  it('HonestUserAgent_WhenBuilt_NamesTheProjectAndSpoofsNoBrowser', () => {
    const ua = defaultUserAgent(undefined);
    expect(ua).toContain('amateur-callsigns-file-watch');
    expect(ua.toLowerCase()).not.toContain('mozilla');
  });

  it('Non200Status_WhenFetched_AbortsLoudly', async () => {
    await expect(fetchSccPage('https://example.test/scc', { fetchImpl: fetchReturning('body', { status: 503 }) })).rejects.toThrow(/status 503/);
  });

  it('UnexpectedContentType_WhenFetched_AbortsLoudly', async () => {
    await expect(fetchSccPage('https://example.test/scc', { fetchImpl: fetchReturning('{}', { contentType: 'application/json' }) })).rejects.toThrow(/content-type/);
  });

  it('ChallengePage_WhenFetched_AbortsAsARegressionSignal', async () => {
    await expect(fetchSccPage('https://example.test/scc', { fetchImpl: fetchReturning(CHALLENGE_PAGE) })).rejects.toThrow(/challenge/);
  });

  it('WellFormedHtml_WhenFetched_ReturnsTheBody', async () => {
    const body = fixture(TWO_GOOD_ROWS);
    const result = await fetchSccPage('https://example.test/scc', { fetchImpl: fetchReturning(body) });
    expect(result.status).toBe(200);
    expect(result.status === 200 && result.body).toBe(body);
  });
});

describe('fetchSccPage conditional requests', { tags: ['unit'] }, () => {
  it('ConditionalValidators_WhenProvided_SendIfNoneMatchAndIfModifiedSince', async () => {
    const { fetchImpl, requests } = fetchCapturingRequests({
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html' : null) },
      text: () => Promise.resolve(fixture(TWO_GOOD_ROWS)),
    });
    await fetchSccPage('https://example.test/scc', { fetchImpl, conditional: { etag: '"abc123"', lastModified: 'Sun, 15 Jun 2026 09:00:00 GMT' } });
    expect(requests).toHaveLength(1);
    expect(requests[0]['If-None-Match']).toBe('"abc123"');
    expect(requests[0]['If-Modified-Since']).toBe('Sun, 15 Jun 2026 09:00:00 GMT');
  });

  it('NoConditionalValidators_WhenOmitted_SendsNeitherConditionalHeader', async () => {
    const { fetchImpl, requests } = fetchCapturingRequests({
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html' : null) },
      text: () => Promise.resolve(fixture(TWO_GOOD_ROWS)),
    });
    await fetchSccPage('https://example.test/scc', { fetchImpl });
    expect(requests[0]).not.toHaveProperty('If-None-Match');
    expect(requests[0]).not.toHaveProperty('If-Modified-Since');
  });

  it('ServerReturns304_WhenFetched_ReportsNotModifiedWithoutABody', async () => {
    const result = await fetchSccPage('https://example.test/scc', { fetchImpl: fetchReturning('should never be read', { status: 304 }) });
    expect(result.status).toBe(304);
    expect((result as { body?: string }).body).toBeUndefined();
  });

  it('ServerReturns304_WhenDiagnosticsConfigured_WritesHeadersAloneAndMarksNoBody', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scc-304-diag-'));
    try {
      await fetchSccPage('https://example.test/scc', { fetchImpl: fetchReturning('should never be persisted', { status: 304 }), diagnosticsDir: dir });
      expect(fs.existsSync(path.join(dir, 'page.shtml'))).toBe(false);
      const headers = JSON.parse(fs.readFileSync(path.join(dir, 'headers.json'), 'utf8')) as { status: number; hasBody: boolean };
      expect(headers.status).toBe(304);
      expect(headers.hasBody).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

});

describe('buildConditionalRequestHeaders', { tags: ['unit'] }, () => {
  it('EtagAndLastModifiedPresent_WhenBuilt_CarriesBothValidators', () => {
    const meta = { sourceHeaders: { etag: '"abc"', lastModified: 'Sun, 15 Jun 2026 09:00:00 GMT' } };
    expect(buildConditionalRequestHeaders(meta)).toEqual({ etag: '"abc"', lastModified: 'Sun, 15 Jun 2026 09:00:00 GMT' });
  });

  it('OnlyEtagPresent_WhenBuilt_CarriesJustTheEtag', () => {
    expect(buildConditionalRequestHeaders({ sourceHeaders: { etag: '"abc"' } })).toEqual({ etag: '"abc"', lastModified: undefined });
  });

  it('NoSourceHeadersKey_WhenBuilt_ReturnsUndefined', () => {
    expect(buildConditionalRequestHeaders({ schemaVersion: 1 })).toBeUndefined();
  });

  it('MissingMeta_WhenBuilt_ReturnsUndefined', () => {
    expect(buildConditionalRequestHeaders(undefined)).toBeUndefined();
  });

  it('NonObjectMeta_WhenBuilt_ReturnsUndefinedRatherThanThrowing', () => {
    expect(buildConditionalRequestHeaders('not an object')).toBeUndefined();
    expect(buildConditionalRequestHeaders(null)).toBeUndefined();
  });

  it('MalformedSourceHeaders_WhenValuesAreTheWrongType_TreatsThemAsAbsent', () => {
    // Hand-edited or corrupted metadata should fall back to an unconditional
    // fetch, never crash the sweep and never send a nonsense validator.
    expect(buildConditionalRequestHeaders({ sourceHeaders: { etag: 12345, lastModified: null } })).toBeUndefined();
  });

  it('SourceHeadersIsNotAnObject_WhenBuilt_ReturnsUndefined', () => {
    expect(buildConditionalRequestHeaders({ sourceHeaders: 'garbage' })).toBeUndefined();
  });

  it('EmptySourceHeadersObject_WhenBuilt_ReturnsUndefined', () => {
    expect(buildConditionalRequestHeaders({ sourceHeaders: {} })).toBeUndefined();
  });
});

describe('assertNotChallengePage', { tags: ['unit'] }, () => {
  it('OrdinaryPage_WhenChecked_DoesNotThrow', () => {
    expect(() => assertNotChallengePage(fixture(TWO_GOOD_ROWS))).not.toThrow();
  });

  it('CloudflareInterstitial_WhenChecked_Throws', () => {
    expect(() => assertNotChallengePage(CHALLENGE_PAGE)).toThrow(/challenge/);
  });
});

describe('diffSccTables', { tags: ['unit'] }, () => {
  const row = (scc_code: string, base_callsign: string, status: string): SccRow => ({ scc_code, base_callsign, status, notes: '' });

  it('AddedWithdrawnAndReassignedCodes_WhenDiffed_AreEachReported', () => {
    const oldRows = [row('G0A', 'GW4SKA', 'Issued'), row('G0B', '', 'Available'), row('G0C', 'G0CER', 'Issued')];
    const newRows = [row('G0A', 'GW4SKA', 'Withdrawn'), row('G0C', 'G0CER', 'Issued'), row('G0D', '', 'Available')];
    const diff = diffSccTables(oldRows, newRows);
    expect(diff.added).toEqual(['G0D']);
    expect(diff.removed).toEqual(['G0B']);
    expect(diff.changed).toEqual(['G0A: status "Issued" -> "Withdrawn"']);
  });

  it('IdenticalTables_WhenDiffed_ReportNoChange', () => {
    const rows = [row('G0A', 'GW4SKA', 'Issued')];
    expect(diffSccTables(rows, rows)).toEqual({ added: [], removed: [], changed: [] });
  });

  it('FirstEverRun_WhenNoPriorTable_ReportsEveryCodeAsAdded', () => {
    const newRows = [row('G0A', 'GW4SKA', 'Issued'), row('G0B', '', 'Available')];
    expect(diffSccTables([], newRows).added).toEqual(['G0A', 'G0B']);
  });
});

describe('readCommittedRows', { tags: ['unit'] }, () => {
  it('CsvWithRemnantTrailingSpace_WhenRoundTripped_PreservesTheAttestedBytes', () => {
    const rows: SccRow[] = [{ scc_code: 'G3H', base_callsign: '', status: 'Available', notes: 'source-cell-remnant:status=Hoover GW3RDB ' }];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scc-roundtrip-'));
    try {
      const csvPath = path.join(dir, 'scc.csv');
      fs.writeFileSync(csvPath, toCsv(rows));
      expect(readCommittedRows(csvPath)).toEqual(rows);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('MissingFile_WhenRead_ReturnsEmpty', () => {
    expect(readCommittedRows(path.join(os.tmpdir(), 'definitely-absent-scc.csv'))).toEqual([]);
  });
});

describe('runSccIntake', { tags: ['unit'] }, () => {
  const sanity = { minRows: 1, maxRows: 100 };

  it('SanityGateFailure_WhenFetched_ThrowsAndLeavesTheTrackedFilesUntouched', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scc-gate-'));
    try {
      const csvPath = path.join(dir, 'scc.csv');
      const metaPath = path.join(dir, 'scc.meta.json');
      // A page whose status is outside the closed set trips the gate.
      const bad = fixture(`<tr><td>G0A</td><td>GW4SKA</td><td>Suspended</td></tr>`);
      await expect(runSccIntake({ fetchImpl: fetchReturning(bad), csvPath, metaPath, sanityOptions: sanity })).rejects.toThrow(/sanity gate failed/);
      expect(fs.existsSync(csvPath)).toBe(false);
      expect(fs.existsSync(metaPath)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('WellFormedPage_WhenRun_PromotesTheCsvAndMetaAtomically', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scc-write-'));
    try {
      const csvPath = path.join(dir, 'scc.csv');
      const metaPath = path.join(dir, 'scc.meta.json');
      const result = await runSccIntake({
        fetchImpl: fetchReturning(fixture(TWO_GOOD_ROWS)),
        csvPath,
        metaPath,
        sanityOptions: sanity,
        now: new Date('2026-07-17T00:00:00.000Z'),
      });
      expect(result.changed).toBe(true);
      expect(fs.readFileSync(csvPath, 'utf8')).toBe(result.csv);
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { rowCount: number; fetchedAt: string };
      expect(meta.rowCount).toBe(2);
      expect(meta.fetchedAt).toBe('2026-07-17T00:00:00.000Z');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('UnchangedPage_WhenReRun_ReportsNoChange', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scc-idem-'));
    try {
      const csvPath = path.join(dir, 'scc.csv');
      const metaPath = path.join(dir, 'scc.meta.json');
      const opts = { fetchImpl: fetchReturning(fixture(TWO_GOOD_ROWS)), csvPath, metaPath, sanityOptions: sanity };
      await runSccIntake(opts);
      const second = await runSccIntake(opts);
      expect(second.changed).toBe(false);
      expect(second.diff).toEqual({ added: [], removed: [], changed: [] });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('UnchangedPage_WhenReRun_LeavesBothTrackedFilesByteIdentical', async () => {
    // meta.json records the fetch that produced the COMMITTED table, not the
    // latest poll: a re-run over identical data must not churn fetchedAt (the
    // first production dispatch opened a no-op monthly PR exactly this way).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scc-nochurn-'));
    try {
      const csvPath = path.join(dir, 'scc.csv');
      const metaPath = path.join(dir, 'scc.meta.json');
      const page = fixture(TWO_GOOD_ROWS);
      await runSccIntake({ fetchImpl: fetchReturning(page), csvPath, metaPath, sanityOptions: sanity, now: new Date('2026-07-17T00:00:00.000Z') });
      const csvBefore = fs.readFileSync(csvPath, 'utf8');
      const metaBefore = fs.readFileSync(metaPath, 'utf8');
      await runSccIntake({ fetchImpl: fetchReturning(page), csvPath, metaPath, sanityOptions: sanity, now: new Date('2026-08-01T06:12:00.000Z') });
      expect(fs.readFileSync(csvPath, 'utf8')).toBe(csvBefore);
      expect(fs.readFileSync(metaPath, 'utf8')).toBe(metaBefore);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ChangedPage_WhenReRun_PromotesBothFilesWithTheNewFetchRecorded', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scc-change-'));
    try {
      const csvPath = path.join(dir, 'scc.csv');
      const metaPath = path.join(dir, 'scc.meta.json');
      await runSccIntake({ fetchImpl: fetchReturning(fixture(TWO_GOOD_ROWS)), csvPath, metaPath, sanityOptions: sanity, now: new Date('2026-07-17T00:00:00.000Z') });
      const changedRows = `${TWO_GOOD_ROWS}<tr><td>G0C</td><td>M0ABC</td><td>Issued</td></tr>`;
      const result = await runSccIntake({ fetchImpl: fetchReturning(fixture(changedRows)), csvPath, metaPath, sanityOptions: sanity, now: new Date('2026-08-01T06:12:00.000Z') });
      expect(result.changed).toBe(true);
      expect(result.diff.added).toEqual(['G0C']);
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { fetchedAt: string };
      expect(meta.fetchedAt).toBe('2026-08-01T06:12:00.000Z');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('DryRun_WhenRun_DoesNotWriteButStillReportsTheOutcome', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scc-dry-'));
    try {
      const csvPath = path.join(dir, 'scc.csv');
      const metaPath = path.join(dir, 'scc.meta.json');
      const result = await runSccIntake({ fetchImpl: fetchReturning(fixture(TWO_GOOD_ROWS)), csvPath, metaPath, sanityOptions: sanity, dryRun: true });
      expect(result.notModified).toBe(false);
      if (result.notModified) throw new Error('unreachable: a 200 response was fetched');
      expect(result.parsed.rows.length).toBe(2);
      expect(fs.existsSync(csvPath)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('IntakeSummary_WhenRendered_ListsTheFlaggedRows', async () => {
    const withAnomaly = fixture(`${TWO_GOOD_ROWS}<tr><td>G4Q</td><td><br /></td><td>Withdrawb<br /></td></tr>`);
    const result = await runSccIntake({ fetchImpl: fetchReturning(withAnomaly), sanityOptions: sanity, dryRun: true });
    const summary = summariseIntake(result);
    expect(summary).toContain('G4Q: status-typo');
    expect(summary).toContain('Withdrawb=1');
  });

  it('ResponseHeaders_WhenPresentOnTheProducingFetch_AreRecordedIntoTheCommittedMeta', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scc-headers-'));
    try {
      const csvPath = path.join(dir, 'scc.csv');
      const metaPath = path.join(dir, 'scc.meta.json');
      await runSccIntake({
        fetchImpl: fetchReturning(fixture(TWO_GOOD_ROWS), { etag: '"v1"', lastModified: 'Sun, 15 Jun 2026 09:00:00 GMT' }),
        csvPath, metaPath, sanityOptions: sanity, now: new Date('2026-07-17T00:00:00.000Z'),
      });
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as SccMeta;
      expect(meta.sourceHeaders).toEqual({ etag: '"v1"', lastModified: 'Sun, 15 Jun 2026 09:00:00 GMT' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ResponseWithNoValidators_WhenRecorded_OmitsSourceHeadersEntirely', async () => {
    // The real source (an .shtml page rendered via SSI) sends no ETag or
    // Last-Modified today; the field must be absent, not a set of nulls.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scc-noheaders-'));
    try {
      const csvPath = path.join(dir, 'scc.csv');
      const metaPath = path.join(dir, 'scc.meta.json');
      await runSccIntake({ fetchImpl: fetchReturning(fixture(TWO_GOOD_ROWS)), csvPath, metaPath, sanityOptions: sanity, now: new Date('2026-07-17T00:00:00.000Z') });
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as SccMeta;
      expect(meta.sourceHeaders).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('CommittedMetaCarriesValidators_WhenRePolled_SendsConditionalHeadersOnTheNextFetch', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scc-conditional-'));
    try {
      const csvPath = path.join(dir, 'scc.csv');
      const metaPath = path.join(dir, 'scc.meta.json');
      const page = fixture(TWO_GOOD_ROWS);
      await runSccIntake({
        fetchImpl: fetchReturning(page, { etag: '"v1"', lastModified: 'Sun, 15 Jun 2026 09:00:00 GMT' }),
        csvPath, metaPath, sanityOptions: sanity, now: new Date('2026-07-17T00:00:00.000Z'),
      });

      const { fetchImpl, requests } = fetchCapturingRequests({
        status: 200,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html' : null) },
        text: () => Promise.resolve(page),
      });
      await runSccIntake({ fetchImpl, csvPath, metaPath, sanityOptions: sanity, now: new Date('2026-08-01T00:00:00.000Z') });
      expect(requests[0]['If-None-Match']).toBe('"v1"');
      expect(requests[0]['If-Modified-Since']).toBe('Sun, 15 Jun 2026 09:00:00 GMT');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ServerConfirms304_WhenACommittedTableExists_ReportsProvablyUnchangedAndWritesNothing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scc-304-'));
    try {
      const csvPath = path.join(dir, 'scc.csv');
      const metaPath = path.join(dir, 'scc.meta.json');
      const page = fixture(TWO_GOOD_ROWS);
      await runSccIntake({ fetchImpl: fetchReturning(page, { etag: '"v1"' }), csvPath, metaPath, sanityOptions: sanity, now: new Date('2026-07-17T00:00:00.000Z') });
      const csvBefore = fs.readFileSync(csvPath, 'utf8');
      const metaBefore = fs.readFileSync(metaPath, 'utf8');

      const result = await runSccIntake({ fetchImpl: fetchReturning('', { status: 304 }), csvPath, metaPath, sanityOptions: sanity, now: new Date('2026-08-01T00:00:00.000Z') });

      expect(result.notModified).toBe(true);
      expect(result.changed).toBe(false);
      expect(fs.readFileSync(csvPath, 'utf8')).toBe(csvBefore);
      expect(fs.readFileSync(metaPath, 'utf8')).toBe(metaBefore);
      expect(summariseIntake(result)).toContain('304 Not Modified');
      expect(summariseIntake(result)).toContain('provably unchanged');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ServerReturns304_WhenNoCommittedTableExists_FailsLoudRatherThanReportingAFalseUnchanged', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scc-304-missing-'));
    try {
      const csvPath = path.join(dir, 'scc.csv');
      const metaPath = path.join(dir, 'scc.meta.json');
      await expect(runSccIntake({ fetchImpl: fetchReturning('', { status: 304 }), csvPath, metaPath, sanityOptions: sanity }))
        .rejects.toThrow(/304 Not Modified.*committed table/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('CommittedMetaPresentButCsvMissing_WhenPolled_DoesNotSendConditionalHeadersBlindly', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scc-orphan-meta-'));
    try {
      const csvPath = path.join(dir, 'scc.csv'); // deliberately never written
      const metaPath = path.join(dir, 'scc.meta.json');
      const parsed = parseSccTable(fixture(TWO_GOOD_ROWS));
      fs.writeFileSync(metaPath, toMetaJson(toMeta(parsed, { fetchedAt: '2026-07-01T00:00:00.000Z', headers: { etag: '"orphan"' } })));

      const { fetchImpl, requests } = fetchCapturingRequests({
        status: 200,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html' : null) },
        text: () => Promise.resolve(fixture(TWO_GOOD_ROWS)),
      });
      await runSccIntake({ fetchImpl, csvPath, metaPath, sanityOptions: sanity });
      expect(requests[0]).not.toHaveProperty('If-None-Match');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('MalformedSourceHeadersInCommittedMeta_WhenPolled_FallsBackToAnUnconditionalFetch', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scc-malformed-'));
    try {
      const csvPath = path.join(dir, 'scc.csv');
      const metaPath = path.join(dir, 'scc.meta.json');
      fs.writeFileSync(csvPath, toCsv(parseSccTable(fixture(TWO_GOOD_ROWS)).rows));
      fs.writeFileSync(metaPath, JSON.stringify({ schemaVersion: 2, sourceHeaders: { etag: 12345 } }));

      const { fetchImpl, requests } = fetchCapturingRequests({
        status: 200,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html' : null) },
        text: () => Promise.resolve(fixture(TWO_GOOD_ROWS)),
      });
      await runSccIntake({ fetchImpl, csvPath, metaPath, sanityOptions: sanity });
      expect(requests[0]).not.toHaveProperty('If-None-Match');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('CorruptJsonInCommittedMeta_WhenPolled_FallsBackToAnUnconditionalFetchRatherThanThrowing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scc-corrupt-'));
    try {
      const csvPath = path.join(dir, 'scc.csv');
      const metaPath = path.join(dir, 'scc.meta.json');
      fs.writeFileSync(csvPath, toCsv(parseSccTable(fixture(TWO_GOOD_ROWS)).rows));
      fs.writeFileSync(metaPath, '{ not valid json');

      const { fetchImpl, requests } = fetchCapturingRequests({
        status: 200,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html' : null) },
        text: () => Promise.resolve(fixture(TWO_GOOD_ROWS)),
      });
      const result = await runSccIntake({ fetchImpl, csvPath, metaPath, sanityOptions: sanity });
      expect(requests[0]).not.toHaveProperty('If-None-Match');
      expect(result.notModified).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
