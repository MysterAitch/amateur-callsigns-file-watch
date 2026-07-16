/**
 * Transitive authority surfacing (issue #618 increment 4).
 *
 * A copy's OWN standing is its direct authority — the ceiling of the publisher
 * it was witnessed through (ADR 0014). When that copy is shown byte-identical to
 * a higher-authority original (a corroborating witness, increment 3), it
 * transitively benefits from that correspondence: its EFFECTIVE authority is the
 * original's, derived on read from the hash match, never stored. Removing the
 * higher-authority reference reverts the dependant automatically.
 *
 * Non-negotiables, whichever treatment renders it (settled on #618):
 *  - borrowed authority NEVER displays without its derivation marker;
 *  - the copy's OWN standing is never overwritten;
 *  - the derivation link resolves to the correspondence evidence (the hash
 *    match) through the show-working affordance.
 *
 * Three candidate treatments are implemented for the maintainer trial; the
 * default is the recommended one. All three obey the non-negotiables.
 */

import { escapeHtml } from './html.ts';
import { fidelityHref } from './fidelity.ts';
import { authorityRank, type SourceAuthority } from '../../shared/source-authority.ts';

// The candidate treatments trialled on #618. The default is the recommended one;
// a build may override via the TRANSITIVE_AUTHORITY_VARIANT env var so all three
// can be rendered from identical data for side-by-side review.
export type TransitiveVariant = 'dual-badge' | 'effective-suffix' | 'inline-sentence';
export const TRANSITIVE_VARIANTS: readonly TransitiveVariant[] = ['dual-badge', 'effective-suffix', 'inline-sentence'];
export const DEFAULT_TRANSITIVE_VARIANT: TransitiveVariant = 'dual-badge';

export function transitiveVariantFromEnv(env: NodeJS.ProcessEnv = process.env): TransitiveVariant {
  const raw = env.TRANSITIVE_AUTHORITY_VARIANT;
  return TRANSITIVE_VARIANTS.includes(raw as TransitiveVariant) ? (raw as TransitiveVariant) : DEFAULT_TRANSITIVE_VARIANT;
}

// The derived authority of one copy: its own standing, and (when a corroborating
// correspondence lifts it) the effective standing plus the reason.
export interface TransitiveAuthority {
  own: SourceAuthority;
  effective: SourceAuthority;
  // True iff effective was lifted above own by a proven correspondence — the
  // only case a borrowed-authority marker is shown.
  derived: boolean;
  // The correspondence that lifted it, e.g. "proven byte-identity".
  via: string;
}

// Derive a copy's effective authority. `own` is the ceiling of the publisher the
// copy was witnessed through; `corroboratedAuthority` is the authority of the
// held copy this one is proven byte-identical to (undefined when it corroborates
// nothing). Authority only ever ELEVATES here and only through a proven
// correspondence — never lowers, never inflates past the corroborated original.
export function deriveTransitiveAuthority(
  own: SourceAuthority,
  corroboratedAuthority: SourceAuthority | undefined,
  via = 'proven byte-identity',
): TransitiveAuthority {
  if (corroboratedAuthority !== undefined && authorityRank(corroboratedAuthority) < authorityRank(own)) {
    return { own, effective: corroboratedAuthority, derived: true, via };
  }
  return { own, effective: own, derived: false, via };
}

// The show-working evidence link the derivation marker always points at: the
// correspondence (hash match) that lifted the authority, on the fidelity page.
function evidenceHref(depthToRoot: number): string {
  return fidelityHref(depthToRoot, 'show-working');
}

function derivedLink(depthToRoot: number, label: string): string {
  return `<a class="derived-derivation" href="${evidenceHref(depthToRoot)}">${escapeHtml(label)}<span class="visually-hidden"> — see the correspondence evidence (the matching sha256) on the fidelity and integrity page</span></a>`;
}

// --- Variant A: dual badge (own + effective) --------------------------------
// The copy's own standing is primary; the effective standing renders as a
// second, visually-distinct derived badge that always carries its marker.
export function renderDualBadge(auth: TransitiveAuthority, depthToRoot: number): string {
  const ownBadge = `<span class="tb auth-own">own: ${escapeHtml(auth.own)}</span>`;
  if (!auth.derived) return ownBadge;
  const effectiveBadge = `<span class="tb auth-effective">effective: ${escapeHtml(auth.effective)}</span>`;
  return `${ownBadge} ${effectiveBadge} <small class="gap">(${derivedLink(depthToRoot, `via ${auth.via}`)})</small>`;
}

// --- Variant B: single effective badge with a via-suffix --------------------
// One badge shows the effective standing with the derivation in a suffix; the
// own standing stays accessible in the badge's title/aside so it is never lost.
export function renderEffectiveSuffix(auth: TransitiveAuthority, depthToRoot: number): string {
  if (!auth.derived) return `<span class="tb auth-own">${escapeHtml(auth.own)}</span>`;
  return `<span class="tb auth-effective">${escapeHtml(auth.effective)} — ${derivedLink(depthToRoot, `via ${auth.via}`)}</span>`
    + ` <small class="gap">(own standing: ${escapeHtml(auth.own)})</small>`;
}

// --- Variant C: inline sentence ---------------------------------------------
// No badge; a short sentence states own, the correspondence, and the effective
// standing, with the evidence linked.
export function renderInlineSentence(auth: TransitiveAuthority, depthToRoot: number): string {
  if (!auth.derived) return `<small class="gap">Own standing: ${escapeHtml(auth.own)}.</small>`;
  return `<small class="gap">This copy's own standing is ${escapeHtml(auth.own)}; shown byte-identical to the ${escapeHtml(auth.effective)} publication, so it carries ${escapeHtml(auth.effective)} authority here — ${derivedLink(depthToRoot, `derived, ${auth.via}`)}.</small>`;
}

// Dispatch to the chosen treatment. Returns '' when nothing is borrowed (no
// derived elevation), so an ordinary copy with no transitive lift renders
// unchanged — the treatment appears only where authority is actually borrowed,
// and always carries its derivation marker.
export function renderTransitiveAuthority(variant: TransitiveVariant, auth: TransitiveAuthority, depthToRoot: number): string {
  if (!auth.derived) return '';
  switch (variant) {
    case 'dual-badge': return renderDualBadge(auth, depthToRoot);
    case 'effective-suffix': return renderEffectiveSuffix(auth, depthToRoot);
    case 'inline-sentence': return renderInlineSentence(auth, depthToRoot);
  }
}
