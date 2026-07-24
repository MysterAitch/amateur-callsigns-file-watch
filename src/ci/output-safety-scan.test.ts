import { describe, it, expect } from 'vitest';
import { findUnsafeSinks } from './output-safety-scan.ts';

// The build-output safety scan (issue #969) parses each page with parse5 - the
// browser's HTML5 parser - so attribute values are decoded exactly as a browser
// would decode them (including semicolon-less character references and unquoted
// attributes) before their scheme is read. These self-tests prove it catches
// the obfuscation families a hand-rolled decoder or a substring grep would miss.
// Test names follow Subject_Scenario_Outcome.

describe('output-safety scan — hostile fixtures', { tags: ['unit'] }, () => {
  // Each entry is one url-attribute obfuscation vector the scan must flag; the
  // parser decodes it to a javascript:/data: scheme the allowlist rejects.
  const UNSAFE_URL_VECTORS: Record<string, string> = {
    'plain javascript': '<a href="javascript:alert(1)">x</a>',
    'entity-encoded javascript (with semicolon)': '<a href="&#106;avascript:alert(1)">x</a>',
    // The bypass a semicolon-REQUIRING decoder misses: browsers (and parse5)
    // decode a numeric character reference with NO trailing semicolon, so
    // `&#106avascript:` becomes `javascript:` and would execute.
    'entity-encoded javascript (semicolon-less)': '<a href="&#106avascript:alert(1)">x</a>',
    'hex entity javascript': '<a href="&#x6a;avascript:alert(1)">x</a>',
    'entity tab inside scheme': '<a href="java&#9;script:alert(1)">x</a>',
    'entity newline inside scheme': '<a href="java&#10;script:alert(1)">x</a>',
    'unquoted javascript attribute': '<a href=javascript:alert(1)>x</a>',
    'leading/trailing whitespace': '<a href="  javascript:alert(1)  ">x</a>',
    'mixed case scheme': '<a href="JaVaScRiPt:alert(1)">x</a>',
    'data html': '<img src="data:text/html,alert(1)">',
    'vbscript': '<a href="vbscript:msgbox(1)">x</a>',
    'protocol-relative host': '<a href="//evil.example/x">x</a>',
  };

  for (const [label, html] of Object.entries(UNSAFE_URL_VECTORS)) {
    it(`Scan_WhenUrlAttributeIsHostileOrObfuscated_FlagsUnsafeUrl [${label}]`, () => {
      const sinks = findUnsafeSinks(html, { allowInlineScripts: false });
      expect(sinks.some(s => s.kind === 'unsafe-url')).toBe(true);
    });
  }

  it('Scan_WhenAttributeIsAnInlineEventHandler_FlagsEventHandler', () => {
    const sinks = findUnsafeSinks('<button onclick="steal()">go</button>', { allowInlineScripts: false });
    expect(sinks.some(s => s.kind === 'event-handler')).toBe(true);
  });

  it('Scan_WhenEventHandlerAttributeIsMixedCaseAndUnquoted_StillFlagsEventHandler', () => {
    const sinks = findUnsafeSinks('<img src="/ok.png" OnErRoR=x()>', { allowInlineScripts: false });
    expect(sinks.some(s => s.kind === 'event-handler')).toBe(true);
  });

  it('Scan_WhenPageHasInlineScriptAndTheyAreDisallowed_FlagsInlineScript', () => {
    const sinks = findUnsafeSinks('<script>evil()</script>', { allowInlineScripts: false });
    expect(sinks.some(s => s.kind === 'inline-script')).toBe(true);
  });
});

describe('output-safety scan — benign fixtures', { tags: ['unit'] }, () => {
  it('Scan_WhenPageUsesOnlyHttpsAndRelativeLinks_FindsNothing', () => {
    const html = [
      '<a href="https://www.ofcom.org.uk/opendata">source</a>',
      '<a href="../datasets/index.html">datasets</a>',
      '<a href="#anchor">jump</a>',
      '<img src="/assets/logo.png">',
      '<script src="app.js"></script>',
    ].join('');
    expect(findUnsafeSinks(html, { allowInlineScripts: false })).toEqual([]);
  });

  it('Scan_WhenInlineScriptsAreAllowed_DoesNotFlagThem', () => {
    const html = '<script>bootstrap()</script>';
    expect(findUnsafeSinks(html, { allowInlineScripts: true })).toEqual([]);
  });

  it('Scan_WhenIconIsAnImageDataUri_DoesNotFlagIt', () => {
    // The static pages' inline SVG favicon is a safe image data URI.
    const html = `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E">`;
    expect(findUnsafeSinks(html, { allowInlineScripts: false })).toEqual([]);
  });

  it('Scan_WhenDataUriIsTextHtmlNotImage_StillFlagsIt', () => {
    // The image carve-out must not widen to the dangerous text/html data URI.
    const sinks = findUnsafeSinks('<a href="data:text/html,<b>x</b>">x</a>', { allowInlineScripts: false });
    expect(sinks.some(s => s.kind === 'unsafe-url')).toBe(true);
  });
});
