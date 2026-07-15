import { describe, it, expect } from 'vitest';
import { renderWorking, evidenceLinkFor } from './show-working.ts';
import { explain } from '../../v2/explain.ts';
import {
  emitLedger,
  LISTED_PREDICATE,
  FLAG_PREDICATE,
  CLEANED_CALLSIGN_RULE,
  LICENCE_CATEGORY_PREDICATE,
  STRIPPED_COLLISION_RULE,
  SOURCE_REPO_URL,
  type Claim,
  type SourceObservationSet,
} from '../../v2/claim.ts';
import { loadReferenceData } from '../../sources/ofcom-amateur/components.ts';

// The "show the working" surface (issue #433, ADR 0017 P4) renders the evidence
// behind a derived claim — its inputs, the transformation trace, and (the payoff
// of #431) a clickable GitHub permalink back to the exact source line each input
// rests on. Every scenario builds a REAL positioned ledger with emitLedger, asks
// explain to reconstruct a claim's working, and asserts the rendered HTML shows
// that evidence accessibly and links each source position via #431.

const REF = loadReferenceData();
const SHA = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
const REPO_PATH = 'archive/synthetic/fixture.csv';

// A synthetic source that exercises every derived rule, ENRICHED with source
// positions (a 1-based physical line per row + the real repo path) so the emitted
// @listed anchors carry a viewAnchor and the working's evidence links resolve to
// concrete permalinks — the whole point of the #431 composition.
function positionedSource(): SourceObservationSet {
  return {
    sourceFile: 'synthetic/fixture.csv',
    vintage: '2026-01-01',
    columns: ['Call Sign', 'Product', 'Original Start Date'],
    subjectColumn: 'Call Sign',
    categoryColumn: 'Product',
    originalStartDateColumn: 'Original Start Date',
    repoPath: REPO_PATH,
    // One header line, then one physical line per row (rows start at line 2).
    lineNumbers: [2, 3, 4, 5, 6, 7],
    rows: [
      { 'Call Sign': 'M7TEE', 'Product': 'Amateur Foundation Radio Licence', 'Original Start Date': '2020-01-01' },
      { 'Call Sign': 'm7tee', 'Product': '', 'Original Start Date': '' },
      { 'Call Sign': 'M0ASS', 'Product': '', 'Original Start Date': '2020-01-01' },
      { 'Call Sign': 'M7XYZ', 'Product': 'Amateur Full Radio Licence', 'Original Start Date': '2020-01-01' },
      { 'Call Sign': 'M7TEE ', 'Product': '', 'Original Start Date': '' },
      { 'Call Sign': 'MW7TEE', 'Product': 'Amateur Foundation Radio Licence', 'Original Start Date': '2020-01-01' },
    ],
  };
}

function ledgerFor(): Claim[] {
  return emitLedger(positionedSource(), REF);
}

function renderFor(find: (c: Claim) => boolean): string {
  const ledger = ledgerFor();
  const claim = ledger.find(c => c.layer === 'derived' && find(c));
  if (claim === undefined) throw new Error('fixture is missing the expected derived claim');
  return renderWorking(explain(claim, ledger, REF), ledger, SHA);
}

describe('the disclosure is a JavaScript-free, accessible affordance', { tags: ['ui'] }, () => {
  it('DerivedClaimWorking_WhenRendered_IsANativeDetailsDisclosureNeedingNoScript', () => {
    const html = renderFor(c => c.rule === CLEANED_CALLSIGN_RULE && c.rawSubject === 'm7tee');
    expect(html).toContain('<details class="show-working">');
    expect(html).toContain('<summary>Show the working');
    // The summary carries a visually-hidden, screen-reader-only description of
    // which claim it explains, never a bare "Show the working".
    expect(html).toContain('class="visually-hidden"');
    expect(html).not.toMatch(/<script|onclick=|javascript:/i);
  });

  it('DerivedClaimWorking_WhenRendered_NamesTheRuleInPlainEnglish', () => {
    const html = renderFor(c => c.rule === CLEANED_CALLSIGN_RULE && c.rawSubject === 'm7tee');
    // The plain-English gloss, not only the machine rule token, is present.
    expect(html).toContain('Upper-cased and stripped to the plain callsign alphabet');
    expect(html).toContain('confidence: Computed');
    // The ordered transformation trace is an <ol>, and the reproduced result is shown.
    expect(html).toContain('<ol class="working-steps">');
    expect(html).toContain('Reproduces: <code>M7TEE</code>');
  });
});

describe('each evidence position links back to the exact source byte via #431', { tags: ['ui'] }, () => {
  it('RawTokenInput_WhenRendered_LinksToItsObservationsSourceLine', () => {
    // The cleaned-callsign working consumes the observation's raw token; the token
    // sits at line 3 (ordinal 1) of the source, so its evidence link is the pinned
    // GitHub blob permalink to that exact line.
    const html = renderFor(c => c.rule === CLEANED_CALLSIGN_RULE && c.rawSubject === 'm7tee');
    const permalink = `${SOURCE_REPO_URL}/blob/${SHA}/${REPO_PATH}#L3`;
    expect(html).toContain(permalink);
    // Rendered as the shared leave-the-site affordance (opens in a new tab).
    expect(html).toContain('rel="noopener"');
    expect(html).toContain('(opens in a new tab)');
    expect(html).toContain('line 3 of archive/synthetic/fixture.csv');
  });

  it('LicenceCategoryWorking_WhenRendered_LinksTheProductCellAndTheReferenceRow', () => {
    const html = renderFor(c => c.predicate === LICENCE_CATEGORY_PREDICATE && c.object === 'Foundation' && c.rawSubject === 'M7TEE');
    // The product cell is a raw claim of the M7TEE observation (line 2) — linked.
    expect(html).toContain(`${SOURCE_REPO_URL}/blob/${SHA}/${REPO_PATH}#L2`);
    // The reference row it maps through is linked to the versioned table file.
    expect(html).toContain(`${SOURCE_REPO_URL}/blob/${SHA}/reference-data/licence-category.csv`);
    expect(html).toContain('the row keyed “Amateur Foundation Radio Licence” in reference-data/licence-category.csv');
  });

  it('ForbiddenSuffixFlagWorking_WhenRendered_LinksTheForbiddenSuffixesReferenceRow', () => {
    const html = renderFor(c => c.predicate === FLAG_PREDICATE && c.object === 'forbidden-suffix' && c.rawSubject === 'M0ASS');
    expect(html).toContain(`${SOURCE_REPO_URL}/blob/${SHA}/reference-data/forbidden-suffixes.csv`);
    expect(html).toContain('the row keyed “ASS” in reference-data/forbidden-suffixes.csv');
  });

  it('StrippedCollisionWorking_WhenRendered_LinksTheSiblingObservationsSourceLine', () => {
    // 'M7TEE ' (line 6) collides, once junk-stripped, with the sibling 'M7TEE'
    // observation at line 2; the sibling evidence links to that sibling's line.
    const html = renderFor(c => c.rule === STRIPPED_COLLISION_RULE && c.rawSubject === 'M7TEE ');
    expect(html).toContain(`${SOURCE_REPO_URL}/blob/${SHA}/${REPO_PATH}#L2`);
  });
});

describe('the resolver reports an honest absence when no position is recorded', { tags: ['unit'] }, () => {
  it('RawClaimOrigin_WhenObservationHasNoViewAnchor_YieldsNoLinkAndSaysSo', () => {
    // A legacy source with no line numbers: the anchor carries no viewAnchor, so
    // the evidence link is honestly link-less rather than a fabricated permalink.
    const source = positionedSource();
    const legacy: SourceObservationSet = { ...source, lineNumbers: undefined, repoPath: undefined };
    const ledger = emitLedger(legacy, REF);
    const claim = ledger.find(c => c.rule === CLEANED_CALLSIGN_RULE && c.rawSubject === 'm7tee');
    expect(claim).toBeDefined();
    if (claim === undefined) return;
    const link = evidenceLinkFor({ kind: 'raw-claim', sourceFile: source.sourceFile, ordinal: 1, predicate: LISTED_PREDICATE }, ledger, SHA);
    expect(link.href).toBeUndefined();
    expect(link.where).toContain('no source line recorded');
    // And the rendered HTML shows the absence as plain text, not a dead link.
    const html = renderWorking(explain(claim, ledger, REF), ledger, SHA);
    expect(html).toContain('working-locus-absent');
    expect(html).not.toContain('/blob/');
  });

  it('ReferenceRowOrigin_WhenResolved_AlwaysLinksTheVersionedTableFile', () => {
    const link = evidenceLinkFor({ kind: 'reference-row', file: 'prefix-formats.csv', key: 'M7', row: {} }, [], SHA);
    expect(link.href).toBe(`${SOURCE_REPO_URL}/blob/${SHA}/reference-data/prefix-formats.csv`);
  });
});

describe('a hostile source value cannot break out of the rendered markup', { tags: ['ui'] }, () => {
  it('RawTokenWithMarkupCharacters_WhenRendered_IsEscaped', () => {
    // The verbatim raw token — which the cleaned-callsign working consumes and
    // shows as its input value — carries markup characters; they must be escaped,
    // never emitted as live HTML.
    const source = positionedSource();
    const hostile: SourceObservationSet = {
      ...source,
      lineNumbers: [2],
      rows: [{ 'Call Sign': 'm7<b>tee', 'Product': '', 'Original Start Date': '' }],
    };
    const ledger = emitLedger(hostile, REF);
    const claim = ledger.find(c => c.rule === CLEANED_CALLSIGN_RULE && c.rawSubject === 'm7<b>tee');
    expect(claim).toBeDefined();
    if (claim === undefined) return;
    const html = renderWorking(explain(claim, ledger, REF), ledger, SHA);
    expect(html).toContain('m7&lt;b&gt;tee');
    expect(html).not.toContain('m7<b>tee');
  });
});
