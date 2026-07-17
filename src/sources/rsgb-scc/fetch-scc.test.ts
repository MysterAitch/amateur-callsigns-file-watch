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
  type FetchLike,
} from './fetch-scc.ts';
import { toCsv, type SccRow } from './parse-scc.ts';

// A fetch double returning a canned response. Mirrors the subset of Response the
// module reads (status, content-type header, text body).
function fetchReturning(body: string, init: { status?: number; contentType?: string } = {}): FetchLike {
  return () => Promise.resolve({
    status: init.status ?? 200,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? (init.contentType ?? 'text/html; charset=UTF-8') : null) },
    text: () => Promise.resolve(body),
  });
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
    await expect(fetchSccPage('https://example.test/scc', { fetchImpl: fetchReturning(body) })).resolves.toBe(body);
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
});
