/**
 * The shared register-status field wrapper (issue #553): one helper for EVERY
 * `status` value displayed on a generated page (Allocated / Reserved /
 * Available / Forbidden / Live / Quarantine / a blank cell), so a status
 * reads the same wherever it appears and, where the glossary defines that
 * exact value, is one click from its definition.
 *
 * The register's controlled statuses already have their own glossary entries
 * (site/glossary.html#status, registered in ./glossary.ts as 'allocated',
 * 'reserved', 'available', 'status-live', 'status-forbidden',
 * 'status-quarantine'); this wrapper is what actually crosslinks a RENDERED
 * value to its definition, rather than only the section heading above a table
 * of them. A value the glossary does not define (a future status the mirror
 * has not catalogued yet) renders as plain text — never a fabricated link.
 *
 * Deliberately no odd-character marking (unlike ./callsign.ts): a status is a
 * short controlled-vocabulary token, not free text carrying whitespace/control
 * damage worth flagging value-by-value.
 */

import { escapeHtml } from './html.ts';
import { glossaryTerm, type GlossaryAnchor } from './glossary.ts';

// The single source of truth for the wrapper's stable CSS class: every status
// value rendered as content carries it, so the stylesheet targets one selector.
export const STATUS_CLASS = 'stat';

// Whether a RECOGNISED status value (one with its own anchor, per
// STATUS_GLOSSARY_ANCHOR below) is crosslinked to its glossary definition.
//  - 'linked' (the default): a bounded list of DISTINCT status values — a
//    breakdown, a summary table — reads better with each one a click from its
//    definition.
//  - 'plain': no linking at all. A usage that repeats the SAME status across
//    many PER-RECORD rows (a per-callsign listing, a raw CSV-row preview)
//    genuinely requires this — repeating the glossary affordance (and its
//    "(definition of … in the glossary)" accessible text) on every one of a
//    few hundred rows would be noise, not help. Also required inside a
//    click-to-filter row (role="button"): a nested <a> there is a nested-
//    interactive-control anti-pattern the register-status breakdown avoids.
export type StatusGlossaryLinking = 'linked' | 'plain';

export interface StatusFieldOptions {
  // Where to resolve the glossary link from (site root depth), mirroring the
  // CallsignFieldOptions `lookup.depthToRoot` convention. Omitted, no link is
  // possible (there is nowhere to resolve `glossary.html` from) and the value
  // renders as plain text regardless of `glossaryLinking`.
  depthToRoot?: number;
  // How a recognised status value is crosslinked. Omitting it FOLLOWS THE
  // DEFAULT ('linked'), which may move over time. DRIFT-GUARD (#553): a usage
  // that genuinely REQUIRES plain text must state it here explicitly - even
  // where 'plain' happens to match today's default reasoning - so a later
  // change to the default cannot silently alter it. See StatusGlossaryLinking
  // for when plain text is actually required, not just preferred.
  glossaryLinking?: StatusGlossaryLinking;
  // What a blank status reads as. A blank value is itself information (the
  // source published the row with no status), so it is never rendered as an
  // empty element — it is humanised to this label (default '(blank)',
  // matching the site-wide humanise-blanks convention). A surface that
  // REQUIRES its own wording (e.g. a synthetic "(unknown)" placeholder for a
  // callsign this vintage never carried a status for at all) pins it here.
  blankLabel?: string;
  // Extra class(es) appended after the stable class, for a surface that needs
  // to target a specific status without disturbing the shared visual.
  extraClass?: string;
}

// Every register status value the glossary defines (site/glossary.html#status),
// mapped to its anchor. 'Allocated' / 'Reserved' / 'Available' have an
// established meaning there; 'Live' / 'Forbidden' / 'Quarantine' are observed
// values the glossary honestly states have NO canonical meaning established -
// still worth a link, so a reader lands on that honest explanation rather than
// guessing. Anything else (a future value, a typo, a stray FOI-only string) is
// unrecognised and renders as plain text: never a fabricated link.
const STATUS_GLOSSARY_ANCHOR: Partial<Record<string, GlossaryAnchor>> = {
  Allocated: 'allocated',
  Reserved: 'reserved',
  Available: 'available',
  Live: 'status-live',
  Forbidden: 'status-forbidden',
  Quarantine: 'status-quarantine',
};

// The visible text a `statusField` would show, without the surrounding
// element or any glossary link - exposed for callers that need the label
// alone (e.g. an SVG chart's <text> tick, which cannot nest an <a>).
export function statusDisplay(value: string, blankLabel = '(blank)'): string {
  return value === '' ? blankLabel : value;
}

// The shared register-status field wrapper (#553). Emits one of:
//   <em class="stat stat-blank">(blank)</em>                     - a blank value, humanised
//   <span class="stat">…value…</span>                            - plain text
//   <span class="stat"><a class="gloss-term" href="…">…</a></span> - a recognised, linked value
// The stable class is always present; see StatusFieldOptions for the
// glossary-linking drift-guard rule.
export function statusField(value: string, options: StatusFieldOptions = {}): string {
  const extra = options.extraClass === undefined ? '' : ` ${options.extraClass}`;
  if (value === '') {
    const label = options.blankLabel ?? '(blank)';
    return `<em class="${STATUS_CLASS} stat-blank${escapeHtml(extra)}">${escapeHtml(label)}</em>`;
  }
  const linking = options.glossaryLinking ?? 'linked';
  const anchor = STATUS_GLOSSARY_ANCHOR[value];
  if (linking === 'linked' && anchor !== undefined && options.depthToRoot !== undefined) {
    return `<span class="${STATUS_CLASS}${escapeHtml(extra)}">${glossaryTerm(anchor, options.depthToRoot, { label: value })}</span>`;
  }
  return `<span class="${STATUS_CLASS}${escapeHtml(extra)}">${escapeHtml(value)}</span>`;
}
