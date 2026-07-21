import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  renderWorking,
  evidenceLinkFor,
  examineTrail,
  sourceLineHop,
  ruleCodeHop,
  ruleCodeFor,
  RULE_CODE,
  type ExamineHop,
} from './show-working.ts';
import { explain } from '../../v2/explain.ts';
import {
  emitLedger,
  LISTED_PREDICATE,
  FLAG_PREDICATE,
  CLEANED_CALLSIGN_RULE,
  PLACEHOLDER_FORM_RULE,
  CALLSIGN_PATTERN_RULE,
  LICENCE_CATEGORY_RULE,
  LICENCE_CATEGORY_PREDICATE,
  PARSE_CALLSIGN_RULE,
  STRIPPED_COLLISION_RULE,
  EVENT_DATE_RULE,
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
    // And the rendered HTML shows the absence as plain text, not a dead link:
    // no archive-file permalink is fabricated. (The derivation-code line still
    // links the RULE's source file — that is real code at a real pin, not a
    // guessed source position.)
    const html = renderWorking(explain(claim, ledger, REF), ledger, SHA);
    expect(html).toContain('working-locus-absent');
    expect(html).not.toContain(`/blob/${SHA}/archive/`);
  });

  it('ReferenceRowOrigin_WhenResolved_AlwaysLinksTheVersionedTableFile', () => {
    const link = evidenceLinkFor({ kind: 'reference-row', file: 'prefix-formats.csv', key: 'M7', row: {} }, [], SHA);
    expect(link.href).toBe(`${SOURCE_REPO_URL}/blob/${SHA}/reference-data/prefix-formats.csv`);
  });
});

describe('the working names its derivation code as a pinned blob link (issue #439)', { tags: ['ui'] }, () => {
  it('DerivedClaimWorking_KnownRule_NamesTheFunctionAndPinsItsSourceFile', () => {
    const html = renderFor(c => c.rule === CLEANED_CALLSIGN_RULE && c.rawSubject === 'm7tee');
    // The (b) hop of the examine path: the very function whose re-run IS the
    // working, linked at the pinned commit — not a moving branch.
    expect(html).toContain('<p class="working-code">Derivation code: <code>cleanedCallsign</code>');
    expect(html).toContain(`${SOURCE_REPO_URL}/blob/${SHA}/src/sources/ofcom-amateur/components.ts`);
    expect(html).not.toContain('/blob/main/src/');
  });

  it('DerivedClaimWorking_LicenceCategoryRule_LinksTheLookupFunction', () => {
    const html = renderFor(c => c.predicate === LICENCE_CATEGORY_PREDICATE && c.object === 'Foundation' && c.rawSubject === 'M7TEE');
    expect(html).toContain('<code>normaliseLicenceCategory</code>');
  });
});

describe('the examine trail — one shared claim-to-evidence vocabulary (issue #439)', { tags: ['ui'] }, () => {
  const HOPS: ExamineHop[] = [
    { href: `${SOURCE_REPO_URL}/blob/${SHA}/${REPO_PATH}#L3`, label: 'source line 3', external: true },
    { href: '../../../ledger.html?c=M7TEE', label: 'working' },
  ];

  it('ExamineTrail_SourceAndWorkingHops_RendersLeadLinksAndSeparators', () => {
    const html = examineTrail(HOPS);
    expect(html).toContain('<span class="examine-trail">');
    expect(html).toContain('<span class="examine-lead">Examine:</span>');
    // The external hop leaves the site with the shared affordance; the
    // internal hop is a plain link — the two stay distinguishable.
    expect(html).toContain(`href="${SOURCE_REPO_URL}/blob/${SHA}/${REPO_PATH}#L3" target="_blank" rel="noopener"`);
    expect(html).toContain('<a href="../../../ledger.html?c=M7TEE">working</a>');
    // The separator is decorative, hidden from assistive tech.
    expect(html).toContain('<span class="examine-sep" aria-hidden="true">·</span>');
  });

  it('ExamineTrail_EmptyLead_OmitsTheLeadForContextsThatAlreadySayExamine', () => {
    const html = examineTrail(HOPS, { lead: '' });
    expect(html).not.toContain('examine-lead');
    expect(html).toContain('<span class="examine-trail">');
  });

  it('ExamineTrail_NoHops_RendersNothingRatherThanAnEmptyShell', () => {
    expect(examineTrail([])).toBe('');
  });

  it('ExamineTrail_HopWithANote_RendersThePlainTextQualifierAfterTheLink', () => {
    const html = examineTrail([{ ...HOPS[0], note: '(first of 2 rows with this form)' }]);
    expect(html).toContain('<span class="examine-note">(first of 2 rows with this form)</span>');
  });

  it('ExamineTrail_HostileLabelAndHref_AreEscapedNeverLiveMarkup', () => {
    const html = examineTrail([{ href: 'x.html?a="><script>', label: '<b>boom</b>' }]);
    expect(html).not.toContain('<b>boom</b>');
    expect(html).toContain('&lt;b&gt;boom&lt;/b&gt;');
    expect(html).not.toContain('"><script>');
  });

  it('SourceLineHop_WithAnAnchor_ComposesThePinnedPermalinkThroughTheSharedPrimitive', () => {
    const hop = sourceLineHop({ repoPath: REPO_PATH, line: 1234 }, SHA);
    expect(hop.href).toBe(`${SOURCE_REPO_URL}/blob/${SHA}/${REPO_PATH}#L1234`);
    // The label humanises the figure (en-GB grouping) and the hop leaves the site.
    expect(hop.label).toBe('source line 1,234');
    expect(hop.external).toBe(true);
  });

  it('RuleCodeHop_KnownRule_PinsTheResponsibleCodesBlob', () => {
    const hop = ruleCodeHop(CLEANED_CALLSIGN_RULE, SHA);
    expect(hop?.href).toBe(`${SOURCE_REPO_URL}/blob/${SHA}/src/sources/ofcom-amateur/components.ts`);
    expect(hop?.label).toContain('cleanedCallsign');
    expect(hop?.external).toBe(true);
  });

  it('RuleCodeHop_UnknownRule_ReturnsUndefinedNeverAFabricatedLink', () => {
    expect(ruleCodeHop('a-rule-nobody-registered', SHA)).toBeUndefined();
    expect(ruleCodeFor('a-rule-nobody-registered')).toBeUndefined();
  });
});

describe('the derivation-code register cannot drift from the code it names (issue #439)', { tags: ['unit'] }, () => {
  const EMITTED_RULES = [
    CLEANED_CALLSIGN_RULE,
    PLACEHOLDER_FORM_RULE,
    CALLSIGN_PATTERN_RULE,
    LICENCE_CATEGORY_RULE,
    PARSE_CALLSIGN_RULE,
    STRIPPED_COLLISION_RULE,
    EVENT_DATE_RULE,
  ];

  it('RuleCodeRegister_EveryEmittedDerivationRule_HasACodeMapping', () => {
    // The explain oracle proves every derived claim is explainable; this pins
    // the render-side counterpart — every explainable rule names its code, so
    // no working ever renders without its (b) hop.
    for (const rule of EMITTED_RULES) {
      expect(RULE_CODE.has(rule), `rule "${rule}" has no derivation-code mapping`).toBe(true);
    }
    // And nothing extra: an entry for a rule the ledger never emits would be a
    // link to code that produced nothing.
    expect([...RULE_CODE.keys()].sort()).toEqual([...new Set(EMITTED_RULES)].sort());
  });

  it('RuleCodeRegister_EveryMapping_PointsAtARealFileDeclaringTheNamedSymbol', () => {
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
    for (const [rule, code] of RULE_CODE) {
      const filePath = path.join(repoRoot, code.repoPath);
      expect(fs.existsSync(filePath), `rule "${rule}": ${code.repoPath} does not exist`).toBe(true);
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content.includes(code.symbol), `rule "${rule}": ${code.repoPath} does not mention ${code.symbol}`).toBe(true);
    }
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
