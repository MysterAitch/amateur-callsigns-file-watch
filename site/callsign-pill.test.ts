// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { callsignPillTitle, callsignPillLink, callsignPillRaw, CALLSIGN_PILL_CLASS, CALLSIGN_CLASS, appendMarkedChars } from './callsign-pill.js';

// The shared callsign pill (issue #310) gives a callsign the same visual
// identity on the hand-authored browser surfaces (index lookup, per-dataset
// entry browser) as the server-side callsignPill gives it on the generated
// pages. These tests pin the rendered markup and, above all, that the pill
// never steals the callsign's accessible name. Test names follow the
// Subject_Scenario_Outcome convention.
//
// Issue #658 closed a confirmed gap #652 flagged: the pill did not carry the
// shared `cs` base class every callsign-family value wears (a callsign, and
// now a prefix series/forbidden suffix) - so every className/outerHTML
// assertion below pins BOTH classes together, not CALLSIGN_PILL_CLASS alone.

// The element factory the front-ends hold (app.js / entry-browser.js), mirrored
// so the pill helpers are exercised exactly as they are in the browser.
function el(tag: string, attrs: Record<string, string> = {}, children: Node[] = []): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) node.append(child);
  return node;
}

describe('callsignPillLink', { tags: ['ui'] }, () => {
  it('CallsignPill_WhenRenderingACallsign_ProducesPillLinkToTheCanonicalPerCallsignPage', () => {
    // issue #594: the pill link's canonical target is callsign.html, not the
    // interactive lookup's own ?c= self-search - every surface that renders a
    // callsign as a link now points inbound at the same per-callsign page.
    const pill = callsignPillLink(el, 'M7TEE');
    expect(pill.tagName).toBe('A');
    expect(pill.className).toBe(`${CALLSIGN_CLASS} ${CALLSIGN_PILL_CLASS}`);
    expect(pill.getAttribute('href')).toBe('callsign.html?c=M7TEE');
    expect(pill.outerHTML).toBe('<a class="cs callsign-pill" href="callsign.html?c=M7TEE">M7TEE</a>');
  });

  it('CallsignPill_WhenRenderingACallsign_AccessibleNameIsTheBareCallsign', () => {
    // The accessible name of a link is its text content; it must be the bare
    // callsign and nothing else, whatever supplementary data the pill carries.
    const pill = callsignPillLink(el, 'M7TEE', { prefixSeries: 'M7', suffix: 'TEE', licenceClass: 'Foundation' });
    expect(pill.textContent).toBe('M7TEE');
  });

  it('CallsignPill_WhenComponentDataProvided_AddsSupplementaryTitleNotAccessibleName', () => {
    const pill = callsignPillLink(el, 'M7TEE', { prefixSeries: 'M7', suffix: 'TEE', licenceClass: 'Foundation' });
    expect(pill.getAttribute('title')).toBe('M7TEE — prefix series M7 · suffix TEE · Foundation');
    // The title is supplementary only - the visible/accessible label stays bare.
    expect(pill.textContent).toBe('M7TEE');
  });

  it('CallsignPill_WhenNoComponentData_OmitsTitleEntirely', () => {
    const pill = callsignPillLink(el, 'M7TEE');
    expect(pill.hasAttribute('title')).toBe(false);
  });

  it('CallsignPill_WhenCallsignHasUnusualCasingAndLength_PreservesItVerbatimAndEncodesHref', () => {
    // Non-happy path: a lowercase, over-long rendering (the register does carry
    // 10-character and lower-cased callsigns) must pass through verbatim as the
    // label, and the href must be percent-encoded so it round-trips.
    const pill = callsignPillLink(el, 'gb100abcde');
    expect(pill.textContent).toBe('gb100abcde');
    expect(pill.getAttribute('href')).toBe('callsign.html?c=gb100abcde');
  });

  it('CallsignPill_WhenCallsignEmpty_ProducesEmptyLabelledPillWithoutTitle', () => {
    // Edge case: an absent/blank callsign yields an empty label rather than a
    // misleading one, and carries no supplementary title.
    const pill = callsignPillLink(el, '');
    expect(pill.textContent).toBe('');
    expect(pill.getAttribute('href')).toBe('callsign.html?c=');
    expect(pill.hasAttribute('title')).toBe(false);
  });
});

describe('callsignPillTitle', { tags: ['ui'] }, () => {
  it('CallsignPillTitle_WhenComponentsPresent_ComposesFactsInServerOrder', () => {
    expect(callsignPillTitle('M7TEE', { prefixSeries: 'M7', rsl: 'W', suffix: 'TEE', licenceClass: 'Foundation' }))
      .toBe('M7TEE — prefix series M7 · RSL W · suffix TEE · Foundation');
  });

  it('CallsignPillTitle_WhenComponentsBlankOrAbsent_ReturnsNull', () => {
    // Blank strings are treated as absent, so a pill with nothing to add stays
    // a plain callsign rather than gaining an empty "M7TEE — " title.
    expect(callsignPillTitle('M7TEE')).toBeNull();
    expect(callsignPillTitle('M7TEE', { prefixSeries: '', suffix: '' })).toBeNull();
  });
});

describe('callsignPillRaw', { tags: ['ui'] }, () => {
  it('CallsignPillRaw_WhenCallsignIsClean_ProducesNonLinkPillWithVerbatimText', () => {
    const pill = callsignPillRaw(el, 'M7TEE');
    expect(pill.tagName).toBe('CODE');
    expect(pill.className).toBe(`${CALLSIGN_CLASS} ${CALLSIGN_PILL_CLASS}`);
    // A non-link chip: no href, so it adds no navigation behaviour.
    expect(pill.hasAttribute('href')).toBe(false);
    expect(pill.textContent).toBe('M7TEE');
  });

  it('CallsignPillRaw_WhenCallsignHasHiddenWhitespace_ShowsVisibleMarkersInsideThePill', () => {
    // Non-happy path: a trailing space must surface as a visible {SP} marker so
    // the raw as-published bytes stop hiding - the transparency the entry
    // browser exists to provide, preserved inside the pill.
    const pill = callsignPillRaw(el, 'M7TEE ');
    const markers = pill.querySelectorAll('.marker');
    expect(markers.length).toBe(1);
    expect(markers[0].textContent).toBe('{SP}');
    expect(pill.textContent).toBe('M7TEE{SP}');
  });

  it('CallsignPillRaw_WhenCallsignEmpty_ProducesEmptyPillWithNoMarkers', () => {
    // Edge case: nothing to iterate, nothing to mark - not an error.
    const pill = callsignPillRaw(el, '');
    expect(pill.textContent).toBe('');
    expect(pill.querySelectorAll('.marker').length).toBe(0);
  });
});

describe('appendMarkedChars', { tags: ['ui'] }, () => {
  // The shared character-marking loop (issue #658) callsignPillRaw above and
  // field-wrappers.js's suffixField both draw on - exercised directly here so
  // its own contract (append onto a CALLER-supplied host, return that host)
  // is pinned independently of either caller.
  it('AppendMarkedChars_WhenValueIsClean_AppendsVerbatimTextAndReturnsTheSameHost', () => {
    const host = el('span');
    const returned = appendMarkedChars(el, host, 'M7TEE');
    expect(returned).toBe(host);
    expect(host.textContent).toBe('M7TEE');
    expect(host.querySelectorAll('.marker').length).toBe(0);
  });

  it('AppendMarkedChars_WhenValueCarriesMixedCleanAndOddCharacters_MarksOnlyTheOddOnes', () => {
    const host = el('span');
    appendMarkedChars(el, host, 'M7 TEE');
    const markers = [...host.querySelectorAll('.marker')];
    expect(markers.length).toBe(1);
    expect(markers[0].textContent).toBe('{NBSP}');
    expect(host.textContent).toBe('M7{NBSP}TEE');
  });

  it('AppendMarkedChars_WhenHostAlreadyHasContent_AppendsAfterRatherThanReplacing', () => {
    // Non-happy path: this is an APPEND, not a replace - a caller building a
    // link that already carries other children keeps them.
    const host = el('a', { href: '#' });
    host.append('prefix-');
    appendMarkedChars(el, host, 'M7TEE');
    expect(host.textContent).toBe('prefix-M7TEE');
  });
});
