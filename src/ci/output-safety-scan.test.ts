import { describe, it, expect } from 'vitest';
import { findUnsafeSinks } from './output-safety-scan.ts';

// The build-output safety scan (issue #969) entity-decodes each attribute value
// before reading its scheme, so it catches payloads a substring grep would miss.
// These self-tests prove that on obfuscated fixtures. Test names follow
// Subject_Scenario_Outcome.

describe('output-safety scan — hostile fixtures', { tags: ['unit'] }, () => {
  it('Scan_WhenHrefIsPlainJavascriptScheme_FlagsUnsafeUrl', () => {
    const sinks = findUnsafeSinks('<a href="javascript:alert(1)">x</a>', { allowInlineScripts: false });
    expect(sinks.some(s => s.kind === 'unsafe-url')).toBe(true);
  });

  it('Scan_WhenHrefIsEntityEncodedJavascript_StillFlagsUnsafeUrl', () => {
    // A substring grep for "javascript:" misses this; the DOM parse decodes
    // &#106; -> j before the scheme is read.
    const sinks = findUnsafeSinks('<a href="&#106;avascript:alert(1)">x</a>', { allowInlineScripts: false });
    expect(sinks.some(s => s.kind === 'unsafe-url')).toBe(true);
  });

  it('Scan_WhenHrefHasEntityEncodedTabInsideScheme_StillFlagsUnsafeUrl', () => {
    // java&#9;script: — the tab entity decodes and the URL parser strips it.
    const sinks = findUnsafeSinks('<a href="java&#9;script:alert(1)">x</a>', { allowInlineScripts: false });
    expect(sinks.some(s => s.kind === 'unsafe-url')).toBe(true);
  });

  it('Scan_WhenSrcIsDataHtml_FlagsUnsafeUrl', () => {
    const sinks = findUnsafeSinks('<img src="data:text/html,<script>alert(1)</script>">', { allowInlineScripts: false });
    expect(sinks.some(s => s.kind === 'unsafe-url')).toBe(true);
  });

  it('Scan_WhenHrefIsProtocolRelative_FlagsUnsafeUrl', () => {
    const sinks = findUnsafeSinks('<a href="//evil.example/x">x</a>', { allowInlineScripts: false });
    expect(sinks.some(s => s.kind === 'unsafe-url')).toBe(true);
  });

  it('Scan_WhenAttributeIsAnInlineEventHandler_FlagsEventHandler', () => {
    const sinks = findUnsafeSinks('<button onclick="steal()">go</button>', { allowInlineScripts: false });
    expect(sinks.some(s => s.kind === 'event-handler')).toBe(true);
  });

  it('Scan_WhenEventHandlerAttributeIsMixedCase_StillFlagsEventHandler', () => {
    const sinks = findUnsafeSinks('<img src="/ok.png" OnErRoR="x()">', { allowInlineScripts: false });
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
