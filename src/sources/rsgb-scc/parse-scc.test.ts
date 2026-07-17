import { describe, it, expect } from 'vitest';
import {
  classifyStatus,
  parseUpdatedBanner,
  parseSccTable,
  sanityGateProblems,
  toCsv,
  toMeta,
  toMetaJson,
  CANONICAL_STATUSES,
  SCC_CSV_HEADER,
} from './parse-scc.ts';

// A project-authored fixture reproducing the STRUCTURE of the source page — the
// three-column data table, the "Updated" banner, hidden x:str remnants, and the
// two known status anomalies — without reproducing any of the source's own
// RSGB-authored prose or its real data (the real page is deliberately NOT
// committed; this is a hand-built stand-in). Decoy tables surround the data table
// to exercise table selection.
function buildFixture(dataRowsHtml: string, opts: { banner?: string } = {}): string {
  const banner = opts.banner ?? '<p>Updated 15 June 2026</p>';
  return `<!DOCTYPE html><html><head><title>Fixture</title></head><body>
    <p>Project-authored placeholder prose standing in for the page's narrative.</p>
    ${banner}
    <table border="0"><tbody>
      <tr><td>An unrelated layout table</td><td>with its own header</td></tr>
    </tbody></table>
    <table border="1"><tbody>
      <tr><td><b>SPECIAL CONTEST CALL</b></td><td><b>LICENSEE OR CLUB CALL</b></td><td><b>STATUS</b></td></tr>
      ${dataRowsHtml}
    </tbody></table>
    <table align="center"><tbody>
      <tr><td>Footer table</td></tr>
    </tbody></table>
  </body></html>`;
}

const ORDINARY_ROWS = `
  <tr><td>G0A</td><td>GW4SKA</td><td>Issued</td></tr>
  <tr><td>G0B</td><td>M0BUL<br /></td><td>Issued<br /></td></tr>
  <tr><td>G0E</td><td><br /></td><td>Available</td></tr>
  <tr><td>G0D</td><td><br /></td><td>Withdrawn</td></tr>
`;

// The two known status anomalies and the three hidden-remnant shapes seen on the
// real page, transcribed structurally into the fixture.
const ANOMALY_ROWS = `
  <tr><td>G3H</td><td><br /></td><td x:str="Hoover GW3RDB ">Available </td></tr>
  <tr><td>G3J</td><td><br /></td><td>withdrawn<br /></td></tr>
  <tr><td style="height: 12.75pt;" x:str="G3Z " height="17">G3Z </td><td>G3ZME</td><td>Issued</td></tr>
  <tr><td>G4Q</td><td><br /></td><td>Withdrawb<br /></td></tr>
`;

describe('classifyStatus', { tags: ['unit'] }, () => {
  it('CanonicalStatus_WhenExactSpellingAndCasing_ClassifiesWithNoFlag', () => {
    for (const status of CANONICAL_STATUSES) {
      const result = classifyStatus(status);
      expect(result.canonical).toBe(status);
      expect(result.flags).toEqual([]);
      expect(result.unrecognised).toBe(false);
    }
  });

  it('LowercaseWithdrawn_WhenClassified_IsCarriedAsWithdrawnAndFlaggedNoncanonicalCase', () => {
    const result = classifyStatus('withdrawn');
    expect(result.canonical).toBe('Withdrawn');
    expect(result.flags).toEqual(['status-noncanonical-case']);
    expect(result.unrecognised).toBe(false);
  });

  it('KnownTypoWithdrawb_WhenClassified_IsCarriedAsWithdrawnAndFlaggedTypo', () => {
    const result = classifyStatus('Withdrawb');
    expect(result.canonical).toBe('Withdrawn');
    expect(result.flags).toEqual(['status-typo']);
    expect(result.unrecognised).toBe(false);
  });

  it('UnknownStatus_WhenClassified_IsMarkedUnrecognisedForFailLoud', () => {
    const result = classifyStatus('Pending');
    expect(result.canonical).toBeUndefined();
    expect(result.unrecognised).toBe(true);
    expect(result.flags).toEqual(['status-unrecognised']);
  });
});

describe('parseUpdatedBanner', { tags: ['unit'] }, () => {
  it('UpdatedBanner_WhenWellFormed_ParsesToIsoDate', () => {
    const banner = parseUpdatedBanner('Some text ... Updated 15 June 2026 ... more text');
    expect(banner).toEqual({ text: 'Updated 15 June 2026', iso: '2026-06-15' });
  });

  it('UpdatedBanner_WhenAbsent_ReturnsUndefined', () => {
    expect(parseUpdatedBanner('a page with no currency stamp')).toBeUndefined();
  });

  it('UpdatedBanner_WhenMonthNameInvalid_ReturnsUndefined', () => {
    expect(parseUpdatedBanner('Updated 15 Smarch 2026')).toBeUndefined();
  });
});

describe('parseSccTable', { tags: ['unit'] }, () => {
  it('DataTable_WhenParsed_ExtractsEveryRowAndTheUpdatedBanner', () => {
    const parsed = parseSccTable(buildFixture(ORDINARY_ROWS));
    expect(parsed.problems).toEqual([]);
    expect(parsed.updated).toEqual({ text: 'Updated 15 June 2026', iso: '2026-06-15' });
    expect(parsed.rows.length).toBe(4);
    // Sorted by SCC code, blank base callsigns preserved as empty.
    expect(parsed.rows.map((r) => r.scc_code)).toEqual(['G0A', 'G0B', 'G0D', 'G0E']);
    expect(parsed.rows.find((r) => r.scc_code === 'G0E')).toMatchObject({ base_callsign: '', status: 'Available' });
  });

  it('StatusAnomalies_WhenParsed_AreCarriedVerbatimAndFlaggedNotCorrected', () => {
    const parsed = parseSccTable(buildFixture(ANOMALY_ROWS));
    expect(parsed.problems).toEqual([]);
    const g3j = parsed.rows.find((r) => r.scc_code === 'G3J');
    const g4q = parsed.rows.find((r) => r.scc_code === 'G4Q');
    // Raw tokens carried EXACTLY as published — not rewritten to "Withdrawn".
    expect(g3j).toMatchObject({ status: 'withdrawn', notes: 'status-noncanonical-case' });
    expect(g4q).toMatchObject({ status: 'Withdrawb', notes: 'status-typo' });
    // The distribution tallies the raw tokens, so the anomalies stay visible.
    expect(parsed.statusCounts).toMatchObject({ withdrawn: 1, Withdrawb: 1 });
  });

  it('HiddenXStrRemnants_WhenParsed_AreCapturedVerbatimIntoNotesNotDiscarded', () => {
    const parsed = parseSccTable(buildFixture(ANOMALY_ROWS));
    const g3h = parsed.rows.find((r) => r.scc_code === 'G3H');
    const g3z = parsed.rows.find((r) => r.scc_code === 'G3Z');
    // The remnant is captured with its column and its exact bytes (trailing space).
    expect(g3h?.notes).toBe('source-cell-remnant:status=Hoover GW3RDB ');
    expect(g3z?.notes).toBe('source-cell-remnant:scc_code=G3Z ');
    // The VISIBLE status is still the trimmed canonical token.
    expect(g3h?.status).toBe('Available');
  });

  it('BlankSpacerRow_WhenPresent_IsSkippedRatherThanTreatedAsData', () => {
    const parsed = parseSccTable(buildFixture(`${ORDINARY_ROWS}<tr><td><br /></td><td><br /></td><td><br /></td></tr>`));
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows.length).toBe(4);
  });

  it('RowWithWrongCellCount_WhenParsed_IsFlaggedAsShapeDrift', () => {
    const parsed = parseSccTable(buildFixture(`${ORDINARY_ROWS}<tr><td>G9Z</td><td>Issued</td></tr>`));
    expect(parsed.problems.some((p) => p.includes('shape drift'))).toBe(true);
  });

  it('UnknownStatusValue_WhenParsed_IsRecordedAsAProblemForFailLoud', () => {
    const parsed = parseSccTable(buildFixture(`<tr><td>G0A</td><td>GW4SKA</td><td>Pending</td></tr>`));
    expect(parsed.problems.some((p) => p.includes('outside the closed vocabulary'))).toBe(true);
    // Still carried, so nothing is silently dropped.
    expect(parsed.rows.find((r) => r.scc_code === 'G0A')?.status).toBe('Pending');
  });

  it('DuplicateSccCode_WhenParsed_IsFlaggedAsAProblem', () => {
    const parsed = parseSccTable(buildFixture(`<tr><td>G0A</td><td>X</td><td>Issued</td></tr><tr><td>G0A</td><td>Y</td><td>Available</td></tr>`));
    expect(parsed.problems.some((p) => p.includes('duplicate SCC code'))).toBe(true);
  });

  it('PageWithoutTheSccHeaderRow_WhenParsed_IsFlaggedRatherThanMisparsed', () => {
    const html = '<!DOCTYPE html><html><body><p>Updated 15 June 2026</p><table><tr><td>a</td><td>b</td><td>c</td></tr></table></body></html>';
    const parsed = parseSccTable(html);
    expect(parsed.problems.some((p) => p.includes('no table on the page carries the expected SCC header'))).toBe(true);
    expect(parsed.rows).toEqual([]);
  });
});

describe('sanityGateProblems', { tags: ['unit'] }, () => {
  it('WellFormedTable_WhenGated_PassesWithNoProblems', () => {
    const parsed = parseSccTable(buildFixture(ORDINARY_ROWS));
    expect(sanityGateProblems(parsed, { minRows: 1, maxRows: 100 })).toEqual([]);
  });

  it('RowCountBelowBand_WhenGated_IsRejectedAsPageRedesignOrScrapeError', () => {
    const parsed = parseSccTable(buildFixture(ORDINARY_ROWS));
    const problems = sanityGateProblems(parsed, { minRows: 400, maxRows: 600 });
    expect(problems.some((p) => p.includes('outside the accepted band'))).toBe(true);
  });

  it('MissingUpdatedBanner_WhenGated_IsRejected', () => {
    const parsed = parseSccTable(buildFixture(ORDINARY_ROWS, { banner: '' }));
    const problems = sanityGateProblems(parsed, { minRows: 1, maxRows: 100 });
    expect(problems.some((p) => p.includes('Updated'))).toBe(true);
  });

  it('UnknownStatus_WhenGated_SurfacesAsAProblem', () => {
    const parsed = parseSccTable(buildFixture(`<tr><td>G0A</td><td>GW4SKA</td><td>Suspended</td></tr>`));
    const problems = sanityGateProblems(parsed, { minRows: 1, maxRows: 100 });
    expect(problems.some((p) => p.includes('outside the closed vocabulary'))).toBe(true);
  });
});

describe('toCsv and toMeta', { tags: ['unit'] }, () => {
  it('Csv_WhenBuilt_CarriesTheHeaderAndIsByteDeterministic', () => {
    const parsed = parseSccTable(buildFixture(ANOMALY_ROWS));
    const csv = toCsv(parsed.rows);
    expect(csv.split('\n')[0]).toBe(SCC_CSV_HEADER.join(','));
    // The remnant's exact bytes (trailing space) survive into the serialised CSV.
    expect(csv).toContain('G3H,,Available,source-cell-remnant:status=Hoover GW3RDB \n');
    // Byte-determinism: the same rows serialise identically every time.
    expect(toCsv(parsed.rows)).toBe(csv);
  });

  it('Meta_WhenBuilt_RecordsProvenanceAndAShapeSummaryMatchingTheRows', () => {
    const parsed = parseSccTable(buildFixture(ANOMALY_ROWS));
    const meta = toMeta(parsed, { fetchedAt: '2026-07-17T00:00:00.000Z' });
    expect(meta.source.url).toBe('https://www.rsgbcc.org/hf/information/scc.shtml');
    expect(meta.upstreamUpdated).toEqual({ text: 'Updated 15 June 2026', iso: '2026-06-15' });
    expect(meta.rowCount).toBe(parsed.rows.length);
    // The serialised metadata ends in a single trailing newline (byte-determinism).
    expect(toMetaJson(meta).endsWith('}\n')).toBe(true);
  });

  it('Meta_WhenBannerMissing_RefusesToBuildRatherThanInventCurrency', () => {
    const parsed = parseSccTable(buildFixture(ORDINARY_ROWS, { banner: '' }));
    expect(() => toMeta(parsed, { fetchedAt: '2026-07-17T00:00:00.000Z' })).toThrow(/banner/);
  });
});
