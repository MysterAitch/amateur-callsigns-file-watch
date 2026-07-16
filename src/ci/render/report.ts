/**
 * The shared "report this" affordance (issue #439): a small, calm link beside a
 * record-bearing surface that turns a reader's doubt into a contribution. It
 * deep-links to a PRE-FILLED GitHub issue whose title and body already name the
 * exact surface, record and page the reader is on, so a report arrives located
 * to its hop (the error-locability principle) rather than as a context-free
 * "something looks off" a maintainer must first place.
 *
 * Framing follows the mirror's standing ethics: a report is an OBSERVATION for
 * investigation, never a verdict; the mirror reflects what its sources
 * published and cannot change the official register; a correction lands by
 * ADDING a source, never by silently editing a record (the right-of-reply
 * ethos). The pre-filled body states the facts neutrally and pre-fills NO
 * grievance wording on the reporter's behalf.
 *
 * JavaScript-free: the URL is composed at build time and the affordance is a
 * plain link, so it works with scripting disabled. A non-GitHub fallback line
 * points at the repository's issues page and is honest that FILING a new report
 * needs a free account, while reading the existing ones does not.
 *
 * This is the SERVER-rendered half of the affordance (dataset entry pages,
 * forbidden-suffix pages). The per-callsign page renders client-side, so its
 * equivalent link is composed by site/ledger-query.js's reportIssueUrl over the
 * same template shape — the two are deliberately kept in step.
 */

import { escapeHtml, externalLink, REPO_URL } from './html.ts';
import { fidelityHref } from './fidelity.ts';

// What a report is ABOUT, gathered so the pre-filled issue is locatable to its
// exact hop. Every field is plain text, as the reader sees it.
export interface ReportContext {
  // The surface the reader is on, as a noun phrase — "the dataset entry page",
  // "a forbidden-suffix page", "the per-callsign page".
  surface: string;
  // The record/subject in view (a callsign, a suffix, a dataset title) — what
  // the reader would name if asked "which record?".
  subject: string;
  // The archive entry / dataset key the surface is bound to, when it has one;
  // omitted for surfaces not scoped to a single dataset.
  datasetKey?: string;
  // The full public URL of the page, so a maintainer lands exactly where the
  // reader was.
  pageUrl: string;
}

// The pre-filled issue body: a neutral statement of where the reader was, and
// prompts (never grievance wording) for what they observed. The "Where" block
// carries the locability payload; the dataset line is present only when the
// surface is bound to one, so a report from a whole-site page never invents a
// dataset it does not belong to.
export function reportIssueBody(context: ReportContext): string {
  const where = [
    `- Surface: ${context.surface}`,
    `- Record / subject: ${context.subject}`,
    context.datasetKey === undefined ? undefined : `- Dataset / archive entry: ${context.datasetKey}`,
    `- Page: ${context.pageUrl}`,
  ].filter((line): line is string => line !== undefined);
  return [
    'Thank you for helping check the mirror.',
    '',
    'This is an observation for investigation, not a verdict. The mirror reflects '
      + 'what its sources published; it cannot change the official register, and any '
      + 'correction lands by adding a source, never by silently editing a record. This '
      + 'issue is public, and there is no set response time.',
    '',
    '### Where you saw it',
    ...where,
    '',
    '### What you observed',
    '(please describe what you saw)',
    '',
    '### What you expected (optional)',
    '(what did you expect instead, and why?)',
    '',
    '### Source or evidence (optional)',
    '(a link, a document, or a publication date that supports the observation)',
  ].join('\n');
}

// The pre-filled GitHub issue-new URL. URLSearchParams percent-encodes every
// title/body character (slashes, invisible markers, newlines), so a subject or
// page URL carrying reserved characters composes into a valid URL that decodes
// back to the exact text — the same encoding the client affordance uses.
export function reportIssueUrl(context: ReportContext): string {
  const params = new URLSearchParams({
    title: `Data report: ${context.subject}`,
    body: reportIssueBody(context),
  });
  return `${REPO_URL}/issues/new?${params.toString()}`;
}

// Embed a composed URL in a double-quoted HTML attribute: the single `&`
// query-parameter separators become `&amp;` so the attribute is valid HTML (a
// browser decodes them back to `&` on read), matching the site's other
// deep-link affordances (exploreDeepLink).
function attrUrl(url: string): string {
  return url.replace(/&/g, '&amp;');
}

// The rendered affordance: a calm one-line invitation. The link opens the
// pre-filled issue in a new tab (the shared external-link affordance); the
// sentence is honest that a report is an observation, offers the non-GitHub
// fallback, and links through to the fidelity page's reporting section for what
// happens next. `depthToRoot` resolves the reporting deep-link from the page's
// own depth below the site root.
export function reportAffordance(context: ReportContext, depthToRoot: number, options: { label?: string } = {}): string {
  const label = options.label ?? 'Report or examine this record';
  const issueHref = attrUrl(reportIssueUrl(context));
  const reportingHref = fidelityHref(depthToRoot, 'reporting');
  return '<p class="report-affordance">'
    + externalLink(issueHref, label)
    + ' — opens a pre-filled GitHub issue that already names this page and record, so a report '
    + 'arrives located to its exact place. A report is an observation for investigation, not a '
    + 'verdict. No GitHub account? Filing needs a free one; you can still '
    + externalLink(`${REPO_URL}/issues`, 'read the issues already filed')
    + `. <a href="${escapeHtml(reportingHref)}">What happens to a report</a>.`
    + '</p>';
}
