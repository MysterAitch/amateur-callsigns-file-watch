import { describe, it, expect } from 'vitest';
import { FIDELITY_PAGE, fidelityHref, fidelityNudge, flagNudges, flagAnchor } from './fidelity.ts';

// The inline fidelity-nudge affordance (issue #438): the small badge that marks
// a rendered value/record as carrying a data-quality observation and links, in
// situ, to the fidelity deep-dive page. These pin the affordance's contract:
// depth-correct hrefs, an accessible name that says where the link goes,
// selective disclosure (no flags -> nothing), the anchor-honesty rule for
// unregistered flags, and escaping against hostile flag names.

const REGISTERED = new Set(['lowercase', 'forbidden-suffix']);

describe('fidelity nudge affordance (issue #438)', { tags: ['ui'] }, () => {
  it('FidelityNudge_OnADeepPage_ResolvesTheHrefToTheSiteRootPage', () => {
    const html = fidelityNudge(3, { section: 'flags', label: 'what flags mean', about: 'what data-quality flags mean' });
    expect(html).toContain(`href="../../../${FIDELITY_PAGE}#flags"`);
    expect(html).toContain('what flags mean');
  });

  it('FidelityNudge_Always_CarriesAVisuallyHiddenExplanationOfWhereItGoes', () => {
    const html = fidelityNudge(0, { section: 'provenance', label: 'more', about: 'how provenance is recorded' });
    // A screen-reader hears where the link lands, never a bare "more".
    expect(html).toContain('class="visually-hidden"');
    expect(html).toContain('how provenance is recorded, on the fidelity and integrity page');
  });

  it('FidelityHref_WithoutAnAnchor_LinksThePageItself', () => {
    expect(fidelityHref(1)).toBe(`../${FIDELITY_PAGE}`);
    expect(fidelityHref(0, 'reverify')).toBe(`${FIDELITY_PAGE}#reverify`);
  });
});

describe('per-record flag nudges (issue #438)', { tags: ['ui'] }, () => {
  it('FlagNudges_RegisteredFlag_DeepLinksToThatFlagsOwnRow', () => {
    const html = flagNudges(['lowercase'], 3, REGISTERED);
    expect(html).toContain(`href="../../../${FIDELITY_PAGE}#flag-lowercase"`);
    // The visible badge is the shared text-badge look; the accessible name says
    // what the flag is and that it is an observation, not a verdict.
    expect(html).toContain('<span class="tb fid">lowercase</span>');
    expect(html).toContain('an observation, not a verdict');
  });

  it('FlagNudges_UnregisteredFlag_LandsOnTheFlagsSectionNotADanglingFragment', () => {
    // A flag missing from reference-data/flags.md has no row (and so no anchor)
    // on the deep-dive page; the nudge still surfaces the observation but lands
    // on the section heading rather than a fragment that does not exist.
    const html = flagNudges(['not-in-registry'], 2, REGISTERED);
    expect(html).toContain(`href="../../${FIDELITY_PAGE}#flags"`);
    expect(html).not.toContain('#flag-not-in-registry');
  });

  it('FlagNudges_RecordWithNoFlags_RendersNothing', () => {
    // Selective disclosure: the affordance never manufactures doubt where no
    // observation exists.
    expect(flagNudges([], 3, REGISTERED)).toBe('');
    expect(flagNudges([''], 3, REGISTERED)).toBe('');
  });

  it('FlagNudges_SeveralFlags_RenderOneBadgeEach', () => {
    const html = flagNudges(['lowercase', 'forbidden-suffix'], 1, REGISTERED);
    expect(html).toContain('#flag-lowercase');
    expect(html).toContain('#flag-forbidden-suffix');
  });

  it('FlagNudges_HostileFlagName_IsEscapedAndItsAnchorSanitised', () => {
    const html = flagNudges(['<img src=x>'], 0, REGISTERED);
    // The name renders escaped, never as live markup...
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x&gt;');
    // ...and (being unregistered) it links the section, whose fragment carries
    // none of the hostile characters.
    expect(html).toContain(`href="${FIDELITY_PAGE}#flags"`);
  });
});

describe('flag anchors', { tags: ['unit'] }, () => {
  it('FlagAnchor_MachineToken_IsTheFlagPrefixedId', () => {
    expect(flagAnchor('excel-date-shape')).toBe('flag-excel-date-shape');
  });

  it('FlagAnchor_NonTokenCharacters_AreStrippedNotEmitted', () => {
    expect(flagAnchor('Weird Flag!<>')).toBe('flag-weirdflag');
  });
});
