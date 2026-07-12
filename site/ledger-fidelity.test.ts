// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  fidelityOf,
  sourceRepoPath,
  sourceFileUrl,
  reportIssueUrl,
  FIDELITY_PREAMBLE,
} from './ledger-query.js';
import { renderFidelity } from './ledger.js';

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
    const variant = f.canonical?.variants.find(v => v.raw === 'G0TQK ');
    expect(variant).toBeDefined();
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
    for (const word of ['damaged', 'dirty', 'corrupt', 'malformed', 'defect', 'error', 'wrong', 'cleaned', 'normalised']) {
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
    expect(note?.label).toBe('Suffix appears on a withheld-suffix list');
    expect(note?.gloss).toContain('not a verdict');
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
    expect(note?.label).toBe('Not resolved to a standard callsign');
    // The single highest-harm feature: no lookalike suggestion anywhere.
    const text = JSON.stringify(f);
    expect(text).not.toContain('M0GCQ');
    expect(text.toLowerCase()).not.toContain('did you mean');
    expect(text.toLowerCase()).not.toContain('suggest');
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
    expect(host.textContent).toContain(FIDELITY_PREAMBLE);
    // The preamble locates, imputes nothing, and admits multiple licensees.
    expect(FIDELITY_PREAMBLE).toContain('locate an observation rather than assign fault');
    expect(FIDELITY_PREAMBLE).toContain('impute');
    expect(FIDELITY_PREAMBLE).toContain('more than one licensee');
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
