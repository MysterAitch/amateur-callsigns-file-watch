/**
 * The shared licence class/category field wrapper (issue #553): one helper
 * for EVERY licence value displayed on a generated page — the implied class
 * (Foundation / Intermediate / Full, derived from the callsign's prefix), the
 * declared product a source publishes verbatim ('Amateur Full Radio Licence',
 * an FOI 'Licence Class'/'Licence Product' column, or similar) — so the
 * family reads consistently and per-surface truncation never silently hides
 * the raw value.
 *
 * Unlike ./status.ts, this wrapper does NOT auto-crosslink individual values
 * to the glossary: the glossary defines the licence-class AXIS once
 * ('licence-class', "Foundation, Intermediate, Full"), not a separate entry
 * per value, and every table/section that shows a licence-level breakdown
 * already glossary-links its OWN heading via glossaryTerm('licence-class', …)
 * — repeating that same single link on every "Foundation" cell beside it
 * would be a link to nowhere new, not a new affordance.
 */

import { escapeHtml } from './html.ts';

// The single source of truth for the wrapper's stable CSS class: every
// licence-class/category value rendered as content carries it.
export const LICENCE_CLASS = 'lic';

// How much of a declared licence string a surface shows.
//  - 'as-declared' (the DEFAULT): the value renders EXACTLY as published -
//    the transparency-first choice, since a source's own product vocabulary
//    ('Amateur Full Radio Licence') is itself a fact worth showing whole.
//  - 'shortened': strips the source's boilerplate wrapper ('Amateur ' … '
//    Radio Licence') down to the bare level name ('Full'), for a compact
//    breakdown row where the boilerplate would repeat on every line. The
//    stripped-away text is never lost: it rides in the element's title.
export type LicenceForm = 'as-declared' | 'shortened';

export interface LicenceFieldOptions {
  // Which form to render. Omitting it FOLLOWS THE DEFAULT ('as-declared'),
  // which may move over time. DRIFT-GUARD (#553): a usage that genuinely
  // REQUIRES the shortened form (a breakdown row tight on width) must state
  // it here explicitly - even where it matches today's reasoning - so a later
  // change to the default cannot silently alter it. A usage happy to show the
  // value exactly as published passes nothing.
  form?: LicenceForm;
  // What a blank licence value reads as. A blank value is itself information
  // (the source published the row with no product/class stated), so it is
  // never rendered as an empty element - it is humanised to this label
  // (default '(blank)', matching the site-wide humanise-blanks convention). A
  // surface with an established wording pins it here.
  blankLabel?: string;
  // Extra class(es) appended after the stable class, for a surface that needs
  // to target a specific licence value without disturbing the shared visual.
  extraClass?: string;
}

const PRODUCT_PREFIX_RE = /^Amateur /;
const PRODUCT_SUFFIX_RE = / Radio Licence$/;

// The visible text a `licenceField` would show, without the surrounding
// element or its title - exposed for callers that need the label alone (e.g.
// an SVG chart's <text> tick, or a caller composing its own markup).
export function licenceDisplay(value: string, form: LicenceForm = 'as-declared'): string {
  if (form === 'as-declared' || value === '') return value;
  return value.replace(PRODUCT_PREFIX_RE, '').replace(PRODUCT_SUFFIX_RE, '');
}

// The shared licence class/category field wrapper (#553). Emits one of:
//   <em class="lic lic-blank">(blank)</em>       - a blank value, humanised
//   <span class="lic">…value…</span>             - the value as-declared (default)
//   <span class="lic" title="…raw…">…short…</span> - the shortened form, raw value in the title
// The stable class is always present; the shortened form never DROPS the raw
// value - it always carries it in the title, so nothing published is hidden,
// only abbreviated on screen. See LicenceFieldOptions for the drift-guard rule.
export function licenceField(value: string, options: LicenceFieldOptions = {}): string {
  const extra = options.extraClass === undefined ? '' : ` ${options.extraClass}`;
  if (value === '') {
    const label = options.blankLabel ?? '(blank)';
    return `<em class="${LICENCE_CLASS} lic-blank${escapeHtml(extra)}">${escapeHtml(label)}</em>`;
  }
  const form = options.form ?? 'as-declared';
  const shown = licenceDisplay(value, form);
  const titleAttr = shown !== value ? ` title="${escapeHtml(value)}"` : '';
  return `<span class="${LICENCE_CLASS}${escapeHtml(extra)}"${titleAttr}>${escapeHtml(shown)}</span>`;
}
