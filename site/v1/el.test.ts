// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { el, serialise } from './el.js';

// A comment whose data begins with the comment-terminator sequence, so a naive
// serialiser that emits the data raw between the delimiters would close the
// comment early and re-introduce a live element carrying an event handler on
// reparse. Held in this test file as executable verification of the refusal.
const COMMENT_TERMINATOR_BREAKOUT = '--><img src=x onerror=alert(1)>';

// The el() DOM-construction foundation (issue #966, ADR 0022): construction
// semantics, the fail-loud residual guards (attribute-name allowlist, URL
// scheme routing, rawtext refusal, void-element correctness), and the
// platform serialiser. The hostile-string corpus sweep lives in
// el.corpus.test.ts; the Node build backend in el.build-backend.test.ts.
// Test names follow Subject_Scenario_Outcome.

describe('v1 el() foundation — construction', { tags: ['ui'] }, () => {
  it('El_TagAttrsAndTextChild_BuildsRealDomWithTheTextEncodedAsText', () => {
    const node = el('span', { class: 'x' }, 'a < b & "c"');
    expect(node.tagName).toBe('SPAN');
    expect(node.getAttribute('class')).toBe('x');
    // The hostile-looking text is a single text node — never parsed as markup.
    expect(node.childNodes.length).toBe(1);
    expect(node.textContent).toBe('a < b & "c"');
  });

  it('El_NestedElChildren_ComposeByPlainFunctionComposition', () => {
    const node = el('p', null, 'before ', el('b', null, 'bold'), ' after');
    expect(node.textContent).toBe('before bold after');
    expect(node.querySelector('b')?.textContent).toBe('bold');
  });

  it('El_NullOrUndefinedChild_SuppressedWithoutRenderingAnything', () => {
    const node = el('p', null, 'a', null, undefined, 'b');
    expect(node.childNodes.length).toBe(2);
    expect(node.textContent).toBe('ab');
  });

  it('El_ArrayChildren_FlattenedInOrderSoMappedListsDropIn', () => {
    const node = el('ul', null, ['x', 'y'].map(t => el('li', null, t)));
    expect([...node.querySelectorAll('li')].map(li => li.textContent)).toEqual(['x', 'y']);
  });

  it('El_NumberChild_RenderedAsItsDecimalText', () => {
    expect(el('span', null, 65).textContent).toBe('65');
  });

  it('El_AttrsOmittedEntirely_RendersTheBareElement', () => {
    expect(el('em').tagName).toBe('EM');
  });

  it('El_BooleanAttrValue_TrueSetsTheBooleanAttribute_FalseOmitsIt', () => {
    expect(el('p', { hidden: true }).hasAttribute('hidden')).toBe(true);
    expect(el('p', { hidden: false }).hasAttribute('hidden')).toBe(false);
  });

  it('El_NullOrUndefinedAttrValue_OmitsTheAttributeForConditionalAttrs', () => {
    const node = el('a', { href: 'x.html', 'aria-current': null, title: undefined });
    expect(node.hasAttribute('aria-current')).toBe(false);
    expect(node.hasAttribute('title')).toBe(false);
    expect(node.getAttribute('href')).toBe('x.html');
  });
});

describe('v1 el() foundation — fail-loud guards', { tags: ['ui'] }, () => {
  it('El_EventHandlerAttributeName_AnyCase_ThrowsRatherThanWiringScript', () => {
    for (const name of ['onclick', 'onerror', 'ONLOAD', 'OnMouseOver', 'onfocusin']) {
      expect(() => el('img', { [name]: 'alert(1)' }), name).toThrow(/event-handler/);
    }
  });

  it('El_UnknownAttributeName_ThrowsSoTheAllowlistGrowsDeliberately', () => {
    for (const name of ['style', 'srcdoc', 'formaction', 'background', 'action']) {
      expect(() => el('div', { [name]: 'x' }), name).toThrow(/allowlist/);
    }
  });

  it('El_AttributeNameDerivedFromHostileData_ThrowsAtTheAllowlist', () => {
    // An attribute NAME must never come from data; a breakout-shaped name is
    // refused before it reaches setAttribute.
    expect(() => el('div', { '"><img src=x onerror=alert(1)>': 'x' })).toThrow(/allowlist/);
  });

  it('El_DataAndAriaPrefixedNames_PassByPattern_ButOnlyLowercaseHyphenated', () => {
    const node = el('div', { 'data-component': 'chip', 'aria-label': 'Journeys' });
    expect(node.getAttribute('data-component')).toBe('chip');
    expect(node.getAttribute('aria-label')).toBe('Journeys');
    expect(() => el('div', { 'data-': 'x' })).toThrow(/allowlist/);
    expect(() => el('div', { 'aria-LABEL': 'x' })).toThrow(/allowlist/);
  });

  it('El_RawtextElements_RefusedOutrightBecauseTheirTextSerialisesUnescaped', () => {
    for (const tag of ['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext', 'noscript']) {
      expect(() => el(tag), tag).toThrow(/rawtext/);
    }
  });

  it('El_ForeignContentRoots_SvgAndMath_RefusedUntilTheirOwnContextExists', () => {
    expect(() => el('svg')).toThrow(/foreign content/);
    expect(() => el('math')).toThrow(/foreign content/);
  });

  it('El_ContextHazardElements_BaseEmbedObject_Refused', () => {
    for (const tag of ['base', 'embed', 'object']) {
      expect(() => el(tag), tag).toThrow(/context/);
    }
  });

  it('El_TemplateElement_Refused_BecauseItsContentFragmentSerialisesApartFromItsChildren', () => {
    // <template> keeps its children in a separate content fragment the serialiser
    // emits, so children appended the ordinary way land in the child-node list
    // and are SILENTLY DROPPED from the output. Refused, so "children vanished"
    // can never happen unnoticed.
    expect(() => el('template')).toThrow(/content fragment|silently dropped/);
    expect(() => el('template', null, el('b', null, 'x'))).toThrow(/content fragment|silently dropped/);
  });

  it('El_InvalidOrNonLowercaseTagName_Throws', () => {
    for (const tag of ['DIV', 'di v', 'a b', '', 'my-widget', '<p>']) {
      expect(() => el(tag), JSON.stringify(tag)).toThrow(/tag name/);
    }
  });

  it('El_VoidElementGivenChildren_Throws', () => {
    expect(() => el('br', null, 'x')).toThrow(/void element/);
    expect(() => el('img', { alt: '' }, el('b', null, 'x'))).toThrow(/void element/);
  });

  it('El_NonNodeObjectOrBooleanChild_ThrowsRatherThanStringifying', () => {
    expect(() => el('p', null, {} as unknown as string)).toThrow(/child/);
    // A `cond && el(...)` slip yields false — refused loudly, never "false" text.
    expect(() => el('p', null, false as unknown as string)).toThrow(/child/);
  });

  it('El_AttrsGivenAsAString_ThrowsRatherThanGuessingItWasAChild', () => {
    expect(() => el('span', 'text' as unknown as null)).toThrow(/attrs/);
  });
});

describe('v1 el() foundation — URL-valued attributes route through the scheme allowlist', { tags: ['ui'] }, () => {
  it('El_HrefWithJavascriptScheme_NeutralisedToTheInertHash', () => {
    expect(el('a', { href: 'javascript:alert(1)' }, 'x').getAttribute('href')).toBe('#');
  });

  it('El_HrefWithObfuscatedJavascriptScheme_TabsNewlinesMixedCase_Neutralised', () => {
    for (const url of ['JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)', ' javascript:alert(1)', 'javascript:alert(1)']) {
      expect(el('a', { href: url }, 'x').getAttribute('href'), JSON.stringify(url)).toBe('#');
    }
  });

  it('El_HrefOrSrcWithDataOrVbscriptScheme_Neutralised', () => {
    expect(el('a', { href: 'data:text/html,<script>alert(1)</script>' }, 'x').getAttribute('href')).toBe('#');
    expect(el('a', { href: 'vbscript:msgbox(1)' }, 'x').getAttribute('href')).toBe('#');
    expect(el('img', { src: 'data:image/svg+xml,<svg onload=alert(1)/>', alt: '' }).getAttribute('src')).toBe('#');
  });

  it('El_HrefProtocolRelativeOrBackslashDisguised_Neutralised', () => {
    for (const url of ['//evil.example/x', '/\\evil.example/x', '\\\\evil.example\\x']) {
      expect(el('a', { href: url }, 'x').getAttribute('href'), JSON.stringify(url)).toBe('#');
    }
  });

  it('El_HrefRelativeHttpsAndMailto_PassThroughUnchanged', () => {
    for (const url of ['callsign.html', '#anchor', '?q=M7TEE', 'https://example.test/x', 'mailto:open.data@ofcom.org.uk']) {
      expect(el('a', { href: url }, 'x').getAttribute('href'), url).toBe(url);
    }
  });

  it('El_CiteAttribute_IsUrlValuedAndGuardedToo', () => {
    expect(el('blockquote', { cite: 'javascript:alert(1)' }, 'q').getAttribute('cite')).toBe('#');
  });
});

describe('v1 el() foundation — the platform serialiser', { tags: ['ui'] }, () => {
  it('Serialise_VoidElements_EmitNoClosingTag', () => {
    expect(serialise(el('br'))).toBe('<br>');
    expect(serialise(el('hr'))).toBe('<hr>');
    expect(serialise(el('img', { src: 'x.png', alt: '' }))).toBe('<img src="x.png" alt="">');
  });

  it('Serialise_TextChildren_EntityEncodedSoMarkupNeverEscapes', () => {
    expect(serialise(el('span', null, '</span><b>&'))).toBe('<span>&lt;/span&gt;&lt;b&gt;&amp;</span>');
  });

  it('Serialise_AttributeValues_QuoteAndAmpersandEncoded', () => {
    expect(serialise(el('span', { title: '"quoted" & <tagged>' }))).toBe('<span title="&quot;quoted&quot; &amp; <tagged>"></span>');
  });

  it('Serialise_SmuggledRawtextNodeInTheTree_RefusedAsDefenceInDepth', () => {
    // Impossible via el() (construction refuses rawtext), but a hand-created
    // node could be appended by other code; serialisation must still refuse.
    const host = el('div', null, 'x');
    host.appendChild(document.createElement('script'));
    expect(() => serialise(host)).toThrow(/rawtext/);
    expect(() => serialise(document.createElement('style'))).toThrow(/rawtext/);
  });

  it('Serialise_SmuggledCommentNodeClosingTheCommentEarly_RefusedBeforeItRevivesAHandler', () => {
    // Impossible via el() (a comment is never a child it builds), but appendChild
    // could smuggle one in. The re-check must walk the WHOLE tree and refuse any
    // node that is not an element or text, so a comment can never reach the
    // serialiser — whose raw emission of comment data would revive live markup.
    const host = el('div', null, 'x');
    host.appendChild(document.createComment(COMMENT_TERMINATOR_BREAKOUT));
    // The danger is real: the raw platform serialisation of this very node, when
    // reparsed the way a browser meeting the static page would, revives an
    // element carrying an on* handler — asserted on the PARSED DOM.
    const leaked = new DOMParser().parseFromString(host.outerHTML, 'text/html');
    const handlerSurvived = [...leaked.querySelectorAll('*')]
      .some(node => [...node.attributes].some(attr => attr.name.toLowerCase().startsWith('on')));
    expect(handlerSurvived, 'the raw serialisation would revive a handler').toBe(true);
    // serialise() refuses the tree, so that markup never ships.
    expect(() => serialise(host)).toThrow(/comment|non-element/);
  });

  it('Serialise_SmuggledCommentAtArbitraryDepth_RefusedAnywhereInTheTree', () => {
    // The reviewer reproduced the smuggle at depth, not only as a direct child —
    // so the walk must reach every descendant, not just the root's children.
    const host = el('div', null, el('section', null, el('p', null, 'x')));
    host.querySelector('p')?.appendChild(document.createComment(COMMENT_TERMINATOR_BREAKOUT));
    expect(() => serialise(host)).toThrow(/comment|non-element/);
  });

  it('Serialise_SmuggledContextHazardBaseNode_RefusedSymmetricallyWithConstruction', () => {
    // Construction refuses <base>; the serialise re-check must refuse it too. A
    // smuggled <base href> hijacks page-wide relative-URL resolution — invisible
    // to the per-attribute URL guard — so a rawtext-only re-check let it pass.
    const host = el('div', null, el('p', null, 'x'));
    const base = document.createElement('base');
    base.setAttribute('href', 'https://example.test/hijack/');
    host.appendChild(base);
    expect(() => serialise(host)).toThrow(/context-hazard|base/);
  });

  it('Serialise_SmuggledForeignContentSvgNode_RefusedSymmetricallyWithConstruction', () => {
    // Construction refuses foreign content (svg/math); the serialise re-check
    // refuses it from the SAME source, so the two layers can never diverge.
    const host = el('div', null, 'x');
    host.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
    expect(() => serialise(host)).toThrow(/foreign content|svg/);
  });

  it('Serialise_SmuggledTemplateNode_RefusedSoItsChildrenCannotBeSilentlyDropped', () => {
    const host = el('div', null, 'x');
    host.appendChild(document.createElement('template'));
    expect(() => serialise(host)).toThrow(/structural-hazard|template|content fragment/);
  });

  it('Serialise_LegitimateElAndTextTree_StillSerialisesUnaffectedByTheWholeTreeCheck', () => {
    // The whole-tree walk must not disturb an ordinary el() tree of elements and
    // text: it serialises exactly as before.
    const node = el('div', { class: 'x' }, 'a ', el('b', null, '1'), ' z');
    expect(serialise(node)).toBe('<div class="x">a <b>1</b> z</div>');
  });

  it('Serialise_AttributeValueContainingQuotes_IsAlwaysDoubleQuotedAndEscaped', () => {
    // Pins the invariant that makes the retired apostrophe-escaping inert by
    // construction: an attribute value is ALWAYS wrapped in double quotes with
    // the double-quote and ampersand entity-encoded, so a value carrying quotes
    // or an apostrophe cannot break out of its quoting. A future serialiser
    // change must not silently invalidate this.
    const value = `he said "hi" — it's fine & <ok>`;
    const html = serialise(el('span', { title: value }));
    expect(html).toBe(`<span title="he said &quot;hi&quot; — it's fine &amp; <ok>"></span>`);
    // Parsed-DOM proof: one element, one attribute, value round-trips intact —
    // no attribute broke out of the double-quoted value.
    const reparsed = new DOMParser().parseFromString(html, 'text/html').body.firstElementChild;
    expect(reparsed?.attributes.length).toBe(1);
    expect(reparsed?.getAttribute('title')).toBe(value);
  });

  it('Serialise_NonElementInput_Throws', () => {
    expect(() => serialise({} as unknown as Element)).toThrow(/element/);
    expect(() => serialise(document.createTextNode('x') as unknown as Element)).toThrow(/element/);
  });

  it('Serialise_ThenReparse_YieldsTheIdenticalTreeShape', () => {
    // Render-backend fidelity (ADR 0022): the serialised form re-parses to the
    // same structure — asserted on the parsed DOM, not string equality.
    const built = el('p', { class: 'note', 'data-component': 'x' }, 'a ', el('b', null, '1'), ' z');
    const reparsed = new DOMParser().parseFromString(serialise(built), 'text/html').body.firstElementChild;
    expect(reparsed?.tagName).toBe(built.tagName);
    expect(reparsed?.getAttribute('class')).toBe('note');
    expect(reparsed?.getAttribute('data-component')).toBe('x');
    expect(reparsed?.textContent).toBe(built.textContent);
    expect(reparsed?.querySelector('b')?.textContent).toBe('1');
  });
});
