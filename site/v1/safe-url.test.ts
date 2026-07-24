import { describe, it, expect } from 'vitest';
import { isSafeUrl, safeHref } from './safe-url.js';

// The browser twin of src/ci/render/html.ts's URL allowlist (issue #969). It
// must neutralise the same obfuscated scheme vectors by PARSING, not string
// matching. Test names follow Subject_Scenario_Outcome.

describe('v1 safe-url scheme allowlist (JS)', { tags: ['unit'] }, () => {
  const HOSTILE: Record<string, string> = {
    'plain javascript': 'javascript:alert(1)',
    'mixed case': 'JaVaScRiPt:alert(1)',
    'embedded tab': 'java\tscript:alert(1)',
    'embedded newline': 'java\nscript:alert(1)',
    'data html': 'data:text/html,<script>alert(1)</script>',
    'vbscript': 'vbscript:msgbox(1)',
    'protocol-relative host': '//evil.example/x',
    'backslash open-redirect': '/\\evil.example/x',
    'double-backslash open-redirect': '\\\\evil.example/x',
  };

  for (const [label, url] of Object.entries(HOSTILE)) {
    it(`SafeHref_WhenSchemeIsHostileOrObfuscated_NeutralisesToHash [${label}]`, () => {
      expect(isSafeUrl(url)).toBe(false);
      expect(safeHref(url)).toBe('#');
    });
  }

  const SAFE = [
    'https://www.ofcom.org.uk/opendata',
    'http://www.ofcom.org.uk/disclaimer/', // legit historical link in archived FOI text
    'mailto:open.data@ofcom.org.uk',
    '../datasets/index.html',
    '/datasets/index.html',
    '#section',
    '',
  ];

  for (const url of SAFE) {
    it(`SafeHref_WhenRelativeOrHttpsOrMailto_PassesThrough [${JSON.stringify(url)}]`, () => {
      expect(isSafeUrl(url)).toBe(true);
      expect(safeHref(url)).toBe(url);
    });
  }
});
