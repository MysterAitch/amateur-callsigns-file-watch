/**
 * The shared table/label affordances (issues #328/#334): the accessible
 * table caption, the humanised dataset label, the blank humaniser, and the
 * vertical breakdown rows. One definition each, reused across sections so a
 * table or a dataset is presented the same way wherever it appears. (The
 * callsign family - the field wrapper and the #310 pill - lives in
 * ./callsign.ts.)
 */

import { escapeHtml } from './html.ts';

// A data table's accessible name and visible label (issue #334). Every
// self-evident table opens with one so assistive tech announces what the table
// is before reading its cells, and a sighted reader gets the same one-line
// "what am I looking at" without hunting the surrounding prose. Styled small
// and muted under `.ledger caption` (site/ledger.css). Pass `escape: false` to
// keep caller-supplied markup inside the caption (e.g. a glossary-linked term).
export function tableCaption(text: string, options: { escape?: boolean } = {}): string {
  const shown = options.escape === false ? text : escapeHtml(text);
  return `<caption class="table-caption">${shown}</caption>`;
}

// A dataset identifier rendered as its humanised label (issue #328). The human
// name reads first (linked to the dataset's detail page where one exists); the
// raw archive key follows beneath as a secondary, monospace identifier, so a
// reader sees WHAT a dataset is before its machine key. One definition, reused
// by the data-status inventory, the dataset-class pages and the dataset index,
// so a dataset is presented the same way wherever it is named — replacing the
// name-then-key markup each of those generators used to hand-roll. Emits the
// inner markup of a row-header cell; the caller supplies the enclosing
// `<th class="dskey">` (styling in site/ledger.css, scoped under `.ledger`).
// `trailing` slots caller markup (e.g. a secondary-class note) between the name
// and the key; `escapeName: false` keeps caller-supplied markup in the name.
export function datasetLabel(name: string, rawKey: string, options: { href?: string; escapeName?: boolean; trailing?: string } = {}): string {
  const shownName = options.escapeName === false ? name : escapeHtml(name);
  const nameHtml = options.href === undefined ? shownName : `<a href="${options.href}">${shownName}</a>`;
  return `${nameHtml}${options.trailing ?? ''}<span class="dstitle"><span class="mono">${escapeHtml(rawKey)}</span></span>`;
}

// Vertical breakdown rows with a subtle proportion bar and a de-emphasised
// percentage; the label optionally links (largest = whole; caller supplies).
// Never show a bare empty string as a label/key/header: a blank value is
// itself information (a record the source left empty), so name it. Matches
// the humanising used elsewhere ((blank status), (none), (empty value)).
export function humaniseLabel(value: string): string {
  return value === '' ? '(blank)' : value;
}

// De-emphasises a literal zero in a rendered numeric cell (issue #731): the
// shared `.zero` class draws the --muted token so the eye lands on non-zero
// neighbours, without rewording or hiding the value. `shown` is the cell's
// already-formatted display text (e.g. a toLocaleString'd count); the zero
// check runs against `raw` - the pre-formatting value - trimmed, so it fires
// only when the underlying value is exactly zero: a formatted variant like
// "0%", "0 B" or "~0" is a caller's own judgement call, not this helper's
// (they keep their existing rendering, muted or not, unchanged). A blank
// stays a wholly different, separately-humanised state (see humaniseLabel
// above) - never routed through this helper.
export function zeroCell(raw: string | number, shown: string = String(raw)): string {
  return String(raw).trim() === '0' ? `<span class="zero">${shown}</span>` : shown;
}

// `labelFor`, when given, supplies the label's inner HTML directly (e.g. the
// shared status/licence field wrapper - issue #553), bypassing the default
// escapeHtml(humaniseLabel(…)) text. Omitted, every existing caller's output
// is unchanged. Not meant to combine with `linkFor` on the same call: a
// caller opting into the field wrapper renders its own element and supplies
// no separate href for that label.
export function breakdownRows(counts: [string, number][], total: number, linkFor?: (v: string) => string | undefined, rowAttr?: (v: string) => string, labelFor?: (v: string) => string): string {
  return counts.map(([label, n]) => {
    const pct = total > 0 ? Math.round((n / total) * 100) : 0;
    const pctText = pct === 0 && n > 0 ? '<1%' : `${pct}%`;
    const href = linkFor?.(label);
    const shown = labelFor !== undefined ? labelFor(label) : escapeHtml(humaniseLabel(label));
    const lab = href === undefined ? shown : `<a href="${href}">${shown}</a>`;
    return `<div class="brow"${rowAttr?.(label) ?? ''}><span class="lab">${lab}</span><span class="pct">${pctText}</span><b>${n.toLocaleString('en-GB')}</b><span class="barbg" style="width:${Math.min(pct, 100)}%"></span></div>`;
  }).join('');
}
