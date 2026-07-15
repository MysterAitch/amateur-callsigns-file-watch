/**
 * The shared table/label affordances (issues #310/#328/#334): the accessible
 * table caption, the callsign pill, the humanised dataset label, the blank
 * humaniser, and the vertical breakdown rows. One definition each, reused
 * across sections so a table, a callsign or a dataset is presented the same way
 * wherever it appears.
 *
 * No behaviour of its own - these are the same helpers the site build has
 * always emitted, so the generated HTML is byte-for-byte unchanged.
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

// The parsed callsign components a caller may have to hand for a pill's
// supplementary title. Every field is optional: the pill uses whatever is
// present and degrades to the bare callsign when none is.
export interface CallsignComponents {
  prefixSeries?: string;
  rsl?: string;
  suffix?: string;
  // The human licence class / station level (e.g. 'Foundation'), where known.
  licenceClass?: string;
}

// A callsign rendered as a small monospace pill that links to the register
// lookup (?c=<callsign>), so a callsign looks and behaves the same wherever it
// is presented as content. `depthToRoot` places the lookup link at the right
// relative depth. The ACCESSIBLE NAME is always the bare callsign (the link
// text); any parsed component data the caller supplies becomes a supplementary
// title only ("M7TEE — prefix series M7 · suffix TEE · Foundation"), never the
// accessible name, and the pill degrades gracefully to just the callsign when
// no components are given.
export function callsignPill(callsign: string, depthToRoot: number, components: CallsignComponents = {}): string {
  const href = `${'../'.repeat(depthToRoot)}index.html?c=${encodeURIComponent(callsign)}`;
  const facts: string[] = [];
  if (components.prefixSeries !== undefined && components.prefixSeries !== '') facts.push(`prefix series ${components.prefixSeries}`);
  if (components.rsl !== undefined && components.rsl !== '') facts.push(`RSL ${components.rsl}`);
  if (components.suffix !== undefined && components.suffix !== '') facts.push(`suffix ${components.suffix}`);
  if (components.licenceClass !== undefined && components.licenceClass !== '') facts.push(components.licenceClass);
  const title = facts.length > 0 ? ` title="${escapeHtml(`${callsign} — ${facts.join(' · ')}`)}"` : '';
  return `<a class="callsign-pill" href="${href}"${title}>${escapeHtml(callsign)}</a>`;
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

export function breakdownRows(counts: [string, number][], total: number, linkFor?: (v: string) => string | undefined, rowAttr?: (v: string) => string): string {
  return counts.map(([label, n]) => {
    const pct = total > 0 ? Math.round((n / total) * 100) : 0;
    const pctText = pct === 0 && n > 0 ? '<1%' : `${pct}%`;
    const href = linkFor?.(label);
    const shown = escapeHtml(humaniseLabel(label));
    const lab = href === undefined ? shown : `<a href="${href}">${shown}</a>`;
    return `<div class="brow"${rowAttr?.(label) ?? ''}><span class="lab">${lab}</span><span class="pct">${pctText}</span><b>${n.toLocaleString('en-GB')}</b><span class="barbg" style="width:${Math.min(pct, 100)}%"></span></div>`;
  }).join('');
}
