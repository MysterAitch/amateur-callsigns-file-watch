/**
 * The shared prefix-series field wrapper (issue #644): one helper for EVERY
 * callsign prefix series displayed on a generated page (a series breakdown
 * row, a per-series page's own heading, the series index table, the RSL
 * matrix's row labels), so a series reads with the SAME visual identity as
 * the callsign it is a fragment of — the family's own precedent (#553) for
 * why a callsign, a licence value and a status value each carry one stable
 * class wherever they appear.
 *
 * A series name is stored BARE everywhere (20, M7, G0): `displaySeries`
 * inserts the `#` RSL-slot marker purely for display, after the leading
 * character, matching the site-wide convention already established in
 * site/app.js's own `displaySeries` and the pre-#644 copy this module
 * replaces. `form: 'bare'` opts out for a context that means the raw stored
 * key itself (e.g. explaining the storage convention, or matching a value
 * that must equal the stored identity).
 *
 * Deliberately no odd-character marking (unlike ./callsign.ts and
 * ./suffix.ts): a prefix series is never raw free text lifted verbatim from
 * a published column — it is either hand-curated reference data
 * (reference-data/prefix-formats.csv) or set by the build-time parser only
 * once a callsign has been recognised as a standard UK form, so its
 * character set is already controlled at the point this wrapper ever sees
 * it. Marking a bounded, already-validated vocabulary character-by-character
 * would invite false alarms rather than surface real damage — the same
 * reasoning ./status.ts gives for its own controlled vocabulary.
 */

import { escapeHtml } from './html.ts';
import { CALLSIGN_CLASS } from './callsign.ts';

// The stable class every prefix-series value carries alongside the shared
// callsign base class (CALLSIGN_CLASS): the pairing is what gives a series
// the SAME visual identity as a callsign (issue #644), while still letting
// the stylesheet target series values on their own where it needs to.
export const PREFIX_SERIES_CLASS = 'cs-pfx';

// How a prefix series is shown.
//  - 'displayed' (the DEFAULT): the `#` RSL-slot marker is inserted after the
//    leading character (M7 -> M#7), the uniform display convention used
//    site-wide.
//  - 'bare': the stored value exactly as kept in the data, with no `#`
//    inserted - a usage that genuinely needs the raw stored identity (e.g.
//    contrasting it against the displayed form) states this explicitly.
export type PrefixSeriesForm = 'displayed' | 'bare';

// The visible text a `prefixSeriesField` would show, without the surrounding
// element - exposed for a caller that needs the label alone (e.g. an
// aria-label, or a caller composing its own markup). Mirrors the pre-#644
// `displaySeries` this module now replaces as the single source of truth.
export function prefixSeriesDisplay(value: string, form: PrefixSeriesForm = 'displayed'): string {
  if (form === 'bare' || value === '' || value.includes('#') || value.length < 2) return value;
  return `${value[0]}#${value.slice(1)}`;
}

// URL-safe slug for a prefix series' entity page (series/<slug>.html). Names
// are stored bare, so this is normally the identity; the `#` strip stays as a
// guard for any display-form input reaching here directly.
export function prefixSeriesSlug(series: string): string {
  return series.replace(/#/g, '');
}

export interface PrefixSeriesFieldOptions {
  // Which form to render. Omitting it FOLLOWS THE DEFAULT ('displayed'),
  // which may move over time. DRIFT-GUARD (#644, following the #553
  // convention): a usage that genuinely REQUIRES the bare form must state it
  // here explicitly - even where it matches today's reasoning - so a later
  // change to the default cannot silently alter it.
  form?: PrefixSeriesForm;
  // The series entity-page crosslink, opt-in where the context wants one:
  // the wrapper renders as a link to `series/<slug>.html` resolved
  // `depthToRoot` levels up. Omitted, the series is plain content to read,
  // not a navigation target. A blank value or one whose slug resolves empty
  // never manufactures a link even when this is given - there is no page to
  // point at.
  link?: { depthToRoot: number };
  // What a blank prefix series reads as. A blank value is itself information
  // (an unparseable callsign has no series), so it is never rendered as an
  // empty element - it is humanised to this label (default '(blank)',
  // matching the site-wide humanise-blanks convention). A surface with an
  // established wording pins it here.
  blankLabel?: string;
  // Extra class(es) appended after the stable classes, for a surface that
  // needs to target a specific series value without disturbing the shared
  // visual.
  extraClass?: string;
}

// The shared prefix-series field wrapper (#644). Emits one of:
//   <em class="cs cs-pfx-blank">(blank)</em>          - a blank value, humanised
//   <span class="cs cs-pfx">…value…</span>            - plain content (default)
//   <a class="cs cs-pfx" href="…series/…">…value…</a> - the opt-in series-page link
// The stable classes are always present (except on the blank form, which
// never gets the pfx modifier's own visual since there is no series text to
// carry it — matching cs-blank's own no-styling precedent). See
// PrefixSeriesFieldOptions for the drift-guard rule.
export function prefixSeriesField(value: string, options: PrefixSeriesFieldOptions = {}): string {
  const extra = options.extraClass === undefined ? '' : ` ${options.extraClass}`;
  if (value === '') {
    const label = options.blankLabel ?? '(blank)';
    return `<em class="${CALLSIGN_CLASS} ${PREFIX_SERIES_CLASS}-blank${escapeHtml(extra)}">${escapeHtml(label)}</em>`;
  }
  const form = options.form ?? 'displayed';
  const shown = prefixSeriesDisplay(value, form);
  if (options.link !== undefined) {
    const slug = prefixSeriesSlug(value);
    if (slug !== '') {
      const href = `${'../'.repeat(options.link.depthToRoot)}series/${encodeURIComponent(slug)}.html`;
      return `<a class="${CALLSIGN_CLASS} ${PREFIX_SERIES_CLASS}${escapeHtml(extra)}" href="${href}">${escapeHtml(shown)}</a>`;
    }
  }
  return `<span class="${CALLSIGN_CLASS} ${PREFIX_SERIES_CLASS}${escapeHtml(extra)}">${escapeHtml(shown)}</span>`;
}
