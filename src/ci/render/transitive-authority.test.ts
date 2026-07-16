import { describe, it, expect } from 'vitest';
import {
  deriveTransitiveAuthority,
  renderTransitiveAuthority,
  renderDualBadge,
  renderEffectiveSuffix,
  renderInlineSentence,
  transitiveVariantFromEnv,
  TRANSITIVE_VARIANTS,
  DEFAULT_TRANSITIVE_VARIANT,
} from './transitive-authority.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// Transitive authority (#618 increment 4): a corroborating copy borrows a
// higher-authority original's standing, derived on read. The non-negotiables
// hold for every treatment — borrowed authority never shows without its
// derivation marker, the copy's own standing is never overwritten, and the
// derivation link resolves to the correspondence evidence.

describe('deriveTransitiveAuthority — authority only ever elevates through a proven correspondence', { tags: ['unit'] }, () => {
  it('Authority_WhenCorroboratedOriginalIsHigher_ElevatesToItAsDerived', () => {
    const auth = deriveTransitiveAuthority('Reference', 'Official');
    expect(auth.own).toBe('Reference');
    expect(auth.effective).toBe('Official');
    expect(auth.derived).toBe(true);
  });

  it('Authority_WhenNothingCorroborated_StaysAtOwnStandingUnderived', () => {
    const auth = deriveTransitiveAuthority('Reference', undefined);
    expect(auth.effective).toBe('Reference');
    expect(auth.derived).toBe(false);
  });

  it('Authority_WhenCorroboratedOriginalIsNotHigher_DoesNotInflate', () => {
    // A copy whose own ceiling already meets or beats the corroborated original
    // never inflates past it.
    expect(deriveTransitiveAuthority('Official', 'FOI').derived).toBe(false);
    expect(deriveTransitiveAuthority('Official', 'Official').effective).toBe('Official');
  });
});

describe('the three trial treatments — each obeys the non-negotiables', { tags: ['unit'] }, () => {
  const derived = deriveTransitiveAuthority('Reference', 'Official');

  it('DualBadge_WhenDerived_ShowsOwnAndEffectiveWithAMarkerAndEvidenceLink', () => {
    const html = renderDualBadge(derived, 2);
    expect(html).toContain('own: Reference');       // own standing never overwritten
    expect(html).toContain('effective: Official');
    expect(html).toContain('via proven byte-identity'); // derivation marker
    expect(html).toContain('href="../../fidelity.html#show-working"'); // evidence link
  });

  it('EffectiveSuffix_WhenDerived_KeepsOwnStandingAccessibleAndMarksTheDerivation', () => {
    const html = renderEffectiveSuffix(derived, 2);
    expect(html).toContain('Official');
    expect(html).toContain('own standing: Reference'); // own not lost
    expect(html).toContain('via proven byte-identity');
    expect(html).toContain('fidelity.html#show-working');
  });

  it('InlineSentence_WhenDerived_StatesOwnEffectiveAndLinksTheEvidence', () => {
    const html = renderInlineSentence(derived, 2);
    expect(html).toContain('own standing is Reference');
    expect(html).toContain('Official authority');
    expect(html).toContain('fidelity.html#show-working');
  });

  it('EveryTreatment_WhenNotDerived_RendersNothingSoOrdinaryCopiesAreUnchanged', () => {
    const plain = deriveTransitiveAuthority('Official', 'Official');
    for (const variant of TRANSITIVE_VARIANTS) {
      expect(renderTransitiveAuthority(variant, plain, 2)).toBe('');
    }
  });
});

describe('transitiveVariantFromEnv — the build flag selecting a treatment', { tags: ['unit'] }, () => {
  it('Variant_WhenEnvUnset_IsTheRecommendedDefault', () => {
    expect(transitiveVariantFromEnv({})).toBe(DEFAULT_TRANSITIVE_VARIANT);
  });

  it('Variant_WhenEnvNamesAKnownTreatment_SelectsIt', () => {
    expect(transitiveVariantFromEnv({ TRANSITIVE_AUTHORITY_VARIANT: 'inline-sentence' })).toBe('inline-sentence');
  });

  it('Variant_WhenEnvNamesAnUnknownTreatment_FallsBackToTheDefault', () => {
    expect(transitiveVariantFromEnv({ TRANSITIVE_AUTHORITY_VARIANT: 'nonsense' })).toBe(DEFAULT_TRANSITIVE_VARIANT);
  });
});
