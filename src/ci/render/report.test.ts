import { describe, it, expect } from 'vitest';
import { reportIssueUrl, reportIssueBody, reportAffordance, type ReportContext } from './report.ts';
import { REPO_URL } from './html.ts';

// The shared "report this" affordance (issue #439): the calm, JavaScript-free
// link that turns a reader's doubt into a pre-filled GitHub issue located to
// its exact hop. These pin the affordance's contract: a locatable pre-filled
// URL, non-accusatory framing, correct URL-encoding of awkward subjects, a
// bound on the URL length for long dataset keys, and an honest non-GitHub
// fallback.

const BASE: ReportContext = {
  surface: 'the dataset entry page',
  subject: 'M7TEE',
  datasetKey: '2025-06-04',
  pageUrl: 'https://mysteraitch.github.io/amateur-callsigns-file-watch/datasets/open-data/2025-06-04/index.html',
};

describe('report issue URL (issue #439)', { tags: ['unit'] }, () => {
  it('ReportIssueUrl_ForARecordSurface_PreFillsTitleBodyAndLocation', () => {
    const url = reportIssueUrl(BASE);
    expect(url.startsWith(`${REPO_URL}/issues/new?`)).toBe(true);
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    expect(params.get('title')).toBe('Data report: M7TEE');
    const body = params.get('body') ?? '';
    // Everything a maintainer needs to land on the reader's exact hop.
    expect(body).toContain('Surface: the dataset entry page');
    expect(body).toContain('Record / subject: M7TEE');
    expect(body).toContain('Dataset / archive entry: 2025-06-04');
    expect(body).toContain(`Page: ${BASE.pageUrl}`);
  });

  it('ReportIssueUrl_WithoutADatasetKey_OmitsTheDatasetLine', () => {
    // A surface not bound to a single dataset must never invent one.
    const url = reportIssueUrl({ ...BASE, datasetKey: undefined });
    const body = new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('body') ?? '';
    expect(body).not.toContain('Dataset / archive entry');
    expect(body).toContain('Record / subject: M7TEE');
  });

  it('ReportIssueBody_Always_FramesAReportAsAnObservationNotAVerdict', () => {
    const body = reportIssueBody(BASE);
    // Non-accusatory, right-of-reply framing — and no grievance wording
    // pre-filled on the reporter's behalf.
    expect(body).toContain('observation for investigation, not a verdict');
    expect(body).toContain('cannot change the official register');
    expect(body).toContain('adding a source');
    expect(body).toContain('no set response time');
    expect(body.toLowerCase()).not.toContain('wrong');
    expect(body.toLowerCase()).not.toContain('corrupt');
  });

  it('ReportIssueUrl_SubjectWithSlashesAndInvisibleMarkers_EncodesAndRoundTrips', () => {
    // Non-happy path: a visitor form (slashes) whose raw token carries a
    // non-breaking space and the site's space marker. URLSearchParams must
    // percent-encode all of it into a valid URL that decodes back exactly.
    const awkward = 'M/PA0 TEST␠/P';
    const url = reportIssueUrl({ ...BASE, subject: awkward });
    // The raw reserved/invisible characters never appear literally in the URL.
    expect(url).not.toContain(' ');
    expect(url).not.toContain('␠');
    expect(url).toContain('title=Data+report');
    // ...and the query decodes back to the exact subject.
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    expect(params.get('title')).toBe(`Data report: ${awkward}`);
    expect(params.get('body') ?? '').toContain(`Record / subject: ${awkward}`);
  });

  it('ReportIssueUrl_LongDatasetKey_StaysUnderGitHubsUrlLengthTolerance', () => {
    // A pathological dataset key must not push the pre-filled URL past the
    // ~8 KB tolerance browsers and GitHub honour for issue-new links.
    const longKey = `ofcom-foi-${'a'.repeat(500)}`;
    const url = reportIssueUrl({ ...BASE, datasetKey: longKey });
    expect(url.length).toBeLessThan(8000);
    expect(new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('body') ?? '').toContain(longKey);
  });
});

describe('report affordance markup (issue #439)', { tags: ['ui'] }, () => {
  it('ReportAffordance_OnADeepPage_LinksThePreFilledIssueAndTheReportingDeepDive', () => {
    const html = reportAffordance(BASE, 3);
    // The issue link is embedded with HTML-safe ampersands and opens in a new
    // tab (the shared external-link affordance).
    expect(html).toContain(`${REPO_URL}/issues/new?title=`);
    expect(html).toContain('&amp;body=');
    expect(html).toContain('target="_blank"');
    // ...and it links through to the reporting section of the deep-dive page,
    // depth-resolved from the page's own level.
    expect(html).toContain('href="../../../fidelity.html#reporting"');
  });

  it('ReportAffordance_Always_FramesTheInviteCalmlyAndOffersANonGitHubFallback', () => {
    const html = reportAffordance(BASE, 0);
    expect(html).toContain('observation for investigation, not a verdict');
    // Honest about what filing needs, with a read-only fallback for the
    // account-less reader.
    expect(html).toContain('Filing needs a free one');
    expect(html).toContain(`${REPO_URL}/issues"`);
  });

  it('ReportAffordance_CustomLabel_UsesItAsTheVisibleLinkText', () => {
    const html = reportAffordance(BASE, 2, { label: 'Report an observation about this suffix' });
    expect(html).toContain('Report an observation about this suffix');
  });
});
