// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  fidelityOf,
  sourceRepoPath,
  sourceFileUrl,
  sourceLabel,
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

// A database-shaped claim row, as the shipped SQLite `claims` view yields it -
// the query layer's own row type, so these fixtures track the real shape.
type Row = import('./ledger-query.js').ClaimRow;
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

describe('fidelityOf — selective disclosure (ethics decision 8)', { tags: ['ui'] }, () => {
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

describe('fidelityOf — canonical-form divergence (trailing whitespace)', { tags: ['ui'] }, () => {
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
    // The intro explains the transformation accurately — both upper-casing AND
    // removing out-of-set characters — so it is correct for a casing-only
    // divergence (m7tee -> M7TEE) where nothing is removed.
    const intro = glossText(f.canonical?.intro);
    expect(intro).toContain('upper-case the letters');
    expect(intro).toContain('canonical form');
    expect(intro).toContain('standard callsign set');
    const variant = f.canonical?.variants.find(v => v.raw === 'G0TQK ');
    expect(variant).toBeDefined();
    // The side-by-side prose shows the verbatim form and the canonical form.
    const prose = glossText(variant?.prose);
    expect(prose).toContain('As published');
    expect(prose).toContain('Canonical form');
    // The working reproduces the canonical form from the published form.
    expect(variant?.working.result).toBe('G0TQK');
    // The canonical working's result is a callsign, so it is shown verbatim
    // (invisible characters marked) — unlike a flag working's label result.
    expect(variant?.working.resultVerbatim).toBe(true);
    expect(variant?.working.inputs[0]?.value).toBe('G0TQK ');
    expect(variant?.working.sources[0]).toMatchObject({ sourceFile: SRC, ordinal: 20, vintage: V });
  });

  it('WhenDivergenceIsCasingOnly_StillDisclosesWithAnAccurateIntro', () => {
    // m7tee -> M7TEE: nothing is removed, only upper-cased. The affordance must
    // still disclose, and the intro must not claim characters were taken out.
    const casing = { typed: 'M7TEE', cleaned: 'M7TEE', entity: 'M#7TEE', matched: 'cleaned' as const };
    const f = fidelityOf([
      raw('m7tee', 'M7TEE', 'M#7TEE', '@listed', '', SRC, 5, V),
      derived('m7tee', 'M7TEE', 'M#7TEE', 'normalises_to', 'M7TEE', 'cleaned-callsign', SRC, 5, V),
    ], casing);
    expect(f.disclose).toBe(true);
    expect(f.canonical?.canonicalForm).toBe('M7TEE');
    expect(f.canonical?.variants[0]?.raw).toBe('m7tee');
    expect(f.canonical?.variants[0]?.working.result).toBe('M7TEE');
    expect(glossText(f.canonical?.intro)).toContain('upper-case the letters');
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

describe('fidelityOf — a derived flag (forbidden suffix)', { tags: ['ui'] }, () => {
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
    // Anatomy explainer. The neutrality is carried by the plain factual statement,
    // not by a "not a verdict" disclaimer (which would invoke the frame it denies).
    expect(note?.label).toBe('Suffix appears on a withheld-suffix list');
    expect(glossText(note?.gloss)).toContain('the list governs new issues, not existing ones');
    expect(glossText(note?.gloss).toLowerCase()).not.toContain('verdict');
    expect(note?.working?.result).toBe('forbidden-suffix');
    // A flag working's result is a label token, rendered as plain text (not a
    // verbatim callsign), so it must not be marked resultVerbatim.
    expect(note?.working?.resultVerbatim).toBeFalsy();
    // No divergence, so no canonical block - just the note.
    expect(f.canonical).toBeNull();
  });
});

describe('fidelityOf — mismatch cases use the source-vs-derivation model', { tags: ['ui'] }, () => {
  const resolved = { typed: 'G8XYZ', cleaned: 'G8XYZ', entity: 'G#8XYZ', matched: 'cleaned' as const };
  const noteFor = (flag: string) => fidelityOf([
    raw('G8XYZ', 'G8XYZ', 'G#8XYZ', '@listed', '', SRC, 1, V),
    derived('G8XYZ', 'G8XYZ', 'G#8XYZ', 'flag', flag, 'parse-callsign', SRC, 1, V),
  ], resolved).notes.find(n => n.id === flag);

  it('ClassProductMismatch_FlagsADiscrepancyAndOwnsOurFallibility', () => {
    const g = glossText(noteFor('class-product-mismatch')?.gloss);
    expect(g).toContain('flag a discrepancy');
    expect(g).toContain('draw no conclusion');
    expect(g).toContain('best-effort derivation');
    expect(g).toContain('either side'); // either the source or our mapping could be imperfect
  });

  it('ForbiddenSuffixTemporal_NotesTheDiscrepancyAndDrawsNoConclusion', () => {
    const g = glossText(noteFor('forbidden-suffix-issued-after-first-known-list')?.gloss);
    expect(g).toContain('We note an apparent discrepancy');
    expect(g).toContain('draw no conclusion');
    expect(g).toContain('best-effort derivation');
  });
});

describe('fidelityOf — no judgement-negating meta-tags in any gloss', { tags: ['ui'] }, () => {
  // Guard: neutrality is carried by plain factual statements, so no user-facing
  // gloss should contain "verdict" (nor "not a verdict"-style framing).
  const FLAG_IDS = ['lowercase', 'whitespace', 'encoding-failure', 'excel-date-shape',
    'spreadsheet-error-token', 'rsl-in-register', 'unknown-rsl', 'unknown-prefix-series',
    'forbidden-suffix', 'forbidden-suffix-issued-after-first-known-list', 'suffix-length-abnormal',
    'class-product-mismatch', 'stripped-collision', 'malformed-home-callsign', 'hash-in-register'];
  it('EveryFlagGloss_ContainsNoVerdictMetaTag', () => {
    const resolved = { typed: 'G8XYZ', cleaned: 'G8XYZ', entity: 'G#8XYZ', matched: 'cleaned' as const };
    for (const flag of FLAG_IDS) {
      const claims: Row[] = [
        raw('G8XYZ', 'G8XYZ', 'G#8XYZ', '@listed', '', SRC, 1, V),
        derived('G8XYZ', 'G8XYZ', 'G#8XYZ', 'flag', flag, 'parse-callsign', SRC, 1, V),
      ];
      const note = fidelityOf(claims, resolved).notes.find(n => n.id === flag);
      expect(glossText(note?.gloss).toLowerCase(), `${flag} gloss should not say "verdict"`).not.toContain('verdict');
    }
  });
});

describe('fidelityOf — unparseable token (MOGCQ) shows no lookalike', { tags: ['ui'] }, () => {
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

describe('record-fidelity render — framing and right-of-reply hook', { tags: ['ui'] }, () => {
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
    // Framed with the neutral vocabulary: the notes are things we note/observe;
    // an inconsistency with our derived rules is a flagged discrepancy about which
    // we draw no conclusion. It admits a callsign may belong to different people
    // over time and carries no judgement-negating meta-tag.
    expect(preamble).toContain('note or observe');
    expect(preamble).toContain('flag the discrepancy');
    expect(preamble).toContain('draw no conclusion');
    expect(preamble).toContain('belong to');
    expect(preamble).toContain('different people');
    expect(preamble.toLowerCase()).not.toContain('verdict');
    expect(preamble.toLowerCase()).not.toContain('not judgements');
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

describe('explainer pages (reusable FAQ section)', { tags: ['ui'] }, () => {
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

describe('sourceLabel — humanises the logical source path', { tags: ['ui'] }, () => {
  it('OpenDataSnapshot_LabelsAsOfcomOpenData', () => {
    expect(sourceLabel('opendata/2025-06-04/raw.csv')).toBe('Ofcom open data');
  });
  it('OfcomFoiDownload_LabelsAsOfcomFoi', () => {
    expect(sourceLabel('foi/ofcom-01667041--data-download/raw-extract.csv')).toBe('Ofcom FOI');
  });
  it('WdtkRequest_LabelsWithTheRequestId', () => {
    expect(sourceLabel('foi/wdtk-123456--list-of-licences/response.csv')).toBe('FOI · WDTK 123456');
  });
  it('UnrecognisedPath_FallsBackToTheFullPathRatherThanInventingALabel', () => {
    expect(sourceLabel('something/else.csv')).toBe('something/else.csv');
  });
});

describe('record-fidelity render — the source list is the shared vertical timeline (#466)', { tags: ['ui'] }, () => {
  const resolved = { typed: 'G0TQK', cleaned: 'G0TQK', entity: 'G#0TQK', matched: 'cleaned' as const };
  const claims: Row[] = [
    ...cleanObservation('G0TQK', 'G#0TQK', 10),
    raw('G0TQK ', 'G0TQK', 'G#0TQK', '@listed', '', SRC, 20, V),
    derived('G0TQK ', 'G0TQK', 'G#0TQK', 'normalises_to', 'G0TQK', 'cleaned-callsign', SRC, 20, V),
  ];

  it('RendersEachSourceAsATimelineEvent_WithAHumanisedLabelThatKeepsTheFullPath', () => {
    const host = document.createElement('div');
    renderFidelity(host, resolved, claims);
    // The "seen in" list is now the shared activity timeline: a semantic <ol> of
    // year groups, each an <ol> of source events, with the date in a <time>.
    const events = [...host.querySelectorAll('.fid-sources ol.tl li.tl-event.tl-source')];
    expect(events.length).toBeGreaterThan(0);
    const first = events[0];
    // The lead reads "row {ordinal} · {label}"; the date sits on the right in <time>.
    expect(first?.querySelector('.tl-lead')?.textContent).toContain('row 20');
    expect(first?.querySelector('time.tl-date')?.textContent).toBe(V);
    expect(first?.querySelector('time.tl-date')?.getAttribute('datetime')).toBe(V);
    // Grouped by year: the period label carries the four-digit year.
    expect(host.querySelector('.fid-sources .tl-period time')?.textContent).toBe('2025');
    const link = first?.querySelector('a');
    // The humanised label is the VISIBLE link text; the long path never appears
    // as run-on text but is kept losslessly on the href and title.
    expect(link?.textContent).toContain('Ofcom open data');
    expect(link?.textContent).not.toContain('opendata/2025-06-04/raw.csv');
    expect(link?.getAttribute('title')).toBe(SRC);
    expect(link?.getAttribute('href')).toContain('blob/main/archive/2025-06-04/raw.csv');
  });
});

describe('record-fidelity render — a many-snapshot source timeline collapses (#466)', { tags: ['ui'] }, () => {
  const resolved = { typed: 'G0TQK', cleaned: 'G0TQK', entity: 'G#0TQK', matched: 'cleaned' as const };
  const vintages = ['2019-01-01', '2020-01-01', '2021-01-01', '2022-01-01', '2023-01-01', '2024-01-01', '2025-01-01'];
  const claims: Row[] = [
    ...cleanObservation('G0TQK', 'G#0TQK', 10),
    ...vintages.flatMap((vin, i): Row[] => {
      const src = `opendata/${vin}/raw.csv`;
      return [
        raw('G0TQK ', 'G0TQK', 'G#0TQK', '@listed', '', src, 20 + i, vin),
        derived('G0TQK ', 'G0TQK', 'G#0TQK', 'normalises_to', 'G0TQK', 'cleaned-callsign', src, 20 + i, vin),
      ];
    }),
  ];

  it('ShowsTheFirstFiveEventsInline_AndTucksTheRestBehindAJsFreeDetails', () => {
    const host = document.createElement('div');
    renderFidelity(host, resolved, claims);
    const seen = host.querySelector('.fid-seen .fid-sources');
    expect(seen).toBeTruthy();
    // Each snapshot is a distinct year, so the first five years (five events)
    // stay directly visible under the wrapper's first timeline.
    const firstTimeline = seen?.querySelector(':scope > ol.tl');
    expect(firstTimeline?.querySelectorAll('li.tl-event').length).toBe(5);
    // The overflow (two more) is tucked behind a native <details> so it reveals
    // with JavaScript off, with a summary naming the full count.
    const details = seen?.querySelector('details.tl-more');
    expect(details?.tagName.toLowerCase()).toBe('details');
    expect(details?.querySelector('summary')?.textContent).toContain('Show all 7 sources');
    expect(details?.querySelectorAll('li.tl-event').length).toBe(2);
  });
});

describe('source and report URL helpers', { tags: ['ui'] }, () => {
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
