/**
 * The download-slot grid components for the redesigned entry pages (variant Q,
 * static half): a populated download slot, a placeholder for a not-yet-built
 * artefact, and the tier wrapper that lays a set of slots out in a grid.
 *
 * No behaviour of its own - these are the same components the entry-page build
 * has always emitted, so the generated HTML is byte-for-byte unchanged.
 */

import { escapeHtml } from './html.ts';

export function downloadSlot(name: string, href: string, meta: string, desc: string): string {
  return `<div class="slot"><span class="name"><a href="${href}">${escapeHtml(name)}</a></span> <span class="meta">${escapeHtml(meta)}</span><div class="desc">${escapeHtml(desc)}</div></div>`;
}
export function placeholderSlot(name: string, tag: string): string {
  return `<div class="slot empty"><span class="name">${escapeHtml(name)}</span><br><span class="tag">${escapeHtml(tag)}</span></div>`;
}
export function downloadTier(title: string, slots: string[]): string {
  return `<div class="tier"><h3>${escapeHtml(title)}</h3><div class="grid">${slots.join('')}</div></div>`;
}
