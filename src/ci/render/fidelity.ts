/**
 * The inline fidelity-nudge affordance (issue #438): a small, quiet badge that
 * marks a rendered value or record as carrying a data-quality / fidelity
 * observation, IN SITU where the reader already is, and links to the matching
 * section of the fidelity deep-dive page (fidelity.html) for the elaboration.
 *
 * Framing is deliberately calm — the same register as the callsign-lookup
 * dossier's record-fidelity surface (site/ledger.css): a fidelity note LOCATES
 * an observation about what the sources show; it is never a verdict against a
 * record or a licensee. The badge therefore uses the shared text-badge look
 * (`.tb`, ledger.css), not an alarm colour, and its accessible name always says
 * what the reader will find ("about the <flag> data-quality flag"), never a
 * bare glyph.
 *
 * Anchor honesty: a per-flag nudge deep-links to that flag's own row on the
 * deep-dive page ONLY when the flag is a registered one (reference-data/
 * flags.md), because only registered flags get a row (and so an anchor) there.
 * An unregistered flag name still nudges — the observation is real — but lands
 * on the section heading rather than a fragment that does not exist. A dangling
 * fragment would fail the site's internal-link crawl, and rightly so.
 */

import { escapeHtml } from './html.ts';

// The deep-dive page every nudge links into, emitted at the site root by
// src/ci/build-fidelity-page.ts.
export const FIDELITY_PAGE = 'fidelity.html';

// The section anchors the deep-dive page declares. Nudge call sites name these
// rather than free-typing fragments, so a renamed section is a compile error
// here and a crawl failure at worst — never a silently dead link.
export type FidelitySection =
  | 'about'
  | 'provenance'
  | 'flags'
  | 'consistency'
  | 'show-working'
  | 'reconstruction'
  | 'reverify'
  | 'reporting';

// The fragment id of one registered flag's row on the deep-dive page. Flags are
// machine tokens (lowercase letters, digits, hyphens); anything else is
// stripped so a hostile or malformed flag name cannot break out of the id. The
// template return type keeps the nudge's section parameter a closed set:
// either a declared section or a flag-row anchor, never a free-typed fragment.
export type FlagAnchor = `flag-${string}`;
export function flagAnchor(flag: string): FlagAnchor {
  return `flag-${flag.toLowerCase().replace(/[^a-z0-9-]/g, '')}`;
}

// The href to the deep-dive page (optionally a specific fragment) from a page
// `depthToRoot` levels below the site root.
export function fidelityHref(depthToRoot: number, anchor?: string): string {
  return `${'../'.repeat(depthToRoot)}${FIDELITY_PAGE}${anchor === undefined ? '' : `#${anchor}`}`;
}

// A small inline nudge linking a statement to the deep-dive: quiet visible
// label, and an accessible name that says where the link goes. `label` is the
// visible text; `about` completes the visually-hidden sentence ("— <about>, on
// the fidelity and integrity page").
export function fidelityNudge(depthToRoot: number, options: { section: FidelitySection | FlagAnchor; label: string; about: string }): string {
  const href = fidelityHref(depthToRoot, options.section);
  return `<a class="fid-nudge" href="${href}">${escapeHtml(options.label)}`
    + `<span class="visually-hidden"> — ${escapeHtml(options.about)}, on the fidelity and integrity page</span></a>`;
}

// Per-record flag nudges: one badge per data-quality flag a record carries,
// each linking to that flag's row on the deep-dive page (or to the flags
// section when the flag is not in the registry — see the anchor-honesty note
// above). A record with no flags renders NOTHING: selective disclosure, so the
// affordance never manufactures doubt where no observation exists.
export function flagNudges(flags: readonly string[], depthToRoot: number, registeredFlags: ReadonlySet<string>): string {
  return flags
    .filter(flag => flag !== '')
    .map(flag => {
      const section = registeredFlags.has(flag) ? flagAnchor(flag) : 'flags';
      const href = fidelityHref(depthToRoot, section);
      return `<a class="fid-nudge" href="${href}"><span class="tb fid">${escapeHtml(flag)}</span>`
        + `<span class="visually-hidden"> — about the ${escapeHtml(flag)} data-quality flag (an observation, not a verdict), on the fidelity and integrity page</span></a>`;
    })
    .join(' ');
}
