import { describe, it, expect } from 'vitest';
import { GLOSSARY_ANCHORS, epistemicsPill, applyEpistemicsPills, EPISTEMICS_TAGS } from './glossary.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// Narrative epistemics-tag pills (issue #755): each data narrative marks a
// claim `[observed]`/`[derived]`/`[hypothesis]`/`[confirmed]`. The interim
// shape (#754/#758) rendered the tag as plain bold text with a repeated
// per-file legend; this upgrades it to a small styled pill - a real link to
// the tag's ONE shared definition in the glossary. These tests cover the pill
// helper directly; src/ci/build-dataset-pages.test.ts covers it rendered into
// a real narrative page, and site/glossary-links.test.ts covers every
// GLOSSARY_ANCHORS entry (including the four added here) resolving to a real
// id in glossary.html.

describe('epistemicsPill', { tags: ['unit'] }, () => {
  it('EpistemicsPill_ObservedTag_RendersAsARealAnchorWithNoScriptRequired', () => {
    // Progressive enhancement: the pill is a plain <a href>, not a button or
    // a script-gated element, so it works identically with no JavaScript.
    const html = epistemicsPill('observed', 2);
    expect(html).toMatch(/^<a class="epistemic-tag tag-observed" href="[^"]+">/);
    expect(html).not.toContain('<button');
    expect(html).not.toContain('onclick');
  });

  it('EpistemicsPill_EveryTag_LinksToItsOwnGlossaryAnchorAtTheGivenDepth', () => {
    for (const tag of EPISTEMICS_TAGS) {
      const html = epistemicsPill(tag, 3);
      expect(html).toContain(`href="../../../glossary.html#tag-${tag}"`);
    }
  });

  it('EpistemicsPill_AccessibleName_StatesItIsAClaimTypeNotJustTheBareWord', () => {
    // A screen reader must hear more than the bare tag word - the visible
    // text plus a visually-hidden suffix compose an accessible name that
    // says what kind of thing this link is.
    const html = epistemicsPill('hypothesis', 2);
    expect(html).toContain('>hypothesis<span class="visually-hidden"> — claim type, see glossary definition</span></a>');
  });

  it('EpistemicsPill_EveryTagAnchor_IsRegisteredInTheGlossaryAnchorRegistry', () => {
    // GLOSSARY_ANCHORS is the registry site/glossary-links.test.ts checks
    // against the real glossary.html ids - every tag this helper can emit
    // must have a corresponding entry, or its pill would link nowhere.
    for (const tag of EPISTEMICS_TAGS) {
      expect(Object.keys(GLOSSARY_ANCHORS)).toContain(`tag-${tag}`);
    }
  });
});

describe('applyEpistemicsPills', { tags: ['unit'] }, () => {
  it('ApplyEpistemicsPills_BoldWrappedTagToken_BecomesAGlossaryLinkedPill', () => {
    // The exact shape render-markdown.ts's bold pass produces for every
    // narrative's `**[observed]**` tagging convention.
    const html = applyEpistemicsPills('<p><strong>[observed]</strong> Six groups.</p>', 2);
    expect(html).toContain('<a class="epistemic-tag tag-observed" href="../../glossary.html#tag-observed">observed');
    expect(html).not.toContain('<strong>[observed]</strong>');
  });

  it('ApplyEpistemicsPills_AllFourKnownTags_EachBecomesItsOwnPill', () => {
    const html = applyEpistemicsPills(
      '<p><strong>[observed]</strong> a. <strong>[derived]</strong> b. <strong>[hypothesis]</strong> c. <strong>[confirmed]</strong> d.</p>',
      1,
    );
    for (const tag of EPISTEMICS_TAGS) {
      expect(html).toContain(`class="epistemic-tag tag-${tag}"`);
    }
  });

  it('ApplyEpistemicsPills_UnboldedBracketWordInOrdinaryProse_IsLeftUntouched', () => {
    // The meta-reference case (docs/narratives/amateur-callsign-data-around-
    // the-world.md originally read "...not a data narrative in the
    // [observed]/[derived]/[hypothesis] sense..."): the SAME words in square
    // brackets, but not in the bold-wrapped shape the tagging convention
    // actually uses, must not be mangled into a pill.
    const prose = '<p>not a data narrative in the [observed]/[derived]/[hypothesis] sense used elsewhere.</p>';
    expect(applyEpistemicsPills(prose, 2)).toBe(prose);
  });

  it('ApplyEpistemicsPills_UnknownBracketedWord_IsLeftAsPlainBoldText', () => {
    // A closed set of exactly four tokens: a fifth, similarly-shaped word
    // (however plausible-looking) is not part of the vocabulary and must not
    // match.
    const html = '<p><strong>[proposed]</strong> Not one of the four tags.</p>';
    expect(applyEpistemicsPills(html, 2)).toBe(html);
  });

  it('ApplyEpistemicsPills_CaseMismatchedTagWord_IsLeftUntouched', () => {
    // Case-sensitive by design (per the closed-set scoping) - a differently-
    // cased occurrence is not the tagging convention's token.
    const html = '<p><strong>[Observed]</strong> and <strong>[OBSERVED]</strong>.</p>';
    expect(applyEpistemicsPills(html, 2)).toBe(html);
  });

  it('ApplyEpistemicsPills_PlainProseSentenceNamingATagWord_IsUnaffected', () => {
    // Ordinary running prose that happens to use one of the four words, with
    // no brackets and no bold wrapping at all, is nowhere near the matched
    // shape.
    const html = '<p>This claim was observed directly in the register export.</p>';
    expect(applyEpistemicsPills(html, 2)).toBe(html);
  });
});
