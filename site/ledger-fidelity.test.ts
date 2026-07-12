// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  fidelityOf,
  sourceRepoPath,
  sourceFileUrl,
  reportIssueUrl,
  segmentsText,
  FIDELITY_PREAMBLE,
} from './ledger-query.js';
import { renderFidelity } from './ledger.js';

// The readable text of a note/segment gloss (segments carry inline links).
const glossText = (segments: unknown): string => segmentsText(segments as never);

// The inline record-fidelity affordance (#438). These are user-scenario tests:
// what does a licensee looking up their own callsign actually see? The binding
// framing decisions (ethics review, decisions 1-8) are exercised directly -
// selective disclosure for the clean case, non-accusatory notes, the "show the
// working" disclosure, the examine/report hook, and the ABSENCE of any lookalike
// / "did you mean" suggestion.

// A database-shaped claim row, as the shipped SQLite `claims` view yields it.
type Row = Record<string, unknown>;
function raw(rawSubject: string, cleaned: string, entity: string, predicate: string, object: string,
  sourceFile: string, ordinal: number, vintage: string): Row {
  return { layer: 'raw', raw_subject: rawSubject, cleaned, entity, predicate, object, rule: null, source_file: sourceFile, ordinal, vintage };
}
function derived(rawSubject: string, cleaned: string, entity: string, predicate: string, object: string,
  rule: string, sourceFile: string, ordinal: number, vintage: string): Row {
  return { layer: 'derived', raw_subject: rawSubject, cleaned, entity, predicate, object, rule, source_file: sourceFile, ordinal, vintage };
}

const SRC = 'opendata/2025-06-04/raw.csv';
const V = '2025-06-04';

// A clean observation: an @listed anchor plus the cleaned-callsign edge, raw
// form equal to the canonical form.
function cleanObservation(callsign: string, entity: string, ordinal: number): Row[] {
  return [
    raw(callsign, callsign, entity, '@listed', '', SRC, ordinal, V),
    derived(callsign, callsign, entity, 'normalises_to', callsign, 'cleaned-callsign', SRC, ordinal, V),
  ];
}

const CLEAN_RESOLVED = { typed: 'M7TEE', cleaned: 'M7TEE', entity: 'M#7TEE', matched: 'cleaned' as const };

describe('fidelityOf — selective disclosure (ethics decision 8)', () => {
  it('CleanCallsign_WhenRawEqualsCanonicalAndNoFlags_SurfacesNothing', () => {
    const claims = cleanObservation('M7TEE', 'M#7TEE', 1);
    const f = fidelityOf(claims, CLEAN_RESOLVED);
    expect(f.disclose).toBe(false);
    expect(f.canonical).toBeNull();
    expect(f.notes).toEqual([]);
  });

  it('CleanCallsign_WhenRendered_AddsNoNodesToTheDossier', () => {
    const claims = cleanObservation('M7TEE', 'M#7TEE', 1);
    const host = document.createElement('div');
    renderFidelity(host, CLEAN_RESOLVED, claims);
    expect(host.childNodes.length).toBe(0);
    expect(host.textContent).toBe('');
  });
});

describe('fidelityOf — canonical-form divergence (trailing whitespace)', () => {
  const resolved = { typed: 'G0TQK', cleaned: 'G0TQK', entity: 'G#0TQK', matched: 'cleaned' as const };
  const claims: Row[] = [
    ...cleanObservation('G0TQK', 'G#0TQK', 10),
    // the trailing-space twin: same entity, differing published form
    raw('G0TQK ', 'G0TQK', 'G#0TQK', '@listed', '', SRC, 20, V),
    derived('G0TQK ', 'G0TQK', 'G#0TQK', 'normalises_to', 'G0TQK', 'cleaned-callsign', SRC, 20, V),
  ];

  it('WhenPublishedFormDiffersFromCanonical_SurfacesCanonicalFormAndItsWorking', () => {
    const f = fidelityOf(claims, resolved);
    expect(f.disclose).toBe(true);
    expect(f.canonical?.canonicalForm).toBe('G0TQK');
    // The intro explains once and links to the structure + canonical explainers.
    const intro = glossText(f.canonical?.intro);
    expect(intro).toContain('characters not normally found in a UK callsign');
    expect(intro).toContain('canonical form');
    const variant = f.canonical?.variants.find(v => v.raw === 'G0TQK ');
    expect(variant).toBeDefined();
    // The side-by-side prose shows the verbatim form and the canonical form.
    const prose = glossText(variant?.prose);
    expect(prose).toContain('As published');
    expect(prose).toContain('Canonical form');
    // The working reproduces the canonical form from the published form.
    expect(variant?.working.result).toBe('G0TQK');
    expect(variant?.working.inputs[0]?.value).toBe('G0TQK ');
    expect(variant?.working.sources[0]).toMatchObject({ sourceFile: SRC, ordinal: 20, vintage: V });
  });

  it('WhenPublishedFormDiffers_TheRenderedTextUsesNoJudgementalVocabulary', () => {
    // Scope: the USER-FACING rendered text. Internal code tokens (e.g. the
    // 'cleaned-callsign' rule id in the model) are never displayed - the panel
    // shows the plain-English rule gloss, not the token (ethics decision 7's
    // internal-vs-surface split).
    const host = document.createElement('div');
    renderFidelity(host, resolved, claims);
    const text = host.textContent?.toLowerCase() ?? '';
    // Purely-judgemental jargon and the internal process words must not reach
    // the surface. (Words like "wrong" can appear in a NEGATION — "without
    // saying anything is wrong" — so they are not blanket-banned; these are the
    // terms that would themselves brand the record.)
    for (const word of ['damaged', 'dirty', 'corrupt', 'malformed', 'defect', 'unparseable', 'cleaned', 'normalised']) {
      expect(text, `rendered fidelity text should not contain "${word}"`).not.toContain(word);
    }
  });
});

describe('fidelityOf — a derived flag (forbidden suffix)', () => {
  const resolved = { typed: 'G8XYZ', cleaned: 'G8XYZ', entity: 'G#8XYZ', matched: 'cleaned' as const };
  const claims: Row[] = [
    ...cleanObservation('G8XYZ', 'G#8XYZ', 30),
    derived('G8XYZ', 'G8XYZ', 'G#8XYZ', 'flag', 'forbidden-suffix', 'parse-callsign', SRC, 30, V),
  ];

  it('WhenFlagApplies_SurfacesANonAccusatoryNoteWithItsWorking', () => {
    const f = fidelityOf(claims, resolved);
    const note = f.notes.find(n => n.id === 'forbidden-suffix');
    expect(note).toBeDefined();
    // Precise domain term "suffix" (the callsign's ending letters), linked to the
    // Anatomy explainer; the tight, already-clear phrasing is kept verbatim.
    expect(note?.label).toBe('Suffix appears on a withheld-suffix list');
    expect(glossText(note?.gloss)).toContain('Recorded, not a verdict');
    expect(note?.working?.result).toBe('forbidden-suffix');
    // No divergence, so no canonical block - just the note.
    expect(f.canonical).toBeNull();
  });
});

describe('fidelityOf — unparseable token (MOGCQ) shows no lookalike', () => {
  // MOGCQ carries an O/0 confusion; M0GCQ exists as a distinct, live record for
  // possibly a different person. The affordance must NOT suggest or link it.
  const resolved = { typed: 'MOGCQ', cleaned: 'MOGCQ', entity: 'MOGCQ', matched: 'cleaned' as const };
  const claims: Row[] = [
    raw('MOGCQ', 'MOGCQ', 'MOGCQ', '@listed', '', SRC, 40, V),
    raw('MOGCQ', 'MOGCQ', 'MOGCQ', 'Status', 'Allocated', SRC, 40, V),
    derived('MOGCQ', 'MOGCQ', 'MOGCQ', 'normalises_to', 'MOGCQ', 'cleaned-callsign', SRC, 40, V),
    derived('MOGCQ', 'MOGCQ', 'MOGCQ', 'parse_status', 'unparseable', 'parse-callsign', SRC, 40, V),
  ];

  it('WhenUnparseable_SurfacesANeutralNoteAndNeverSuggestsALookalike', () => {
    const f = fidelityOf(claims, resolved);
    const note = f.notes.find(n => n.id === 'parse-status-unparseable');
    expect(note).toBeDefined();
    expect(note?.label).toBe('We could not read this as a standard callsign');
    // The note explicitly declines to suggest a correction, and says why.
    expect(glossText(note?.gloss)).toContain('we do not suggest');
    // The single highest-harm feature: no lookalike is ever produced. The real
    // distinct callsign M0GCQ never appears, and there is no suggestion field.
    const text = JSON.stringify(f);
    expect(text).not.toContain('M0GCQ');
    expect(text.toLowerCase()).not.toContain('did you mean');
    expect(f).not.toHaveProperty('suggestion');
  });

  it('WhenRendered_ContainsNoLookalikeAndDrivesTheWorkingWithJsOff', () => {
    const host = document.createElement('div');
    renderFidelity(host, resolved, claims);
    expect(host.textContent).not.toContain('M0GCQ');
    // The "show the working" is a native <details> - it reveals with JS off.
    const details = host.querySelector('details.fid-why');
    expect(details?.tagName.toLowerCase()).toBe('details');
    expect(details?.querySelector('summary')?.textContent).toContain('Show the working');
  });
});

describe('record-fidelity render — framing and right-of-reply hook', () => {
  const resolved = { typed: 'G0TQK', cleaned: 'G0TQK', entity: 'G#0TQK', matched: 'cleaned' as const };
  const claims: Row[] = [
    ...cleanObservation('G0TQK', 'G#0TQK', 10),
    raw('G0TQK ', 'G0TQK', 'G#0TQK', '@listed', '', SRC, 20, V),
    derived('G0TQK ', 'G0TQK', 'G#0TQK', 'normalises_to', 'G0TQK', 'cleaned-callsign', SRC, 20, V),
  ];

  it('CarriesTheStandingFramingPreamble', () => {
    const host = document.createElement('div');
    renderFidelity(host, resolved, claims);
    const preamble = segmentsText(FIDELITY_PREAMBLE);
    expect(host.textContent).toContain(preamble);
    // The preamble is observation-not-judgement, blames no-one, and admits that
    // a callsign may belong to different people over time.
    expect(preamble).toContain('observations, not judgements');
    expect(preamble).toContain('without blaming the licence holder or the publisher');
    expect(preamble).toContain('belong to');
    expect(preamble).toContain('different people');
  });

  it('OffersAnExamineSourceLinkAndAReportHookWithoutOverpromising', () => {
    const host = document.createElement('div');
    renderFidelity(host, resolved, claims);
    const examine = [...host.querySelectorAll('a')].find(a => /github\.com.*blob\/main\/archive/.test(a.getAttribute('href') ?? ''));
    expect(examine).toBeDefined();
    expect(examine?.getAttribute('target')).toBe('_blank');
    expect(examine?.getAttribute('rel')).toBe('noopener');
    const report = [...host.querySelectorAll('a')].find(a => (a.getAttribute('href') ?? '').includes('issues/new'));
    expect(report).toBeDefined();
    expect(host.textContent).toContain('cannot change the official register');
  });

  it('LinksTheInlineNoteToTheExplainerPages', () => {
    const host = document.createElement('div');
    renderFidelity(host, resolved, claims);
    const hrefs = [...host.querySelectorAll('a')].map(a => a.getAttribute('href') ?? '');
    // Jargon depth is pushed to the explainers, keeping the inline text short.
    expect(hrefs).toContain('callsign-structure.html');
    expect(hrefs).toContain('invisible-characters.html');
    expect(hrefs).toContain('glossary.html#canonical-form');
    // On-site explainer links stay in the same tab (not opened in a new one).
    const structure = [...host.querySelectorAll('a')].find(a => a.getAttribute('href') === 'callsign-structure.html');
    expect(structure?.getAttribute('target')).toBeNull();
  });
});

describe('explainer pages (reusable FAQ section)', () => {
  const SITE = 'site';
  const PAGES = ['callsign-structure.html', 'invisible-characters.html'];
  for (const page of PAGES) {
    it(`${page.replace('.html', '')}_ExistsAsAStaticScriptFreePage`, () => {
      const html = fs.readFileSync(path.join(SITE, page), 'utf8');
      expect(html).toContain('<main id="main" class="ledger">');
      // Static explainer: no module logic, no debug console — only the SW
      // registration inline script (as the other static pages carry).
      expect(html).not.toContain('src="debug.js"');
      expect(html).not.toMatch(/<script[^>]*\bsrc="[a-z-]+\.js"/);
      // Carries the nav markers so it stays wayfindable and valid offline.
      expect(html).toContain('<!-- nav:start');
      expect(html).toContain('<!-- nav:end -->');
    });
  }

  it('CallsignStructure_IsPublishableWithSourcedConfidenceTiers_NoPlaceholders', () => {
    // Sourcing discipline: every fact carries a source + confidence tier; no bare
    // placeholder text remains, and no fabricated basis. The suffix-sense
    // collision (callsign ending vs Ofcom's post-slash "suffix") is disambiguated.
    const html = fs.readFileSync(path.join(SITE, 'callsign-structure.html'), 'utf8');
    expect(html).not.toContain('[needs verification');
    expect(html).toContain('Authoritative');
    expect(html).toContain('Best available');
    expect(html).toContain('OFW611');
    expect(html).toContain('International Telecommunication Union');
    expect(html).toContain('Full (Club) Licence only'); // the RSL club-difference correction
    expect(html).toContain('operating suffix'); // the disambiguated post-slash sense
  });

  it('InvisibleCharacters_ResolvesUnicodeFactsWithAnAuthoritativeSource', () => {
    const html = fs.readFileSync(path.join(SITE, 'invisible-characters.html'), 'utf8');
    expect(html).not.toContain('[needs verification');
    expect(html).toContain('NO-BREAK SPACE');
    expect(html).toContain('REPLACEMENT CHARACTER');
    expect(html).toContain('unicode.org/charts');
  });

  it('ExplainerPages_ArePrecachedInTheOfflineShell', () => {
    const sw = fs.readFileSync(path.join(SITE, 'sw.js'), 'utf8');
    for (const page of PAGES) expect(sw).toContain(`'${page}'`);
  });
});

describe('source and report URL helpers', () => {
  it('SourceRepoPath_ForOpenDataKey_MapsToArchiveRoot', () => {
    expect(sourceRepoPath('opendata/2025-06-04/raw.csv')).toBe('archive/2025-06-04/raw.csv');
  });
  it('SourceRepoPath_ForFoiKey_KeepsTheFoiPathUnderArchive', () => {
    expect(sourceRepoPath('foi/ofcom-2024--data-download/raw-extract.csv'))
      .toBe('archive/foi/ofcom-2024--data-download/raw-extract.csv');
  });
  it('SourceFileUrl_PointsAtTheBlobOnTheDefaultBranch', () => {
    expect(sourceFileUrl('opendata/2025-06-04/raw.csv'))
      .toBe('https://github.com/MysterAitch/amateur-callsigns-file-watch/blob/main/archive/2025-06-04/raw.csv');
  });
  it('ReportIssueUrl_PreFillsNeutrallyAndSetsExpectationsWithoutPromisingAResponse', () => {
    const url = reportIssueUrl('MOGCQ');
    expect(url.startsWith('https://github.com/MysterAitch/amateur-callsigns-file-watch/issues/new?')).toBe(true);
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    expect(params.get('title')).toBe('Observation about MOGCQ');
    const body = params.get('body') ?? '';
    expect(body).toContain('MOGCQ');
    expect(body).toContain('public GitHub issue');
    expect(body).toContain('no set response time');
    expect(body).toContain('cannot');
    // No grievance framing is pre-filled on the reporter's behalf.
    expect(body.toLowerCase()).not.toContain('corrupt');
    expect(body.toLowerCase()).not.toContain('wrong');
  });
});
