import { describe, it, expect } from 'vitest';
import { passesSchemeAllowlist, neutraliseDisallowedScheme } from './safe-url.js';

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
    it(`NeutraliseDisallowedScheme_WhenSchemeIsHostileOrObfuscated_NeutralisesToHash [${label}]`, () => {
      expect(passesSchemeAllowlist(url)).toBe(false);
      expect(neutraliseDisallowedScheme(url)).toBe('#');
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
    it(`NeutraliseDisallowedScheme_WhenRelativeOrHttpsOrMailto_PassesThrough [${JSON.stringify(url)}]`, () => {
      expect(passesSchemeAllowlist(url)).toBe(true);
      expect(neutraliseDisallowedScheme(url)).toBe(url);
    });
  }

  // The two limits the module documents (issue #990) are pinned here, so the
  // narrow claim these functions make cannot quietly be read as a broader one.
  // Both cases below are PASSES by design, recorded as boundaries rather than
  // endorsements: a caller needing more must add its own check on top.
  it('PassesSchemeAllowlist_AnAllowlistedSchemeCarryingAnUntrustedDestination_StillPasses_BecauseOnlyTheSchemeIsChecked', () => {
    // The scheme is cleared; the host, path and authority are not looked at. A
    // surface that must trust the DESTINATION (an outbound redirect target, for
    // instance) cannot delegate that decision to this function.
    for (const url of ['https://untrusted.example/anything', 'http://user:pw@untrusted.example']) {
      expect(passesSchemeAllowlist(url), url).toBe(true);
      expect(neutraliseDisallowedScheme(url), url).toBe(url);
    }
  });

  it('PassesSchemeAllowlist_AValueWithNoParseableScheme_PassesByDefaultAllowRatherThanVerification', () => {
    // A relative reference has no scheme to refuse, so it is allowed by default
    // for ordinary same-site navigation. Nothing positive is established about
    // the value — which is why a true result is not a safety verdict.
    expect(passesSchemeAllowlist('not a url at all')).toBe(true);
  });
});
