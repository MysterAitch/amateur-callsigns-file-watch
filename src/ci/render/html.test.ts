import { describe, it, expect } from 'vitest';
import { escapeHtml, isSafeUrl, safeUrl, externalLink } from './html.ts';

// The lowest-level render helpers carry two security contracts (issues #966,
// #969): escapeHtml neutralises every HTML metacharacter that could break out
// of an attribute or element, and isSafeUrl/safeUrl allowlist the scheme of any
// URL that reaches an href/src. Test names follow Subject_Scenario_Outcome.

describe('escapeHtml', { tags: ['unit'] }, () => {
  it('EscapeHtml_WhenTextContainsAnApostrophe_EncodesIt', () => {
    // The apostrophe was the one HTML metacharacter the escaper omitted (#966).
    expect(escapeHtml("O'Brien")).toBe('O&#x27;Brien');
  });

  it('EscapeHtml_WhenTextContainsEveryMetacharacter_EncodesAllOfThem', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#x27;');
  });

  it('EscapeHtml_WhenValueSitsInADoubleQuotedAttribute_CannotBreakOut', () => {
    // The escaper's contract assumes a double-quoted attribute; an injected
    // closing quote plus event handler must be inert once escaped.
    const hostile = `" onmouseover="alert(1)`;
    const attribute = `<a title="${escapeHtml(hostile)}">x</a>`;
    // No raw double-quote survives inside the value to close the attribute early.
    expect(attribute).toBe('<a title="&quot; onmouseover=&quot;alert(1)">x</a>');
    expect(attribute).not.toContain('" onmouseover="');
  });

  it('EscapeHtml_WhenTextIsPlain_IsUnchanged', () => {
    expect(escapeHtml('M7TEE Amateur radio call signs')).toBe('M7TEE Amateur radio call signs');
  });
});

describe('isSafeUrl / safeUrl scheme allowlist', { tags: ['unit'] }, () => {
  // Obfuscation vectors drawn from the OWASP/PortSwigger XSS filter-evasion
  // families: the WHATWG parser decodes and normalises each one exactly as a
  // browser would, so allowlisting the parsed scheme catches them all.
  const HOSTILE: Record<string, string> = {
    'plain javascript': 'javascript:alert(1)',
    'mixed case': 'JaVaScRiPt:alert(1)',
    'embedded tab': 'java\tscript:alert(1)',
    'embedded newline': 'java\nscript:alert(1)',
    'leading control char': 'javascript:alert(1)',
    'leading whitespace': '   javascript:alert(1)',
    'data html': 'data:text/html,<script>alert(1)</script>',
    'vbscript': 'vbscript:msgbox(1)',
    'protocol-relative host': '//evil.example/path',
    'backslash open-redirect': '/\\evil.example/path',
    'double-backslash open-redirect': '\\\\evil.example/path',
  };

  for (const [label, url] of Object.entries(HOSTILE)) {
    it(`SafeUrl_WhenSchemeIsHostileOrObfuscated_NeutralisesToHash [${label}]`, () => {
      expect(isSafeUrl(url)).toBe(false);
      expect(safeUrl(url)).toBe('#');
    });
  }

  const SAFE = [
    'https://www.ofcom.org.uk/opendata',
    'HTTPS://WWW.OFCOM.ORG.UK/opendata',
    'http://www.legislation.gov.uk/ukpga/2000/36/section/12', // legit historical link in archived FOI text
    'http://www.ofcom.org.uk/disclaimer/',
    'https://web.archive.org/web/2020/https://ofcom.org.uk/x?a=1&b=2',
    'mailto:open.data@ofcom.org.uk',
    '../datasets/index.html',
    '/datasets/index.html',
    'explore.html?db=x&amp;sql=y',
    '#section',
    '',
  ];

  for (const url of SAFE) {
    it(`SafeUrl_WhenRelativeOrHttpsOrMailto_PassesThrough [${JSON.stringify(url)}]`, () => {
      expect(isSafeUrl(url)).toBe(true);
      expect(safeUrl(url)).toBe(url);
    });
  }
});

describe('externalLink href neutralisation', { tags: ['unit'] }, () => {
  it('ExternalLink_WhenHrefSchemeIsHostile_EmitsInertHash', () => {
    const html = externalLink('javascript:alert(1)', 'click');
    expect(html).toContain('href="#"');
    expect(html).not.toContain('javascript:');
  });

  it('ExternalLink_WhenHrefIsHttps_IsPreservedVerbatim', () => {
    const html = externalLink('https://web.archive.org/web/x?a=1&amp;b=2', 'archived copy');
    expect(html).toContain('href="https://web.archive.org/web/x?a=1&amp;b=2"');
  });
});
